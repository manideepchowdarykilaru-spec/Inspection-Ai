/**
 * Domain model for LM-Inspect AI.
 * These interfaces mirror the intended relational schema (see docs/ARCHITECTURE.md)
 * so the mock services can be swapped for real API calls without UI changes.
 */

/* ------------------------------------------------------------------ Users */

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'INSPECTOR';
/** PENDING: registered through the access-request form, awaiting administrator approval. */
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING' | 'REJECTED';

export interface User {
  id: string;
  officialId: string;
  name: string;
  email: string;
  role: UserRole;
  designation: string;
  department: string;
  region: string;
  phone: string;
  avatarInitials: string;
  status: UserStatus;
  lastActiveAt: string;
  createdAt: string;
  /** Set when an access request was approved or rejected. */
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

/* --------------------------------------------------------------- Products */

export type ProductCategory =
  | 'Cereals & Grains'
  | 'Spices & Condiments'
  | 'Bakery & Confectionery'
  | 'Edible Oils'
  | 'Beverages'
  | 'Personal Care'
  | 'Home Care'
  | 'Snacks & Namkeen'
  | 'Dairy'
  | 'Imported Goods';

/** Runtime list backing the category selector; mirrors ProductCategory. */
export const PRODUCT_CATEGORIES = [
  'Cereals & Grains',
  'Spices & Condiments',
  'Bakery & Confectionery',
  'Edible Oils',
  'Beverages',
  'Personal Care',
  'Home Care',
  'Snacks & Namkeen',
  'Dairy',
  'Imported Goods',
] as const satisfies readonly ProductCategory[];

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  manufacturer: string;
  manufacturerAddress: string;
  packer?: string;
  importer?: string;
  countryOfOrigin: string;
  netQuantity: string;
  mrp: number;
  packedOn?: string;
  bestBefore?: string;
  consumerCare?: string;
  fssaiLicense?: string;
  barcode: string;
  batchNumber?: string;
  imageId: string;
  createdAt: string;
  lastInspectedAt?: string;
  inspectionCount: number;
  latestScore?: number;
  latestStatus?: ComplianceStatus;
  openViolations: number;
  repeatOffender: boolean;
}

/* ----------------------------------------------------------- Declarations */

/** Mandatory + conditional declarations tracked under LMPC Rules, 2011 (Rule 6). */
export type DeclarationKey =
  | 'PRODUCT_IDENTITY'
  | 'MANUFACTURER_NAME'
  | 'MANUFACTURER_ADDRESS'
  | 'NET_QUANTITY'
  | 'MRP'
  | 'CONSUMER_CARE'
  | 'DATE_OF_PACKING'
  | 'COUNTRY_OF_ORIGIN'
  | 'IMPORTER_DETAILS'
  | 'BEST_BEFORE'
  | 'FSSAI_LICENSE'
  | 'BATCH_NUMBER';

export interface BoundingBox {
  /** Normalised 0..1 coordinates relative to the source image. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EvidenceRegion {
  id: string;
  imageId: string;
  box: BoundingBox;
  label: string;
}

export interface Declaration {
  key: DeclarationKey;
  label: string;
  detectedValue: string | null;
  rawText?: string;
  confidence: number;
  region?: EvidenceRegion;
  /** Readability metrics derived from the OCR bounding box and image DPI. */
  readability?: ReadabilityMetric;
  /** Set when the declaration is not required for this package (e.g. importer on an Indian-origin pack), with the reason. */
  notApplicable?: string;
}

export interface ReadabilityMetric {
  textHeightPx: number;
  estimatedFontPt: number;
  /** Second Schedule minimum height in mm for the principal display panel. */
  requiredMinMm: number;
  estimatedMm: number;
  contrastRatio: number;
  ocrConfidence: number;
  status: 'GOOD' | 'REVIEW' | 'POOR';
  /**
   * False when the physical scale of the photograph is unknown, in which case
   * estimatedMm is not a measurement and the readability rule must defer to
   * physical verification rather than assert a breach.
   */
  scaleKnown: boolean;
}

/* --------------------------------------------------------------- OCR pass */

export interface OcrToken {
  text: string;
  confidence: number;
  box: BoundingBox;
}

export interface OcrResult {
  imageId: string;
  engine: string;
  processingMs: number;
  rawText: string;
  tokens: OcrToken[];
  averageConfidence: number;
  imageWidth: number;
  imageHeight: number;
  estimatedDpi: number;
}

