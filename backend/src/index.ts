import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Inspection, Violation } from '@shared/types';
import { COMPLIANCE_RULES } from '@shared/data/rules';
import { caseById } from '@shared/data/seedCorpus';
import { evaluateRules, scoreResults, determineStatus, deriveViolations } from '@shared/rules/ruleEngine';
import { buildDeclarations, buildRawText } from '@shared/ocr/demoOcr';
import { toBox } from '@shared/data/labelImages';
import { assertConnection, pool } from './db/pool';
import { applySchema, isSeeded, seed, truncate } from './db/seed';
import * as repo from './db/repo';
import { extractText, recognisePackage, warmUp } from './ocr';
import { mergeReadings, type ImageReading } from './ocr/merge';

/**
 * LM-Inspect AI API.
 *
 * Owns the two things a browser cannot honestly do on its own: OCR over an
 * uploaded photograph, and durable storage. The compliance rule engine is
 * imported from shared/rules/ruleEngine so the client and the server evaluate
 * packages with exactly the same code — there is no second implementation to
 * drift out of step.
 */

// Hosting platforms (Render, Railway, Fly) hand the port over as PORT.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

export const app = express();
app.use(cors());
// The bootstrap payload is ~650 KB of JSON and ~50 KB gzipped; on a phone that is
// the difference between a blank screen and the dashboard.
app.use(compression());
app.use(express.json({ limit: '30mb' }));

/**
 * Bootstrap cache.
 *
 * Every write goes through this process, so the working set can be served from
 * memory and rebuilt only after a mutation. With a hosted database each of the
 * ten queries behind /api/bootstrap is a network round trip; from cache the
 * response is immediate regardless of where the database lives.
 */
let bootstrapCache: Promise<BootstrapPayload> | null = null;

interface BootstrapPayload {
  users: Awaited<ReturnType<typeof repo.listUsers>>;
  products: Awaited<ReturnType<typeof repo.listProducts>>;
  inspections: Awaited<ReturnType<typeof repo.listInspections>>;
  evidence: Awaited<ReturnType<typeof repo.listEvidence>>;
  reports: Awaited<ReturnType<typeof repo.listReports>>;
  notifications: Awaited<ReturnType<typeof repo.listNotifications>>;
  rules: Awaited<ReturnType<typeof repo.listRules>>;
}

async function loadBootstrap(): Promise<BootstrapPayload> {
  const [users, products, inspections, evidence, reports, notifications, rules] = await Promise.all([
    repo.listUsers(),
    repo.listProducts(),
    repo.listInspections(),
    repo.listEvidence(),
    repo.listReports(),
    repo.listNotifications(),
    repo.listRules(),
  ]);
  return { users, products, inspections, evidence, reports, notifications, rules };
}

function getBootstrap(): Promise<BootstrapPayload> {
  if (!bootstrapCache) {
    bootstrapCache = loadBootstrap().catch((error) => {
      bootstrapCache = null; // do not cache a failure
      throw error;
    });
  }
  return bootstrapCache;
}

// Any mutation invalidates the cache once its response has been written, and
// the rebuild starts at once so the next reader usually finds it ready.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      bootstrapCache = null;
      getBootstrap().catch(() => undefined);
    });
  }
  next();
});

/** Express 5 types route params as string | string[]; every route here takes a single value. */
const param = (req: express.Request, name: string) => String(req.params[name]);

