/**
 * Dataset evaluation and training-data export.
 *
 *   npm run dataset:template   run the pipeline over dataset/images and write
 *                              dataset/labels.template.csv pre-filled with its guesses
 *   npm run dataset:eval       compare the pipeline against dataset/labels.csv, write
 *                              dataset/report.md, dataset/results.json and dataset/lines.jsonl
 *   npm run dataset:eval -- --only sensodyne     only files whose name contains "sensodyne"
 *
 * dataset/labels.csv columns (blank = not printed on this panel):
 *   file, product_name, manufacturer, address, net_quantity, consumer_care,
 *   licence, mrp, mfg_date, expiry, country, importer, batch, notes
 *
 * lines.jsonl holds every OCR line of every image with the declaration it
 * matched (or OTHER); `npm run nlp:train` picks it up automatically, so the
 * classifier learns from the real recogniser output, not only from templates.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeclarationKey } from '@shared/types';
import { recognisePackage, shutdown } from '../src/ocr/index';

const ROOT = fileURLToPath(new URL('../../dataset/', import.meta.url));
const IMAGES = join(ROOT, 'images');
const LABELS = join(ROOT, 'labels.csv');

const COLUMNS: { col: string; key: DeclarationKey }[] = [
  { col: 'product_name', key: 'PRODUCT_IDENTITY' },
  { col: 'manufacturer', key: 'MANUFACTURER_NAME' },
  { col: 'address', key: 'MANUFACTURER_ADDRESS' },
  { col: 'net_quantity', key: 'NET_QUANTITY' },
  { col: 'consumer_care', key: 'CONSUMER_CARE' },
  { col: 'licence', key: 'FSSAI_LICENSE' },
  { col: 'mrp', key: 'MRP' },
  { col: 'mfg_date', key: 'DATE_OF_PACKING' },
  { col: 'expiry', key: 'BEST_BEFORE' },
  { col: 'country', key: 'COUNTRY_OF_ORIGIN' },
  { col: 'importer', key: 'IMPORTER_DETAILS' },
  { col: 'batch', key: 'BATCH_NUMBER' },
];

/* ------------------------------------------------------------------ csv */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some((c) => c.trim())) rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/* ------------------------------------------------------------ matching */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (s: string) => s.replace(/\D/g, '');

/** True when the pipeline's value agrees with the label for this field. */
function matches(key: DeclarationKey, expected: string, got: string | null): boolean {
  if (!expected) return got === null;
  if (got === null) return false;
  if (key === 'MRP' || key === 'DATE_OF_PACKING' || key === 'BEST_BEFORE' || key === 'FSSAI_LICENSE') {
    const e = digits(expected);
    const g = digits(got);
    return e.length > 0 && (g.includes(e) || e.includes(g) && g.length >= Math.min(4, e.length));
  }
  if (key === 'NET_QUANTITY') {
    if (norm(got).replace(/\s/g, '').includes(norm(expected).replace(/\s/g, ''))) return true;
    const unitOf = (u: string) => u.toLowerCase().replace(/^(?:gm|gms|grams?)$/, 'g').replace(/^(?:ltr|litres?|liters?)$/, 'l').replace(/^(?:pcs|pieces|nos)$/, 'n').replace(/s$/, '');
    const want = expected.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/i);
    if (!want) return false;
    for (const m of got.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
      if (unitOf(m[2]) === unitOf(want[2]) && Math.abs(Number(m[1]) - Number(want[1])) <= Math.max(0.05, Number(want[1]) * 0.005)) return true;
    }
    return false;
  }
  if (key === 'CONSUMER_CARE') {
    // A contact block is right when it carries the phone number (any spacing) or the e-mail address.
    const phones = expected.match(/[+\d][\d\s\-]{7,}/g) ?? [];
    const gotDigits = digits(got);
    if (phones.some((p) => digits(p).length >= 8 && gotDigits.includes(digits(p)))) return true;
    const mail = expected.match(/[\w.+-]+@[\w.-]+/);
    if (mail && norm(got).includes(norm(mail[0]))) return true;
  }
  const e = norm(expected);
  const g = norm(got);
  if (!e) return false;
  if (g.includes(e) || e.includes(g)) return true;
  const et = new Set(e.split(' '));
  const gt = new Set(g.split(' '));
  const inter = [...et].filter((t) => gt.has(t) && t.length > 2).length;
  return inter / Math.max(1, Math.min(et.size, gt.size)) >= 0.6;
}

/* ------------------------------------------------------------------ main */
const args = process.argv.slice(2);
const template = args.includes('--template');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]?.toLowerCase() : undefined;

if (!existsSync(IMAGES)) {
  mkdirSync(IMAGES, { recursive: true });
  console.log(`Created ${IMAGES}. Put the photographs there (jpg/png) and run again.`);
  process.exit(0);
}
const files = readdirSync(IMAGES)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .filter((f) => !only || f.toLowerCase().includes(only))
  .sort();
if (files.length === 0) {
  console.log(`No images in ${IMAGES}.`);
  process.exit(0);
}

const labels = !template && existsSync(LABELS) ? parseCsv(readFileSync(LABELS, 'utf8')) : [];
const labelFor = (file: string) => labels.find((l) => l.file === file || basename(l.file) === file);
if (!template && labels.length === 0) {
  console.log(`No ${LABELS} yet. Run "npm run dataset:template" first, correct the guesses, save as labels.csv.`);
  process.exit(0);
}

