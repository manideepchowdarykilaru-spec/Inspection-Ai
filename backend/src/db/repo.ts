import type { PoolClient } from 'pg';
import type {
  AppNotification,
  AuditLogEntry,
  ComplianceRule,
  Evidence,
  Inspection,
  Product,
  Report,
  User,
  Violation,
} from '@shared/types';
import { pool } from './pool';

/**
 * Row ⇄ domain mapping.
 *
 * The API returns exactly the domain shapes the React client already consumes,
 * so persistence was introduced without changing a single screen.
 */

type Row = Record<string, any>;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const isoOrUndefined = (value: unknown): string | undefined =>
  value == null ? undefined : iso(value);

/* ------------------------------------------------------------------ Users */

export const toUser = (r: Row): User => ({
  id: r.id,
  officialId: r.official_id,
  name: r.name,
  email: r.email,
  role: r.role,
  designation: r.designation,
  department: r.department,
  region: r.region,
  phone: r.phone ?? '',
  avatarInitials: r.avatar_initials,
  status: r.status,
  lastActiveAt: iso(r.last_active_at),
  createdAt: iso(r.created_at),
  reviewedBy: r.reviewed_by ?? undefined,
  reviewedAt: isoOrUndefined(r.reviewed_at),
  reviewNote: r.review_note ?? undefined,
});

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Records an access-request decision: status, any corrections, and who decided when. */
export async function reviewUser(
  id: string,
  review: {
    status: User['status'];
    role: User['role'];
    region: string;
    designation: string;
    reviewedBy: string;
    reviewedAt: string;
    note: string | null;
  },
): Promise<User | null> {
  const { rows } = await pool.query(
    `UPDATE users
        SET status = $2, role = $3, region = $4, designation = $5,
            reviewed_by = $6, reviewed_at = $7, review_note = $8
      WHERE id = $1
      RETURNING *`,
    [id, review.status, review.role, review.region, review.designation, review.reviewedBy, review.reviewedAt, review.note],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
  return rows.map(toUser);
}

export async function upsertUser(user: User, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO users (id, official_id, name, email, role, designation, department, region,
                        phone, avatar_initials, status, last_active_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       official_id = EXCLUDED.official_id, name = EXCLUDED.name, email = EXCLUDED.email,
       role = EXCLUDED.role, designation = EXCLUDED.designation, department = EXCLUDED.department,
       region = EXCLUDED.region, phone = EXCLUDED.phone, avatar_initials = EXCLUDED.avatar_initials,
       status = EXCLUDED.status, last_active_at = EXCLUDED.last_active_at`,
    [
      user.id, user.officialId, user.name, user.email, user.role, user.designation,
      user.department, user.region, user.phone, user.avatarInitials, user.status,
      user.lastActiveAt, user.createdAt,
    ],
  );
}

/** The user row plus its password hash — only for the login route. */
export async function findUserForLogin(identifier: string): Promise<(User & { passwordHash: string | null }) | null> {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE lower(official_id) = lower($1) OR lower(email) = lower($1) LIMIT 1',
    [identifier.trim()],
  );
  if (!rows[0]) return null;
  return { ...toUser(rows[0]), passwordHash: rows[0].password_hash ?? null };
}

/** Which unique field an access request collides with, if any. */
export async function userConflict(officialId: string, email: string): Promise<'officialId' | 'email' | null> {
  const { rows } = await pool.query(
    'SELECT official_id, email FROM users WHERE lower(official_id) = lower($1) OR lower(email) = lower($2)',
    [officialId.trim(), email.trim()],
  );
  if (!rows.length) return null;
  return rows.some((r) => r.official_id.toLowerCase() === officialId.trim().toLowerCase()) ? 'officialId' : 'email';
}

export async function setPasswordHash(id: string, hash: string) {
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
}

/** Gives a seeded account its password without overwriting one already set. */
export async function setPasswordHashIfEmpty(officialId: string, hash: string) {
  await pool.query('UPDATE users SET password_hash = $2 WHERE official_id = $1 AND password_hash IS NULL', [officialId, hash]);
}

export async function touchLastActive(id: string) {
  await pool.query('UPDATE users SET last_active_at = now() WHERE id = $1', [id]);
}

export async function setUserStatus(id: string, status: User['status']) {
  await pool.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
}

/* ------------------------------------------------------------------ Rules */

export const toRule = (r: Row): ComplianceRule => ({
  id: r.id,
  name: r.name,
  category: r.category,
  legalReference: r.legal_reference,
  description: r.description,
  declarationKey: r.declaration_key ?? undefined,
  validationType: r.validation_type,
  mandatory: r.mandatory,
  severity: r.severity,
  weight: r.weight,
  active: r.active,
  params: r.params ?? undefined,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export async function listRules(): Promise<ComplianceRule[]> {
  const { rows } = await pool.query('SELECT * FROM compliance_rules ORDER BY id');
  return rows.map(toRule);
}

export async function upsertRule(rule: ComplianceRule, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO compliance_rules (id, name, category, legal_reference, description, declaration_key,
                                   validation_type, mandatory, severity, weight, active, params,
                                   updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, legal_reference = EXCLUDED.legal_reference,
       description = EXCLUDED.description, declaration_key = EXCLUDED.declaration_key,
       validation_type = EXCLUDED.validation_type, mandatory = EXCLUDED.mandatory,
       severity = EXCLUDED.severity, weight = EXCLUDED.weight, active = EXCLUDED.active,
       params = EXCLUDED.params, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [
      rule.id, rule.name, rule.category, rule.legalReference, rule.description,
      rule.declarationKey ?? null, rule.validationType, rule.mandatory, rule.severity,
      rule.weight, rule.active, rule.params ? JSON.stringify(rule.params) : null,
      rule.updatedAt, rule.updatedBy,
    ],
  );
}

/* --------------------------------------------------------------- Products */

export const toProduct = (r: Row): Product => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  category: r.category,
  manufacturer: r.manufacturer ?? 'Not declared',
  manufacturerAddress: r.manufacturer_address ?? 'Not declared',
  packer: r.packer ?? undefined,
  importer: r.importer ?? undefined,
  countryOfOrigin: r.country_of_origin ?? 'Not declared',
  netQuantity: r.net_quantity ?? 'Not declared',
  mrp: Number(r.mrp ?? 0),
  packedOn: r.packed_on ?? undefined,
  bestBefore: r.best_before ?? undefined,
  consumerCare: r.consumer_care ?? undefined,
  fssaiLicense: r.fssai_license ?? undefined,
  barcode: r.barcode ?? '—',
  batchNumber: r.batch_number ?? undefined,
  imageId: r.image_id ?? '',
  createdAt: iso(r.created_at),
  lastInspectedAt: isoOrUndefined(r.last_inspected_at),
  inspectionCount: r.inspection_count,
  latestScore: r.latest_score ?? undefined,
  latestStatus: r.latest_status ?? undefined,
  openViolations: r.open_violations,
  repeatOffender: r.repeat_offender,
});

export async function listProducts(): Promise<Product[]> {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY last_inspected_at DESC NULLS LAST');
  return rows.map(toProduct);
}

export async function upsertProduct(p: Product, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO products (id, name, brand, category, manufacturer, manufacturer_address, packer,
                           importer, country_of_origin, net_quantity, mrp, packed_on, best_before,
                           consumer_care, fssai_license, barcode, batch_number, image_id, created_at,
                           last_inspected_at, inspection_count, latest_score, latest_status,
                           open_violations, repeat_offender)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, brand = EXCLUDED.brand, category = EXCLUDED.category,
       manufacturer = EXCLUDED.manufacturer, manufacturer_address = EXCLUDED.manufacturer_address,
       importer = EXCLUDED.importer, country_of_origin = EXCLUDED.country_of_origin,
       net_quantity = EXCLUDED.net_quantity, mrp = EXCLUDED.mrp, packed_on = EXCLUDED.packed_on,
       best_before = EXCLUDED.best_before, consumer_care = EXCLUDED.consumer_care,
       fssai_license = EXCLUDED.fssai_license, barcode = EXCLUDED.barcode,
       batch_number = EXCLUDED.batch_number, image_id = EXCLUDED.image_id,
       last_inspected_at = EXCLUDED.last_inspected_at, inspection_count = EXCLUDED.inspection_count,
       latest_score = EXCLUDED.latest_score, latest_status = EXCLUDED.latest_status,
       open_violations = EXCLUDED.open_violations, repeat_offender = EXCLUDED.repeat_offender`,
    [
      p.id, p.name, p.brand, p.category, p.manufacturer, p.manufacturerAddress, p.packer ?? null,
      p.importer ?? null, p.countryOfOrigin, p.netQuantity, p.mrp, p.packedOn ?? null,
      p.bestBefore ?? null, p.consumerCare ?? null, p.fssaiLicense ?? null, p.barcode,
      p.batchNumber ?? null, p.imageId, p.createdAt, p.lastInspectedAt ?? null, p.inspectionCount,
      p.latestScore ?? null, p.latestStatus ?? null, p.openViolations, p.repeatOffender,
    ],
  );
}

/* ------------------------------------------------------------ Inspections */

const toViolation = (r: Row): Violation => ({
  id: r.id,
  inspectionId: r.inspection_id,
  ruleId: r.rule_id,
  title: r.title,
  category: r.category,
  severity: r.severity,
  detected: r.detected ?? '',
  explanation: r.explanation ?? '',
  recommendedAction: r.recommended_action ?? '',
  legalReference: r.legal_reference ?? '',
  confidence: Number(r.confidence ?? 0),
  evidenceRegion: r.evidence_region ?? undefined,
  state: r.state,
  officerNote: r.officer_note ?? undefined,
  verifiedBy: r.verified_by ?? undefined,
  verifiedAt: isoOrUndefined(r.verified_at),
});

const toAudit = (r: Row): AuditLogEntry => ({
  id: r.id,
  at: iso(r.at),
  actor: r.actor,
  action: r.action,
  detail: r.detail ?? undefined,
});

export async function listInspections(): Promise<Inspection[]> {
  const [inspections, violations, audit, evidence] = await Promise.all([
    pool.query('SELECT * FROM inspections ORDER BY inspected_at DESC'),
    pool.query('SELECT * FROM violations ORDER BY inspection_id, position'),
    pool.query('SELECT * FROM audit_log ORDER BY inspection_id, at'),
    pool.query('SELECT id, inspection_id FROM evidence ORDER BY inspection_id, id'),
  ]);

  const violationsBy = new Map<string, Violation[]>();
  violations.rows.forEach((r) => {
    const list = violationsBy.get(r.inspection_id) ?? [];
    list.push(toViolation(r));
    violationsBy.set(r.inspection_id, list);
  });

  const auditBy = new Map<string, AuditLogEntry[]>();
  audit.rows.forEach((r) => {
    const list = auditBy.get(r.inspection_id) ?? [];
    list.push(toAudit(r));
    auditBy.set(r.inspection_id, list);
  });

  const evidenceBy = new Map<string, string[]>();
  evidence.rows.forEach((r) => {
    const list = evidenceBy.get(r.inspection_id) ?? [];
    list.push(r.id);
    evidenceBy.set(r.inspection_id, list);
  });

  return inspections.rows.map((r) => ({
    id: r.id,
    productId: r.product_id ?? '',
    productName: r.product_name,
    brand: r.brand,
    category: r.category,
    inspectorId: r.inspector_id ?? '',
    inspectorName: r.inspector_name,
    region: r.region,
    location: r.location,
    inspectedAt: iso(r.inspected_at),
    source: r.source,
    stage: r.stage,
    status: r.status,
    screeningScore: r.screening_score,
    scoreBreakdown: r.score_breakdown,
    declarations: r.declarations,
    ruleResults: r.rule_results,
    violations: violationsBy.get(r.id) ?? [],
    evidenceIds: evidenceBy.get(r.id) ?? [],
    ocr: r.ocr ?? undefined,
    remarks: r.remarks ?? undefined,
    reportId: r.report_id ?? undefined,
    auditLog: auditBy.get(r.id) ?? [],
  }));
}

export async function insertInspection(i: Inspection, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO inspections (id, product_id, product_name, brand, category, inspector_id,
                              inspector_name, region, location, inspected_at, source, stage, status,
                              screening_score, score_breakdown, declarations, rule_results, ocr,
                              remarks, report_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       stage = EXCLUDED.stage, status = EXCLUDED.status, remarks = EXCLUDED.remarks,
       report_id = EXCLUDED.report_id`,
    [
      i.id, i.productId || null, i.productName, i.brand, i.category, i.inspectorId || null,
      i.inspectorName, i.region, i.location, i.inspectedAt, i.source, i.stage, i.status,
      i.screeningScore, JSON.stringify(i.scoreBreakdown), JSON.stringify(i.declarations),
      JSON.stringify(i.ruleResults), i.ocr ? JSON.stringify(i.ocr) : null,
      i.remarks ?? null, i.reportId ?? null,
    ],
  );

  for (const [index, v] of i.violations.entries()) {
    await client.query(
      `INSERT INTO violations (id, inspection_id, rule_id, title, category, severity, detected,
                               explanation, recommended_action, legal_reference, confidence,
                               evidence_region, state, officer_note, verified_by, verified_at, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state, officer_note = EXCLUDED.officer_note,
         verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at`,
      [
        v.id, i.id, v.ruleId, v.title, v.category, v.severity, v.detected, v.explanation,
        v.recommendedAction, v.legalReference, v.confidence,
        v.evidenceRegion ? JSON.stringify(v.evidenceRegion) : null, v.state,
        v.officerNote ?? null, v.verifiedBy ?? null, v.verifiedAt ?? null, index,
      ],
    );
  }

  for (const entry of i.auditLog) {
    await client.query(
      `INSERT INTO audit_log (id, inspection_id, at, actor, action, detail)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [entry.id, i.id, entry.at, entry.actor, entry.action, entry.detail ?? null],
    );
  }
}

export async function updateInspectionFields(
  id: string,
  patch: Partial<Pick<Inspection, 'stage' | 'status' | 'remarks' | 'reportId'>>,
) {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const map: Record<string, string> = {
    stage: 'stage',
    status: 'status',
    remarks: 'remarks',
    reportId: 'report_id',
  };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    values.push(value);
    sets.push(`${map[key]} = $${values.length}`);
  });
  if (sets.length === 0) return;
  await pool.query(`UPDATE inspections SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function updateViolation(
  id: string,
  patch: Partial<Pick<Violation, 'state' | 'officerNote' | 'verifiedBy' | 'verifiedAt'>>,
) {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const map: Record<string, string> = {
    state: 'state',
    officerNote: 'officer_note',
    verifiedBy: 'verified_by',
    verifiedAt: 'verified_at',
  };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    values.push(value);
    sets.push(`${map[key]} = $${values.length}`);
  });
  if (sets.length === 0) return;
  await pool.query(`UPDATE violations SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function appendAudit(inspectionId: string, entry: AuditLogEntry) {
  await pool.query(
    `INSERT INTO audit_log (id, inspection_id, at, actor, action, detail)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
    [entry.id, inspectionId, entry.at, entry.actor, entry.action, entry.detail ?? null],
  );
}

/* ---------------------------------------------------------------- Evidence */

export const toEvidence = (r: Row): Evidence => ({
  id: r.id,
  inspectionId: r.inspection_id,
  evidenceNumber: r.evidence_number,
  type: r.type,
  imageId: r.image_id,
  dataUrl: r.data_url ?? undefined,
  description: r.description ?? '',
  capturedAt: iso(r.captured_at),
  uploadedBy: r.uploaded_by,
  checksum: r.checksum,
});

export async function listEvidence(): Promise<Evidence[]> {
  const { rows } = await pool.query('SELECT * FROM evidence ORDER BY captured_at DESC');
  return rows.map(toEvidence);
}

export async function insertEvidence(e: Evidence, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO evidence (id, inspection_id, evidence_number, type, image_id, data_url,
                           description, captured_at, uploaded_by, checksum)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [
      e.id, e.inspectionId, e.evidenceNumber, e.type, e.imageId, e.dataUrl ?? null,
      e.description, e.capturedAt, e.uploadedBy, e.checksum,
    ],
  );
}

export async function deleteEvidence(id: string) {
  await pool.query('DELETE FROM evidence WHERE id = $1', [id]);
}

/* ----------------------------------------------------------------- Reports */

export const toReport = (r: Row): Report => ({
  id: r.id,
  inspectionId: r.inspection_id,
  productName: r.product_name,
  brand: r.brand,
  generatedAt: iso(r.generated_at),
  generatedBy: r.generated_by,
  status: r.status,
  format: r.format,
  screeningScore: r.screening_score,
  complianceStatus: r.compliance_status,
  violationCount: r.violation_count,
});

export async function listReports(): Promise<Report[]> {
  const { rows } = await pool.query('SELECT * FROM reports ORDER BY generated_at DESC');
  return rows.map(toReport);
}

export async function upsertReport(r: Report, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO reports (id, inspection_id, product_name, brand, generated_at, generated_by,
                          status, format, screening_score, compliance_status, violation_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       generated_at = EXCLUDED.generated_at, generated_by = EXCLUDED.generated_by,
       status = EXCLUDED.status, format = EXCLUDED.format,
       screening_score = EXCLUDED.screening_score, compliance_status = EXCLUDED.compliance_status,
       violation_count = EXCLUDED.violation_count`,
    [
      r.id, r.inspectionId, r.productName, r.brand, r.generatedAt, r.generatedBy, r.status,
      r.format, r.screeningScore, r.complianceStatus, r.violationCount,
    ],
  );
}

export async function setReportStatus(id: string, status: Report['status']) {
  await pool.query('UPDATE reports SET status = $2 WHERE id = $1', [id, status]);
}

/* ----------------------------------------------------------- Notifications */

export const toNotification = (r: Row): AppNotification => ({
  id: r.id,
  title: r.title,
  body: r.body,
  priority: r.priority,
  category: r.category,
  createdAt: iso(r.created_at),
  read: r.read,
  link: r.link ?? undefined,
});

export async function listNotifications(): Promise<AppNotification[]> {
  const { rows } = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
  return rows.map(toNotification);
}

export async function insertNotification(n: AppNotification, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO notifications (id, title, body, priority, category, link, read, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [n.id, n.title, n.body, n.priority, n.category, n.link ?? null, n.read, n.createdAt],
  );
}

export async function markNotifications(ids: string[] | 'ALL', read: boolean) {
  if (ids === 'ALL') {
    await pool.query('UPDATE notifications SET read = $1', [read]);
    return;
  }
  await pool.query('UPDATE notifications SET read = $2 WHERE id = ANY($1)', [ids, read]);
}

export async function deleteNotification(id: string) {
  await pool.query('DELETE FROM notifications WHERE id = $1', [id]);
}

/* ---------------------------------------------------------------- Counters */

export async function nextInspectionSequence(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO counters (name, value) VALUES ('inspection', 1001)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
  );
  return rows[0].value;
}
