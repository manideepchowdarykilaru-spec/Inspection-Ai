import type {
  ComplianceRule,
  ComplianceStatus,
  Declaration,
  Inspection,
  OcrQuality,
  OcrResult,
  PerImageSummary,
  PreprocessingSummary,
  RuleResult,
  ScoreBreakdown,
  User,
  Violation,
} from '@shared/types';
import type { DemoCase } from '@shared/data/demoProducts';
import { COMPLIANCE_RULES } from '@shared/data/rules';
import { toBox } from '@shared/data/labelImages';
import { uid } from '@shared/lib/utils';
import { buildDeclarations, buildRawText } from '@shared/ocr/demoOcr';
import { determineStatus, deriveViolations, evaluateRules, scoreResults } from '@shared/rules/ruleEngine';

/**
 * Pipeline definition and synchronous evaluation.
 *
 * IMAGE → PREPROCESS → OCR → DECLARATION DETECTION → FIELD CLASSIFICATION →
 * RULE ENGINE → VIOLATION DERIVATION → SCORING
 *
 * The stage list drives the workspace progress panel; evaluateCase and
 * buildInspection are used by the database seed and by the client when a rule
 * is edited, so they live here where both the API and the app can import them.
 */

export type StageId =
  | 'preprocess'
  | 'ocr'
  | 'detect'
  | 'classify'
  | 'readability'
  | 'rules'
  | 'score';

export interface PipelineStage {
  id: StageId;
  label: string;
  detail: string;
  /** Nominal duration in ms used by the mock runner. */
  duration: number;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'preprocess', label: 'Image preprocessing', detail: 'Orientation · colour · perspective · deskew · adaptive threshold', duration: 620 },
  { id: 'ocr', label: 'OCR text extraction', detail: 'Tesseract LSTM recognition · multi-pass merge', duration: 900 },
  { id: 'detect', label: 'Declaration detection', detail: 'Layout analysis over recognised text blocks', duration: 640 },
  { id: 'classify', label: 'Field classification', detail: 'Entity tagging of mandatory declarations', duration: 620 },
  { id: 'readability', label: 'Readability analysis', detail: 'Print height, contrast and legibility estimation', duration: 560 },
  { id: 'rules', label: 'Rule validation', detail: 'Legal Metrology rule engine evaluation', duration: 700 },
  { id: 'score', label: 'Compliance scoring', detail: 'Weighted screening score and findings', duration: 480 },
];

export interface PipelineResult {
  ocr: OcrResult;
  /** Present for OCR scans; absent for the demonstration corpus. */
  quality?: OcrQuality;
  preprocessing?: PreprocessingSummary;
  perImage?: PerImageSummary[];
  declarations: Declaration[];
  ruleResults: RuleResult[];
  violations: Violation[];
  score: number;
  breakdown: ScoreBreakdown;
  status: ComplianceStatus;
}

/** Synchronous evaluation used for seeding and for re-running after rule edits. */
export function evaluateCase(
  demo: DemoCase,
  inspectionId: string,
  rules: ComplianceRule[] = COMPLIANCE_RULES,
): PipelineResult {
  const declarations = buildDeclarationsSync(demo);
  const ruleResults = evaluateRules(declarations, rules);
  const { score, breakdown } = scoreResults(ruleResults);
  return {
    ocr: buildOcrSync(demo, declarations),
    declarations,
    ruleResults,
    violations: deriveViolations(ruleResults, inspectionId),
    score,
    breakdown,
    status: determineStatus(ruleResults, score),
  };
}

/* The sync helpers mirror ocrService without the promise wrapper. */

function buildDeclarationsSync(demo: DemoCase): Declaration[] {
  return buildDeclarations(demo);
}

function buildOcrSync(demo: DemoCase, declarations: Declaration[]): OcrResult {
  const detected = declarations.filter((d) => d.detectedValue);
  return {
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
}

export function nextInspectionId(sequence: number) {
  return `LM-2026-${String(sequence).padStart(4, '0')}`;
}

export function buildInspection(params: {
  id: string;
  demo: DemoCase;
  result: PipelineResult;
  productId: string;
  inspector: Pick<User, 'id' | 'name' | 'region'>;
  location: string;
  inspectedAt?: string;
  evidenceIds?: string[];
  source?: Inspection['source'];
  stage?: Inspection['stage'];
  remarks?: string;
}): Inspection {
  const at = params.inspectedAt ?? new Date().toISOString();
  return {
    id: params.id,
    productId: params.productId,
    productName: params.demo.productName,
    brand: params.demo.brand,
    category: params.demo.category,
    inspectorId: params.inspector.id,
    inspectorName: params.inspector.name,
    region: params.inspector.region,
    location: params.location,
    inspectedAt: at,
    source: params.source ?? 'PACKAGE_SCAN',
    stage: params.stage ?? 'AI_COMPLETE',
    status: params.result.status,
    screeningScore: params.result.score,
    scoreBreakdown: params.result.breakdown,
    declarations: params.result.declarations,
    ruleResults: params.result.ruleResults,
    violations: params.result.violations,
    evidenceIds: params.evidenceIds ?? [],
    ocr: params.result.ocr,
    remarks: params.remarks,
    auditLog: [
      {
        id: uid('log'),
        at,
        actor: params.inspector.name,
        action: 'Product image captured and uploaded',
        detail: `${params.demo.productName} · ${params.demo.brand}`,
      },
      {
        id: uid('log'),
        at: new Date(new Date(at).getTime() + 62_000).toISOString(),
        actor: 'LM-Inspect AI Engine',
        action: 'AI screening completed',
        detail: `${params.result.ruleResults.length} rules evaluated · score ${params.result.score}/100`,
      },
    ],
  };
}