/* ------------------------------------------------------------- Rule engine */

export type RuleStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type ValidationType =
  | 'PRESENCE'
  | 'FORMAT'
  | 'NUMERIC_RANGE'
  | 'READABILITY'
  | 'CONDITIONAL_PRESENCE'
  | 'CROSS_FIELD';

export type RuleCategory =
  | 'Mandatory Declaration'
  | 'Formatting'
  | 'Readability'
  | 'Packaging Information'
  | 'Import Compliance';

export interface ComplianceRule {
  id: string;
  name: string;
  category: RuleCategory;
  legalReference: string;
  description: string;
  declarationKey?: DeclarationKey;
  validationType: ValidationType;
  mandatory: boolean;
  severity: Severity;
  weight: number;
  active: boolean;
  /** Configurable parameters, e.g. { minHeightMm: 1.5 } */
  params?: Record<string, number | string>;
  updatedAt: string;
  updatedBy: string;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  legalReference: string;
  declarationKey?: DeclarationKey;
  detectedValue: string | null;
  expectation: string;
  status: RuleStatus;
  severity: Severity;
  confidence: number;
  explanation: string;
  evidenceRegion?: EvidenceRegion;
  weight: number;
}

/* -------------------------------------------------------------- Violations */

export type ViolationState = 'OPEN' | 'VERIFIED' | 'DISMISSED';

export interface Violation {
  id: string;
  inspectionId: string;
  ruleId: string;
  title: string;
  category: RuleCategory;
  severity: Severity;
  detected: string;
  explanation: string;
  recommendedAction: string;
  legalReference: string;
  confidence: number;
  evidenceRegion?: EvidenceRegion;
  state: ViolationState;
  officerNote?: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

/* ------------------------------------------------------------- Inspections */

export type ComplianceStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_REVIEW' | 'NOT_DETECTED';
export type InspectionStage = 'DRAFT' | 'SCANNING' | 'AI_COMPLETE' | 'UNDER_REVIEW' | 'CLOSED';

export interface ScoreBreakdown {
  mandatoryDeclarations: { score: number; max: number };
  formatting: { score: number; max: number };
  readability: { score: number; max: number };
  packagingInformation: { score: number; max: number };
}

export interface Inspection {
  id: string;
  productId: string;
  productName: string;
  brand: string;
  category: ProductCategory;
  inspectorId: string;
  inspectorName: string;
  region: string;
  location: string;
  inspectedAt: string;
  source: 'PACKAGE_SCAN' | 'E_COMMERCE_LISTING' | 'MANUAL_ENTRY';
  stage: InspectionStage;
  status: ComplianceStatus;
  screeningScore: number;
  scoreBreakdown: ScoreBreakdown;
  declarations: Declaration[];
  ruleResults: RuleResult[];
  violations: Violation[];
  evidenceIds: string[];
  ocr?: OcrResult;
  remarks?: string;
  reportId?: string;
  auditLog: AuditLogEntry[];
}

/* ---------------------------------------------------------------- Evidence */

export type EvidenceType =
  | 'PRODUCT_PHOTO'
  | 'LABEL_PHOTO'
  | 'MRP_PHOTO'
  | 'MANUFACTURER_DETAILS'
  | 'BARCODE'
  | 'ADDITIONAL';

export interface Evidence {
  id: string;
  inspectionId: string;
  evidenceNumber: string;
  type: EvidenceType;
  imageId: string;
  /** Data URL for user uploads; undefined for seeded synthetic label renders. */
  dataUrl?: string;
  description: string;
  capturedAt: string;
  uploadedBy: string;
  /** Integrity digest shown in the evidence chain-of-custody UI. */
  checksum: string;
}

/* ----------------------------------------------------------------- Reports */

export type ReportStatus = 'DRAFT' | 'FINALISED' | 'SHARED' | 'ARCHIVED';

export interface Report {
  id: string;
  inspectionId: string;
  productName: string;
  brand: string;
  generatedAt: string;
  generatedBy: string;
  status: ReportStatus;
  format: 'PDF' | 'DOCX';
  screeningScore: number;
  complianceStatus: ComplianceStatus;
  violationCount: number;
}

/* --------------------------------------------------------------- Audit log */

export interface AuditLogEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

/* ----------------------------------------------------------- Notifications */

export type NotificationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  category: 'INSPECTION' | 'VIOLATION' | 'REPORT' | 'SYSTEM';
  createdAt: string;
  read: boolean;
  link?: string;
}

