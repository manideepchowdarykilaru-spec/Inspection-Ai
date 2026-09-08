import type {
  AppNotification,
  ComplianceRule,
  Declaration,
  Evidence,
  Inspection,
  OcrResult,
  Product,
  Report,
  RuleResult,
  ScoreBreakdown,
  ComplianceStatus,
  User,
  Violation,
  AuditLogEntry,
  ScanImageInput,
  OcrQuality,
  PreprocessingSummary,
  OcrLine,
  PerImageSummary,
} from '@shared/types';

/**
 * HTTP client for the LM-Inspect API.
 *
 * In development Vite proxies /api to the Express server, so the same relative
 * paths work in both environments.
 */

/**
 * Empty in the browser, where Vite proxies /api to the Express server.
 * `import.meta.env` is absent under plain Node, which imports this module
 * transitively when seeding the database — hence the optional access.
 */
const BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const detail = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new ApiError(detail.error ?? response.statusText, response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/* ------------------------------------------------------------- Bootstrap */

export interface BootstrapPayload {
  users: User[];
  products: Product[];
  inspections: Inspection[];
  evidence: Evidence[];
  reports: Report[];
  notifications: AppNotification[];
  rules: ComplianceRule[];
}

export const bootstrap = () => request<BootstrapPayload>('/api/bootstrap');

export const health = () =>
  request<{ ok: boolean; database: string; inspections: number }>('/api/health');

/* ------------------------------------------------------------------ Scan */

/* Request/response shapes shared with the API live in shared/types. */
export type { ScanImageInput, OcrQuality, PreprocessingSummary, OcrLine, PerImageSummary } from '@shared/types';

export interface ScanRequest {
  imageId: string;
  /** Base64 data URL — triggers a real OCR pass over the pixels. */
  dataUrl?: string;
  /** Every panel of the package; each is read and the best reading of each declaration kept. */
  images?: ScanImageInput[];
  /** Demo corpus id — uses the stored vector label instead of OCR. */
  caseId?: string;
  /** Physical width of the photographed panel, enabling print-height measurement. */
  panelWidthMm?: number;
}

export interface TextExtraction {
  rawText: string;
  lines: OcrLine[];
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  processingMs: number;
  imageWidth: number;
  imageHeight: number;
}

/** Plain OCR: every line the recogniser can read, plus what it read it from. */
export const extractText = (dataUrl: string) =>
  request<TextExtraction>('/api/ocr/text', { method: 'POST', body: JSON.stringify({ dataUrl }) });

export interface ScanResponse {
  source: 'OCR' | 'DEMO_CORPUS';
  quality?: OcrQuality;
  preprocessing?: PreprocessingSummary;
  lines?: OcrLine[];
  /** One entry per uploaded image when several panels were scanned. */
  perImage?: PerImageSummary[];
  ocr: OcrResult;
  declarations: Declaration[];
  ruleResults: RuleResult[];
  violations: Violation[];
  score: number;
  breakdown: ScoreBreakdown;
  status: ComplianceStatus;
}

export const scan = (body: ScanRequest) =>
  request<ScanResponse>('/api/scan', { method: 'POST', body: JSON.stringify(body) });

/* ----------------------------------------------------------- Inspections */

export const nextSequence = () =>
  request<{ sequence: number }>('/api/inspections/sequence').then((r) => r.sequence);

export const createInspection = (body: {
  inspection: Inspection;
  evidence: Evidence[];
  product: Product;
  notification?: AppNotification;
}) => request<{ id: string }>('/api/inspections', { method: 'POST', body: JSON.stringify(body) });

export const patchInspection = (
  id: string,
  patch: Partial<Inspection>,
  audit?: AuditLogEntry,
) =>
  request<{ ok: true }>(`/api/inspections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ patch, audit }),
  });

export const patchViolation = (
  id: string,
  body: { patch: Partial<Violation>; audit?: AuditLogEntry; inspectionId?: string; product?: Product },
) => request<{ ok: true }>(`/api/violations/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

/* -------------------------------------------------------------- Evidence */

export const addEvidence = (body: {
  evidence: Evidence;
  audit?: AuditLogEntry;
  inspectionId?: string;
}) => request<{ id: string }>('/api/evidence', { method: 'POST', body: JSON.stringify(body) });

export const removeEvidence = (
  id: string,
  body: { audit?: AuditLogEntry; inspectionId?: string },
) => request<{ ok: true }>(`/api/evidence/${id}`, { method: 'DELETE', body: JSON.stringify(body) });

/* --------------------------------------------------------------- Reports */

export const createReport = (body: {
  report: Report;
  audit?: AuditLogEntry;
  notification?: AppNotification;
}) => request<{ id: string }>('/api/reports', { method: 'POST', body: JSON.stringify(body) });

export const patchReport = (id: string, status: Report['status']) =>
  request<{ ok: true }>(`/api/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });

/* ----------------------------------------------------------------- Rules */

export const patchRule = (id: string, patch: Partial<ComplianceRule>) =>
  request<{ ok: true }>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/* ----------------------------------------------------------------- Users */

export const saveUser = (user: User) =>
  request<{ ok: true }>('/api/users', { method: 'POST', body: JSON.stringify(user) });

export const patchUserStatus = (id: string, status: User['status']) =>
  request<{ ok: true }>(`/api/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

/* --------------------------------------------------------- Notifications */

export const addNotification = (notification: AppNotification) =>
  request<{ ok: true }>('/api/notifications', {
    method: 'POST',
    body: JSON.stringify(notification),
  });

export const markNotifications = (ids: string[] | 'ALL', read: boolean) =>
  request<{ ok: true }>('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ ids, read }),
  });

export const deleteNotification = (id: string) =>
  request<{ ok: true }>(`/api/notifications/${id}`, { method: 'DELETE' });

/* ------------------------------------------------------------ Demo reset */

export const resetDemoData = () =>
  request<{ ok: true }>('/api/admin/reset', { method: 'POST' });