const asyncRoute =
  (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[api] ${req.method} ${req.path} failed:`, message);
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };

/* ---------------------------------------------------------------- Health */

app.get('/api/health', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS inspections FROM inspections');
  res.json({ ok: true, database: 'postgresql', inspections: rows[0].inspections });
}));

/* ------------------------------------------------------------- Bootstrap */

/** One round trip that hydrates the entire client cache. */
app.get('/api/bootstrap', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await getBootstrap());
}));

/* ------------------------------------------------------------------ Scan */

interface ScanImage {
  imageId: string;
  name?: string;
  dataUrl: string;
}

interface ScanBody {
  imageId: string;
  /** Base64 data URL of a single panel. Superseded by `images` when present. */
  dataUrl?: string;
  /** Every photographed panel of the package; each is read and the readings merged. */
  images?: ScanImage[];
  /** Demo corpus id; when present the stored vector label is used instead of OCR. */
  caseId?: string;
  panelWidthMm?: number;
}

/**
 * Runs the full pipeline and returns the analysis without persisting anything —
 * the inspection is only written once the officer chooses to save it.
 */
app.post('/api/scan', asyncRoute(async (req, res) => {
  const body = req.body as ScanBody;
  const rules = await repo.listRules().catch(() => COMPLIANCE_RULES);
  const minHeightMm = Number(
    rules.find((r) => r.id === 'LMPC-RDB-01')?.params?.minHeightMm ?? 1.5,
  );

  let ocr;
  let declarations;
  let source: 'OCR' | 'DEMO_CORPUS';
  let quality;
  let preprocessing;
  let lines;
  let perImage;

  const images: ScanImage[] =
    body.images?.length ? body.images : body.dataUrl ? [{ imageId: body.imageId, dataUrl: body.dataUrl }] : [];

  if (images.length > 0) {
    // Panels are read one after another: the OCR worker is single-threaded and
    // a 12 MP frame is memory-heavy, so sequential is both simpler and safer.
    const readings: ImageReading[] = [];
    for (const [index, image] of images.entries()) {
      const buffer = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');
      if (buffer.length === 0) {
        res.status(400).json({ error: `Image ${index + 1} payload is empty.` });
        return;
      }
      const response = await recognisePackage({
        buffer,
        imageId: image.imageId,
        panelWidthMm: body.panelWidthMm,
        minHeightMm,
      });
      readings.push({ imageId: image.imageId, name: image.name ?? `Image ${index + 1}`, response });
    }
    const merged = mergeReadings(readings);
    ocr = merged.ocr;
    declarations = merged.declarations;
    quality = merged.quality;
    preprocessing = merged.preprocessing;
    lines = merged.lines;
    perImage = merged.perImage;
    source = 'OCR';
  } else {
    const demo = body.caseId ? caseById(body.caseId) : undefined;
    if (!demo) {
      res.status(400).json({ error: 'Provide either an image (dataUrl) or a known caseId.' });
      return;
    }
    declarations = buildDeclarations(demo);
    const detected = declarations.filter((d) => d.detectedValue);
    ocr = {
      imageId: demo.label.imageId,
      engine: demo.ocrMeta.engine,
      processingMs: 1240,
      rawText: buildRawText(demo),
      tokens: detected.map((d) => ({
        text: d.detectedValue!,
        confidence: d.confidence,
        box: toBox(d.key),
      })),
      averageConfidence: Number(
        (detected.reduce((s, d) => s + d.confidence, 0) / Math.max(detected.length, 1)).toFixed(3),
      ),
      imageWidth: demo.ocrMeta.imageWidth,
      imageHeight: demo.ocrMeta.imageHeight,
      estimatedDpi: demo.ocrMeta.estimatedDpi,
    };
    source = 'DEMO_CORPUS';
  }

  const ruleResults = evaluateRules(declarations, rules);
  const { score, breakdown } = scoreResults(ruleResults);

  res.json({
    source,
    quality,
    preprocessing,
    lines,
    perImage,
    ocr,
    declarations,
    ruleResults,
    score,
    breakdown,
    status: determineStatus(ruleResults, score),
    violations: deriveViolations(ruleResults, 'PENDING'),
  });
}));

/* --------------------------------------------------------- Text extraction */

/**
 * Reads every line of text the recogniser can find in an image, with the
 * preprocessed view it was read from. No rule evaluation, nothing persisted.
 */
app.post('/api/ocr/text', asyncRoute(async (req, res) => {
  const { dataUrl } = req.body as { dataUrl?: string };
  if (!dataUrl) {
    res.status(400).json({ error: 'Provide the image as a data URL in "dataUrl".' });
    return;
  }
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (buffer.length === 0) {
    res.status(400).json({ error: 'Image payload is empty.' });
    return;
  }
  res.json(await extractText(buffer));
}));

/* ----------------------------------------------------------- Inspections */

app.post('/api/inspections', asyncRoute(async (req, res) => {
  const { inspection, evidence, product, notification } = req.body as {
    inspection: Inspection;
    evidence: Parameters<typeof repo.insertEvidence>[0][];
    product: Parameters<typeof repo.upsertProduct>[0];
    notification?: Parameters<typeof repo.insertNotification>[0];
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (product) await repo.upsertProduct(product, client);
    await repo.insertInspection(inspection, client);
    for (const item of evidence ?? []) await repo.insertEvidence(item, client);
    if (notification) await repo.insertNotification(notification, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.status(201).json({ id: inspection.id });
}));

app.get('/api/inspections/sequence', asyncRoute(async (_req, res) => {
  res.json({ sequence: await repo.nextInspectionSequence() });
}));

app.patch('/api/inspections/:id', asyncRoute(async (req, res) => {
  const { patch, audit } = req.body as {
    patch: Partial<Inspection>;
    audit?: Inspection['auditLog'][number];
  };
  await repo.updateInspectionFields(param(req, 'id'), patch);
  if (audit) await repo.appendAudit(param(req, 'id'), audit);
  res.json({ ok: true });
}));

app.patch('/api/violations/:id', asyncRoute(async (req, res) => {
  const { patch, audit, inspectionId, product } = req.body as {
    patch: Partial<Violation>;
    audit?: Inspection['auditLog'][number];
    inspectionId?: string;
    product?: Parameters<typeof repo.upsertProduct>[0];
  };
  await repo.updateViolation(param(req, 'id'), patch);
  if (audit && inspectionId) await repo.appendAudit(inspectionId, audit);
  if (product) await repo.upsertProduct(product);
  res.json({ ok: true });
}));

/* -------------------------------------------------------------- Evidence */

app.post('/api/evidence', asyncRoute(async (req, res) => {
  const { evidence, audit, inspectionId } = req.body as {
    evidence: Parameters<typeof repo.insertEvidence>[0];
    audit?: Inspection['auditLog'][number];
    inspectionId?: string;
  };
  await repo.insertEvidence(evidence);
  if (audit && inspectionId) await repo.appendAudit(inspectionId, audit);
  res.status(201).json({ id: evidence.id });
}));

app.delete('/api/evidence/:id', asyncRoute(async (req, res) => {
  const { audit, inspectionId } = req.body as {
    audit?: Inspection['auditLog'][number];
    inspectionId?: string;
  };
  await repo.deleteEvidence(param(req, 'id'));
  if (audit && inspectionId) await repo.appendAudit(inspectionId, audit);
  res.json({ ok: true });
}));

/* --------------------------------------------------------------- Reports */

app.post('/api/reports', asyncRoute(async (req, res) => {
  const { report, audit, notification } = req.body as {
    report: Parameters<typeof repo.upsertReport>[0];
    audit?: Inspection['auditLog'][number];
    notification?: Parameters<typeof repo.insertNotification>[0];
  };
  await repo.upsertReport(report);
  await repo.updateInspectionFields(report.inspectionId, { reportId: report.id });
  if (audit) await repo.appendAudit(report.inspectionId, audit);
  if (notification) await repo.insertNotification(notification);
  res.status(201).json({ id: report.id });
}));

app.patch('/api/reports/:id', asyncRoute(async (req, res) => {
  const { status } = req.body as { status: Parameters<typeof repo.setReportStatus>[1] };
  await repo.setReportStatus(param(req, 'id'), status);
  res.json({ ok: true });
}));

/* ----------------------------------------------------------------- Rules */

app.patch('/api/rules/:id', asyncRoute(async (req, res) => {
  const rules = await repo.listRules();
  const existing = rules.find((r) => r.id === param(req, 'id'));
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  await repo.upsertRule({ ...existing, ...req.body });
  res.json({ ok: true });
}));

/* ----------------------------------------------------------------- Users */

app.post('/api/users', asyncRoute(async (req, res) => {
  await repo.upsertUser(req.body);
  res.status(201).json({ ok: true });
}));

app.patch('/api/users/:id/status', asyncRoute(async (req, res) => {
  await repo.setUserStatus(param(req, 'id'), req.body.status);
  res.json({ ok: true });
}));

/* --------------------------------------------------------- Notifications */

app.post('/api/notifications', asyncRoute(async (req, res) => {
  await repo.insertNotification(req.body);
  res.status(201).json({ ok: true });
}));

app.patch('/api/notifications', asyncRoute(async (req, res) => {
  const { ids, read } = req.body as { ids: string[] | 'ALL'; read: boolean };
  await repo.markNotifications(ids, read);
  res.json({ ok: true });
}));

app.delete('/api/notifications/:id', asyncRoute(async (req, res) => {
  await repo.deleteNotification(param(req, 'id'));
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ Demo reset */

app.post('/api/admin/reset', asyncRoute(async (_req, res) => {
  bootstrapCache = null;
  await truncate();
  const counts = await seed();
  res.json({ ok: true, ...counts });
}));

/* ------------------------------------------------------------------ Boot */

/* ------------------------------------------------------------- Frontend */

/**
 * In production the API also serves the built interface, so one host and one
 * origin carry the whole application. Hashed assets are immutable and cached
 * for a year; index.html is revalidated on every visit so a new deploy is
 * picked up immediately.
 */
const distDir = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
if (existsSync(join(distDir, 'index.html'))) {
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(distDir, 'index.html'));
  });
  console.log('[api] serving frontend from', distDir);
}

async function start() {
  await assertConnection();
  await applySchema();

  if (!(await isSeeded())) {
    console.log('[api] empty database — seeding demonstration corpus…');
    const counts = await seed();
    console.log('[api] seeded', counts);
  }

  // Warm the cache so the first visitor is not the one who pays for the queries.
  getBootstrap().catch((err) => console.warn('[api] bootstrap warm-up failed:', err.message));

  app.listen(PORT, () => {
    console.log(`\n  LM-Inspect AI API  →  http://localhost:${PORT}/api/health`);
    console.log('  Database: PostgreSQL   OCR: Tesseract (tesseract.js)\n');
  });

  warmUp().catch((err) =>
    console.warn('[api] OCR warm-up failed:', err.message)
  );
}

// Local development only
if (!process.env.VERCEL) {
  start().catch((error) => {
    console.error(`\n[api] startup failed\n\n${error.message}\n`);
    process.exit(1);
  });
}

export default app;