/* -------------------------------------------------------------- Analytics */

export interface TrendPoint {
  period: string;
  inspections: number;
  compliant: number;
  nonCompliant: number;
  needsReview: number;
  complianceRate: number;
}

export interface CategoryStat {
  name: string;
  inspections: number;
  compliant: number;
  complianceRate: number;
}

export interface ViolationStat {
  code: string;
  name: string;
  count: number;
  previousCount: number;
  severity: Severity;
}

export interface RegionStat {
  region: string;
  inspections: number;
  violations: number;
  complianceRate: number;
}

export interface DashboardMetrics {
  totalInspections: number;
  compliant: number;
  nonCompliant: number;
  needsReview: number;
  complianceRate: number;
  violationsDetected: number;
  deltas: Record<string, number>;
}

export interface AnalyticsInsight {
  id: string;
  tone: 'positive' | 'negative' | 'neutral';
  headline: string;
  detail: string;
}

/* ------------------------------------------------------------ OCR contract */
/* Shapes exchanged between the API's OCR routes and the app. */

export interface ScanImageInput {
  imageId: string;
  name?: string;
  dataUrl: string;
}

export interface OcrQuality {
  medianCapHeightPx: number;
  meanConfidence: number;
  declarationsFound: number;
  wordsRead: number;
  passUsed: string;
  upscaleApplied: number;
  refocused: boolean;
  /** False when the photograph shows no printed panel at all — nothing to analyse. */
  labelDetected: boolean;
  level: 'GOOD' | 'MARGINAL' | 'POOR';
  advice?: string;
}

export interface PreprocessingSummary {
  sourceWidth: number;
  sourceHeight: number;
  workingWidth: number;
  workingHeight: number;
  inverted: boolean;
  skewDeg: number;
  /** 90° turns applied because the text was photographed sideways. */
  quarterTurns: number;
  /** 'pca' when a colour projection separated print from panel better than luminance. */
  greyMethod: 'luma' | 'pca';
  /** Keystone removed by perspective rectification, as a fraction of the long edge. */
  perspectiveKeystone: number;
  upscale: number;
  sauvolaWindow: number;
  medianLuminance: number;
  stages: string[];
  /** PNG data URL of the image the recogniser actually read. */
  previewDataUrl: string;
  variantUsed: 'normalised' | 'binarised';
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
  /** Declaration section the line was classified into by the NLP tagger; absent when OTHER or unsure. */
  section?: DeclarationKey;
  sectionConfidence?: number;
}

export interface PerImageSummary {
  imageId: string;
  name: string;
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  lines: OcrLine[];
  declarationsFound: string[];
  processingMs: number;
}

/* ----------------------------------------------------------- Auth contract */

export interface LoginRequest {
  /** Official ID or departmental e-mail. */
  identifier: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  user: User;
  /** Signed bearer token; sent as Authorization: Bearer … on every API call. */
  token: string;
  issuedAt: string;
  expiresAt: string;
}

export interface RegisterRequest {
  name: string;
  officialId: string;
  email: string;
  phone: string;
  designation?: string;
  region: string;
  role: 'INSPECTOR' | 'SUPERVISOR';
  password: string;
}

export interface AccessReviewRequest {
  decision: 'APPROVE' | 'REJECT';
  /** The administrator may correct the requested role, region or designation while approving. */
  role?: UserRole;
  region?: string;
  designation?: string;
  /** Required for a rejection; optional remark for an approval. */
  note?: string;
}

export interface ForgotPasswordRequest {
  identifier: string;
}

export interface ForgotPasswordResponse {
  ok: true;
  /** Where the code was sent, masked for display. */
  maskedPhone: string;
  maskedEmail: string;
  expiresInMinutes: number;
  /** Channels that actually carried the code. Empty when no provider is configured. */
  channels: ('email' | 'sms')[];
  /** Present only when no channel delivered the code, so the flow can still be completed. */
  demoCode?: string;
  /** Why a configured channel did not deliver, if that happened. */
  deliveryNote?: string;
}

export interface ResetPasswordRequest {
  identifier: string;
  code: string;
  newPassword: string;
}
