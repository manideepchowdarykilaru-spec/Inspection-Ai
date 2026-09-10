import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { DEMO_CREDENTIALS, DEPARTMENT } from '@shared/data/mockData';
import type { AccessReviewRequest, LoginRequest, LoginResponse, RegisterRequest, User } from '@shared/types';
import type { AuthedRequest } from './auth';
import { generateOtp, hashPassword, requireAuth, requireRole, signToken, verifyPassword } from './auth';
import { deliverOtp, emailConfigured, smsConfigured } from './delivery';
import type { ForgotPasswordRequest, ForgotPasswordResponse, ResetPasswordRequest } from '@shared/types';
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
// Every /api route except health and /api/auth/* requires a signed token.
app.use(requireAuth);

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

/* ------------------------------------------------------------------ Auth */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OFFICIAL_ID = /^[A-Za-z0-9][A-Za-z0-9\-\/.]{3,31}$/;

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { identifier, password, remember } = (req.body ?? {}) as Partial<LoginRequest>;
  if (!identifier || !password) {
    res.status(400).json({ error: 'Official ID and password are required.' });
    return;
  }
  const user = await repo.findUserForLogin(String(identifier));
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    res.status(401).json({ error: 'Invalid official ID or password.' });
    return;
  }
  if (user.status === 'PENDING') {
    res.status(403).json({ error: 'Your access request is awaiting approval by the department administrator.' });
    return;
  }
  if (user.status === 'REJECTED') {
    res.status(403).json({ error: 'Your access request was not approved. Contact the department administrator.' });
    return;
  }
  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'This account is not active. Contact the department administrator.' });
    return;
  }
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (remember ? 12 : 4) * 3600_000;
  const token = signToken({ sub: user.id, role: user.role, iat: issuedAt, exp: expiresAt });
  await repo.touchLastActive(user.id);
  const { passwordHash: _omit, ...safe } = user;
  void _omit;
  const response: LoginResponse = {
    user: safe,
    token,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
  res.json(response);
}));

/**
 * Access request. Officers do not self-provision in a department: the account
 * is created PENDING and an administrator approves it in User Management.
 */
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const b = (req.body ?? {}) as Partial<RegisterRequest>;
  const name = String(b.name ?? '').trim();
  const officialId = String(b.officialId ?? '').trim().toUpperCase();
  const email = String(b.email ?? '').trim().toLowerCase();
  const phone = String(b.phone ?? '').trim();
  const region = String(b.region ?? '').trim();
  const role = b.role === 'SUPERVISOR' ? 'SUPERVISOR' : b.role === 'INSPECTOR' ? 'INSPECTOR' : null;
  const password = String(b.password ?? '');

  const problems: string[] = [];
  if (name.length < 3) problems.push('full name');
  if (!OFFICIAL_ID.test(officialId)) problems.push('official ID (letters, digits, - or /)');
  if (!EMAIL.test(email)) problems.push('e-mail address');
  if (phone.replace(/\D/g, '').length < 10) problems.push('mobile number');
  if (!region) problems.push('region');
  if (!role) problems.push('role');
  if (password.length < 8) problems.push('password (at least 8 characters)');
  if (problems.length) {
    res.status(400).json({ error: `Please check: ${problems.join(', ')}.` });
    return;
  }

  const conflict = await repo.userConflict(officialId, email);
  if (conflict) {
    res.status(409).json({
      error:
        conflict === 'officialId'
          ? 'An account with this official ID already exists. Sign in, or contact the administrator if you cannot.'
          : 'An account with this e-mail already exists.',
    });
    return;
  }

  const now = new Date().toISOString();
  const initials = name.split(/\s+/).filter(Boolean).slice(-2).map((p) => p[0].toUpperCase()).join('') || 'LM';
  const user: User = {
    id: `usr_${randomUUID().slice(0, 8)}`,
    officialId,
    name,
    email,
    role: role!,
    designation:
      String(b.designation ?? '').trim() ||
      (role === 'SUPERVISOR' ? 'Assistant Controller of Legal Metrology' : 'Inspector of Legal Metrology'),
    department: DEPARTMENT,
    region,
    phone,
    avatarInitials: initials,
    status: 'PENDING',
    lastActiveAt: now,
    createdAt: now,
  };
  await repo.upsertUser(user);
  await repo.setPasswordHash(user.id, hashPassword(password));
  await repo.insertNotification({
    id: `ntf_${randomUUID().slice(0, 8)}`,
    title: 'New access request',
    body: `${name} (${officialId}) has requested ${role === 'SUPERVISOR' ? 'supervisor' : 'inspector'} access for ${region}. Review and approve in User Management.`,
    priority: 'MEDIUM',
    category: 'SYSTEM',
    createdAt: now,
    read: false,
    link: '/app/users',
  });
  res.status(201).json({ ok: true, status: 'PENDING' });
}));

