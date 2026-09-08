import type {
  Declaration,
  DeclarationKey,
  EvidenceRegion,
  OcrResult,
  OcrToken,
  ReadabilityMetric,
} from '@shared/types';
import type { DemoCase, ExtractedField } from '@shared/data/demoProducts';
import { toBox } from '@shared/data/labelImages';
import { delay } from '@shared/lib/utils';
import {
  DECLARATION_LABELS,
  DECLARATION_ORDER,
  DEFAULT_MIN_HEIGHT_MM,
} from '@shared/data/declarations';

export { DECLARATION_LABELS, DECLARATION_ORDER };

/**
 * OCR + declaration-extraction service (mock implementation).
 *
 * Replace `runOcr` with a call to POST /api/v1/ocr:extract and the rest of the
 * application continues to work unchanged — the contract is the OcrResult +
 * Declaration[] pair returned below.
 */


export function pxToMm(px: number, dpi: number) {
  return (px / dpi) * 25.4;
}

export function pxToPt(px: number, dpi: number) {
  return (px / dpi) * 72;
}

function buildReadability(
  field: ExtractedField,
  dpi: number,
  minMm = DEFAULT_MIN_HEIGHT_MM,
): ReadabilityMetric | undefined {
  if (!field.textHeightPx) return undefined;
  const estimatedMm = Number(pxToMm(field.textHeightPx, dpi).toFixed(2));
  const contrastRatio = field.contrastRatio ?? 9;
  const ocrConfidence = field.confidence;

  let status: ReadabilityMetric['status'] = 'GOOD';
  if (estimatedMm < minMm * 0.95 || contrastRatio < 3) status = 'POOR';
  else if (estimatedMm < minMm * 1.12 || contrastRatio < 4.5 || ocrConfidence < 0.85) status = 'REVIEW';

  return {
    textHeightPx: field.textHeightPx,
    estimatedFontPt: Number(pxToPt(field.textHeightPx, dpi).toFixed(1)),
    requiredMinMm: minMm,
    estimatedMm,
    contrastRatio,
    ocrConfidence,
    status,
    // The demo corpus is rendered at a known DPI, so its scale is genuine.
    scaleKnown: true,
  };
}

function buildRegion(key: DeclarationKey, imageId: string): EvidenceRegion {
  return {
    id: `rgn-${key.toLowerCase()}`,
    imageId,
    box: toBox(key),
    label: DECLARATION_LABELS[key],
  };
}

export function buildDeclarations(demo: DemoCase): Declaration[] {
  const dpi = demo.ocrMeta.estimatedDpi;
  return DECLARATION_ORDER.map((key) => {
    const field = demo.extraction[key];
    if (!field) {
      return {
        key,
        label: DECLARATION_LABELS[key],
        detectedValue: null,
        confidence: 0.9,
      } satisfies Declaration;
    }
    return {
      key,
      label: DECLARATION_LABELS[key],
      detectedValue: field.value,
      rawText: field.value ?? undefined,
      confidence: field.confidence,
      region: field.value ? buildRegion(key, demo.label.imageId) : undefined,
      readability: field.value ? buildReadability(field, dpi) : undefined,
    } satisfies Declaration;
  });
}

function buildTokens(demo: DemoCase): OcrToken[] {
  return DECLARATION_ORDER.flatMap((key) => {
    const field = demo.extraction[key];
    if (!field?.value) return [];
    return [{ text: field.value, confidence: field.confidence, box: toBox(key) }];
  });
}

export function buildRawText(demo: DemoCase): string {
  const lines: string[] = [demo.label.brand.toUpperCase(), demo.label.descriptor];
  DECLARATION_ORDER.forEach((key) => {
    const field = demo.extraction[key];
    if (field?.value) lines.push(`${DECLARATION_LABELS[key]}: ${field.value}`);
  });
  if (demo.label.barcode) lines.push(`Barcode: ${demo.label.barcode}`);
  return lines.join('\n');
}

export interface OcrPass {
  ocr: OcrResult;
  declarations: Declaration[];
}

/** Mock inference pass. Latency is simulated so the workspace animation is honest. */
export async function runOcr(demo: DemoCase, simulateLatencyMs = 0): Promise<OcrPass> {
  if (simulateLatencyMs) await delay(simulateLatencyMs);
  const tokens = buildTokens(demo);
  const declarations = buildDeclarations(demo);
  const detected = declarations.filter((d) => d.detectedValue);
  const averageConfidence =
    detected.reduce((sum, d) => sum + d.confidence, 0) / Math.max(detected.length, 1);

  return {
    ocr: {
      imageId: demo.label.imageId,
      engine: demo.ocrMeta.engine,
      processingMs: 1180 + Math.round(Math.random() * 420),
      rawText: buildRawText(demo),
      tokens,
      averageConfidence: Number(averageConfidence.toFixed(3)),
      imageWidth: demo.ocrMeta.imageWidth,
      imageHeight: demo.ocrMeta.imageHeight,
      estimatedDpi: demo.ocrMeta.estimatedDpi,
    },
    declarations,
  };
}

/*
 * Uploaded photographs are NOT handled here. They are sent to the OCR service
 * (POST /api/ocr) which runs Tesseract over the actual pixels and returns the
 * declarations it read. The previous filename-matching heuristic returned the
 * same demo profile for every upload and has been removed.
 */
