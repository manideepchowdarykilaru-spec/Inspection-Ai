import type { ComplianceRule } from '@shared/types';
import type { DemoCase } from '@shared/data/demoProducts';
import { delay } from '@shared/lib/utils';
import { deriveViolations } from '@shared/rules/ruleEngine';
import { PIPELINE_STAGES, type PipelineResult, type StageId } from '@shared/pipeline';
import * as api from './api';

/* The stage list, result shape and synchronous evaluation are shared with the API. */
export {
  PIPELINE_STAGES,
  buildInspection,
  evaluateCase,
  nextInspectionId,
  type PipelineResult,
  type PipelineStage,
  type StageId,
} from '@shared/pipeline';

export interface PipelineOptions {
  inspectionId: string;
  rules?: ComplianceRule[];
  /** Set false to compute synchronously (used when seeding historical data). */
  animate?: boolean;
  speed?: number;
  onStage?: (stage: StageId, index: number, total: number) => void;
  onComplete?: (stage: StageId) => void;
  /** Photograph to read. When absent the stored demo label is analysed instead. */
  dataUrl?: string;
  /** All photographed panels; overrides dataUrl when present. */
  images?: api.ScanImageInput[];
  /** Physical width of the photographed panel, enabling print-height measurement. */
  panelWidthMm?: number;
}

/**
 * Runs the pipeline for a scan.
 *
 * The analysis itself happens on the server — Tesseract reads an uploaded
 * photograph, and the same rule engine module evaluates the declarations. The
 * stage animation runs concurrently with the request so the workspace reflects
 * real progress without waiting for OCR before showing anything.
 */
export async function runCompliancePipeline(
  demo: DemoCase,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { inspectionId, animate = true, speed = 1, onStage, onComplete } = options;

  const hasPhotos = Boolean(options.images?.length || options.dataUrl);
  const analysis = api.scan({
    imageId: demo.label.imageId,
    caseId: hasPhotos ? undefined : demo.id,
    dataUrl: options.images?.length ? undefined : options.dataUrl,
    images: options.images,
    panelWidthMm: options.panelWidthMm,
  });

  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i];
    onStage?.(stage.id, i, PIPELINE_STAGES.length);
    if (animate) await delay(stage.duration / speed);
    // The scoring stage cannot complete before the server has answered.
    if (stage.id === 'score') await analysis;
    onComplete?.(stage.id);
  }

  const result = await analysis;
  return {
    ocr: result.ocr,
    quality: result.quality,
    preprocessing: result.preprocessing,
    perImage: result.perImage,
    declarations: result.declarations,
    ruleResults: result.ruleResults,
    score: result.score,
    breakdown: result.breakdown,
    status: result.status,
    // Findings are keyed to the inspection once it is given an identifier.
    violations: deriveViolations(result.ruleResults, inspectionId),
  };
}