/* ---------------------------------------------------------- Password reset */

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
/** With no provider configured the code is returned to the screen; OTP_SHOW_ON_SCREEN=false forbids that. */
const OTP_SCREEN_FALLBACK = process.env.OTP_SHOW_ON_SCREEN !== 'false';

const maskPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `+91 ••••• •${digits.slice(-3)}` : '••••••••••';
};
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!domain) return '••••@••••';
  return `${name.slice(0, 2)}•••@${domain}`;
};

/**
 * Step 1: the officer identifies the account; a one-time code is issued to
 * the registered mobile. Only active accounts can reset — a pending or
 * rejected applicant is told where they stand instead.
 */
app.post('/api/auth/forgot', asyncRoute(async (req, res) => {
  const { identifier } = (req.body ?? {}) as Partial<ForgotPasswordRequest>;
  if (!identifier) {
    res.status(400).json({ error: 'Enter your Official ID or e-mail.' });
    return;
  }
  const user = await repo.findUserForLogin(String(identifier));
  if (!user) {
    res.status(404).json({ error: 'No account matches that Official ID or e-mail.' });
    return;
  }
  if (user.status === 'PENDING') {
    res.status(403).json({ error: 'This access request is still awaiting approval; there is no password to reset yet.' });
    return;
  }
  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'This account is not active. Contact the department administrator.' });
    return;
  }
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60_000);
  await repo.savePasswordReset(user.id, hashPassword(code), expiresAt);

  const delivery = await deliverOtp({ name: user.name, email: user.email, phone: user.phone, code, minutes: OTP_MINUTES });
  for (const f of delivery.failed) console.warn(`[auth] OTP ${f.channel} delivery failed for ${user.officialId}: ${f.reason}`);
  const configured = emailConfigured() || smsConfigured();
  const showOnScreen = delivery.delivered.length === 0 && OTP_SCREEN_FALLBACK;
  if (showOnScreen) console.log(`[auth] password reset code for ${user.officialId}: ${code} (valid ${OTP_MINUTES} min)`);
  if (delivery.delivered.length === 0 && !OTP_SCREEN_FALLBACK) {
    res.status(502).json({ error: 'The code could not be sent. Contact the department administrator.' });
    return;
  }

  const response: ForgotPasswordResponse = {
    ok: true,
    maskedPhone: maskPhone(user.phone),
    maskedEmail: maskEmail(user.email),
    expiresInMinutes: OTP_MINUTES,
    channels: delivery.delivered,
    ...(showOnScreen ? { demoCode: code } : {}),
    ...(delivery.failed.length && configured
      ? { deliveryNote: `${delivery.failed.map((f) => f.channel === 'sms' ? 'SMS' : 'e-mail').join(' and ')} delivery failed; check the provider settings.` }
      : {}),
  };
  res.json(response);
}));

/** Step 2: the code and the new password. */
app.post('/api/auth/reset', asyncRoute(async (req, res) => {
  const { identifier, code, newPassword } = (req.body ?? {}) as Partial<ResetPasswordRequest>;
  if (!identifier || !code || !newPassword) {
    res.status(400).json({ error: 'Official ID, the code and a new password are required.' });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: 'The new password must be at least 8 characters.' });
    return;
  }
  const user = await repo.findUserForLogin(String(identifier));
  const reset = user ? await repo.getPasswordReset(user.id) : null;
  if (!user || !reset) {
    res.status(400).json({ error: 'No reset is in progress for this account. Request a new code.' });
    return;
  }
  if (reset.expiresAt.getTime() < Date.now() || reset.attempts >= OTP_MAX_ATTEMPTS) {
    await repo.deletePasswordReset(user.id);
    res.status(400).json({ error: 'The code has expired. Request a new one.' });
    return;
  }
  if (!verifyPassword(String(code).trim(), reset.codeHash)) {
    await repo.countPasswordResetAttempt(user.id);
    const left = OTP_MAX_ATTEMPTS - reset.attempts - 1;
    res.status(400).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Request a new one.' });
    return;
  }
  await repo.setPasswordHash(user.id, hashPassword(String(newPassword)));
  await repo.deletePasswordReset(user.id);
  res.json({ ok: true });
}));