interface ImageResult {
  file: string;
  found: number;
  level: string;
  ms: number;
  fields: Record<string, { got: string | null; expected?: string; ok?: boolean }>;
}
const results: ImageResult[] = [];
const lineRecords: { text: string; label: string; file: string }[] = [];
const perField = new Map<string, { tp: number; fp: number; fn: number; tn: number }>();
for (const c of COLUMNS) perField.set(c.key, { tp: 0, fp: 0, fn: 0, tn: 0 });

const templateRows: string[] = [
  ['file', ...COLUMNS.map((c) => c.col), 'notes'].join(','),
];

for (const [i, file] of files.entries()) {
  const t0 = Date.now();
  const r = await recognisePackage({ buffer: readFileSync(join(IMAGES, file)), imageId: file });
  const ms = Date.now() - t0;
  const got: Record<DeclarationKey, string | null> = Object.fromEntries(
    r.declarations.map((d) => [d.key, d.detectedValue]),
  ) as Record<DeclarationKey, string | null>;
  const found = r.declarations.filter((d) => d.detectedValue).length;

  if (template) {
    templateRows.push([file, ...COLUMNS.map((c) => csvCell(got[c.key] ?? '')), csvCell(`${found}/12 ${r.quality.level}`)].join(','));
    console.log(`${String(i + 1).padStart(3)}/${files.length}  ${file.padEnd(40)} ${found}/12 ${r.quality.level.padEnd(8)} ${ms} ms`);
    continue;
  }

  const label = labelFor(file);
  const fields: ImageResult['fields'] = {};
  let ok = 0;
  let checked = 0;
  for (const c of COLUMNS) {
    const expected = label?.[c.col] ?? '';
    const g = got[c.key];
    const m = label ? matches(c.key, expected, g) : undefined;
    fields[c.key] = { got: g, expected: label ? expected : undefined, ok: m };
    if (label) {
      checked++;
      if (m) ok++;
      const stat = perField.get(c.key)!;
      if (expected && g !== null && m) stat.tp++;
      else if (expected && (g === null || !m)) stat.fn++;
      else if (!expected && g !== null) stat.fp++;
      else stat.tn++;
    }
    // Training lines: every OCR line whose text carries the expected value.
    if (expected) {
      for (const line of r.lines) {
        if (matches(c.key, expected, line.text) && line.text.trim().length >= 3) lineRecords.push({ text: line.text, label: c.key, file });
      }
    }
  }
  for (const line of r.lines) {
    if (!lineRecords.some((l) => l.file === file && l.text === line.text) && line.confidence >= 0.7 && line.text.trim().length >= 6) {
      lineRecords.push({ text: line.text, label: 'OTHER', file });
    }
  }
  results.push({ file, found, level: r.quality.level, ms, fields });
  console.log(`${String(i + 1).padStart(3)}/${files.length}  ${file.padEnd(40)} ${label ? `${ok}/${checked} correct` : 'unlabelled'}  ${r.quality.level.padEnd(8)} ${ms} ms`);
}

if (template) {
  const out = join(ROOT, 'labels.template.csv');
  writeFileSync(out, templateRows.join('\n') + '\n', 'utf8');
  console.log(`\nTemplate written: ${out}\nCorrect the guesses against the physical packs, delete anything not printed on the photographed panel, save as dataset/labels.csv, then run "npm run dataset:eval".`);
} else {
  const total = results.reduce((s, r) => s + Object.values(r.fields).filter((f) => f.ok).length, 0);
  const checks = results.reduce((s, r) => s + Object.values(r.fields).filter((f) => f.ok !== undefined).length, 0);
  const lines: string[] = [];
  lines.push(`# Dataset evaluation`, '', `${results.length} images · ${total}/${checks} field checks correct (${((total / Math.max(1, checks)) * 100).toFixed(1)}%)`, '');
  lines.push('| Declaration | Correct when present | Missed | Wrong / hallucinated | Correctly absent |', '|---|---|---|---|---|');
  for (const c of COLUMNS) {
    const s = perField.get(c.key)!;
    const recall = s.tp + s.fn ? ((s.tp / (s.tp + s.fn)) * 100).toFixed(0) + '%' : '—';
    lines.push(`| ${c.col} | ${s.tp} (${recall}) | ${s.fn} | ${s.fp} | ${s.tn} |`);
  }
  lines.push('', '## Failures', '');
  for (const r of results) {
    const bad = Object.entries(r.fields).filter(([, f]) => f.ok === false);
    if (!bad.length) continue;
    lines.push(`### ${r.file} — ${r.level}, ${r.ms} ms`, '');
    for (const [key, f] of bad) lines.push(`- **${key}**: expected \`${f.expected || '(not printed)'}\`, got \`${f.got ?? '—'}\``);
    lines.push('');
  }
  writeFileSync(join(ROOT, 'report.md'), lines.join('\n'), 'utf8');
  writeFileSync(join(ROOT, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  writeFileSync(join(ROOT, 'lines.jsonl'), lineRecords.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  console.log(`\n${total}/${checks} field checks correct · report: dataset/report.md · ${lineRecords.length} labelled OCR lines → dataset/lines.jsonl (used by npm run nlp:train)`);
}
await shutdown();