/** Seeded demonstration accounts receive their published passwords once. */
async function ensureDemoPasswords() {
  for (const credential of DEMO_CREDENTIALS) {
    await repo.setPasswordHashIfEmpty(credential.officialId, hashPassword(credential.password));
  }
}

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
      // Kept (last 30) so a poor result can be reproduced on the exact photograph.
      repo
        .archiveScan({
          name: image.name,
          dataUrl: image.dataUrl,
          width: response.ocr.imageWidth,
          height: response.ocr.imageHeight,
          found: response.declarations.filter((d) => d.detectedValue).length,
          level: response.quality.level,
          labelFound: response.quality.labelDetected,
          processingMs: response.ocr.processingMs,
        })
        .catch((err: Error) => console.warn('[api] scan archive failed:', err.message));
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
  const extraction = await extractText(buffer);
  repo
    .archiveScan({
      name: 'text-extraction',
      dataUrl,
      width: extraction.imageWidth,
      height: extraction.imageHeight,
      found: extraction.declarations.filter((d) => d.detectedValue).length,
      level: extraction.quality.level,
      labelFound: extraction.quality.labelDetected,
      processingMs: extraction.processingMs,
    })
    .catch((err: Error) => console.warn('[api] scan archive failed:', err.message));
  res.json(extraction);
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

app.patch('/api/rules/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
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

app.post('/api/users', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  await repo.upsertUser(req.body);
  res.status(201).json({ ok: true });
}));

/** Access-request decision by an administrator; the reviewer and time are recorded. */
app.patch('/api/users/:id/review', requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const body = (req.body ?? {}) as Partial<AccessReviewRequest>;
  const id = param(req, 'id');
  const applicant = await repo.findUserById(id);
  if (!applicant) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  if (applicant.status !== 'PENDING' && applicant.status !== 'REJECTED') {
    res.status(409).json({ error: 'This account is not an open access request.' });
    return;
  }
  if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') {
    res.status(400).json({ error: 'Decision must be APPROVE or REJECT.' });
    return;
  }
  const note = String(body.note ?? '').trim();
  if (body.decision === 'REJECT' && note.length < 3) {
    res.status(400).json({ error: 'Give the applicant a reason for the rejection.' });
    return;
  }
  const role: User['role'] =
    body.role === 'ADMIN' || body.role === 'SUPERVISOR' || body.role === 'INSPECTOR' ? body.role : applicant.role;
  const reviewer = await repo.findUserById((req as AuthedRequest).auth!.sub);
  const reviewedAt = new Date().toISOString();
  const updated = await repo.reviewUser(id, {
    status: body.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
    role,
    region: String(body.region ?? '').trim() || applicant.region,
    designation: String(body.designation ?? '').trim() || applicant.designation,
    reviewedBy: reviewer?.name ?? 'Administrator',
    reviewedAt,
    note: note || null,
  });
  await repo.insertNotification({
    id: `ntf_${randomUUID().slice(0, 8)}`,
    title: body.decision === 'APPROVE' ? 'Access request approved' : 'Access request rejected',
    body:
      body.decision === 'APPROVE'
        ? `${applicant.name} (${applicant.officialId}) can now sign in as ${role.toLowerCase()} for ${updated?.region ?? applicant.region}.`
        : `${applicant.name} (${applicant.officialId}) was not approved: ${note}`,
    priority: 'LOW',
    category: 'SYSTEM',
    createdAt: reviewedAt,
    read: false,
    link: '/app/access-requests',
  });
  res.json({ user: updated });
}));

app.patch('/api/users/:id/status', requireRole('ADMIN'), asyncRoute(async (req, res) => {
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

app.post('/api/admin/reset', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
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

  await ensureDemoPasswords();
  console.log(
    `[auth] OTP delivery: e-mail ${emailConfigured() ? 'on (SMTP)' : 'off'} · SMS ${smsConfigured() ? 'on (Twilio)' : 'off'}` +
      (emailConfigured() || smsConfigured() ? '' : ' · codes shown on screen (demo)'),
  );

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