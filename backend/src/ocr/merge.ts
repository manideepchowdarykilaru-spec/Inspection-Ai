import type { Declaration, DeclarationKey, OcrResult } from '@shared/types';
import { DECLARATION_LABELS, DECLARATION_ORDER } from '@shared/data/declarations';
import type { OcrLine, OcrQuality, OcrResponse, PreprocessingSummary } from './index';

/**
 * Merges the readings of several panels of one package.
 *
 * The mandatory declarations are rarely all on one face: the retail price sits
 * on the front, the manufacturer and consumer-care block on the back, the batch
 * and dates on a flap. Each image is recognised on its own, then for every
 * declaration the most confident reading across the set is kept. A region keeps
 * the imageId of the panel it was read from, so the evidence overlay can always
 * show the right photograph.
 */

export interface ImageReading {
  imageId: string;
  name: string;
  response: OcrResponse;
}

export interface PerImageSummary {
  imageId: string;
  name: string;
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  lines: OcrLine[];
  declarationsFound: DeclarationKey[];
  processingMs: number;
}

export interface MergedReading {
  ocr: OcrResult;
  declarations: Declaration[];
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  lines: OcrLine[];
  perImage: PerImageSummary[];
}

/** Prefers confidence, then completeness (a longer read of an address beats a fragment). */
function betterOf(a: Declaration, b: Declaration): Declaration {
  if (Math.abs(a.confidence - b.confidence) > 0.08) return a.confidence > b.confidence ? a : b;
  return (a.detectedValue?.length ?? 0) >= (b.detectedValue?.length ?? 0) ? a : b;
}

export function mergeReadings(readings: ImageReading[]): MergedReading {
  if (readings.length === 0) throw new Error('mergeReadings requires at least one reading');
  if (readings.length === 1) {
    const only = readings[0];
    return {
      ...only.response,
      perImage: [summarise(only)],
    };
  }

  const declarations: Declaration[] = DECLARATION_ORDER.map((key) => {
    const candidates = readings
      .map((r) => r.response.declarations.find((d) => d.key === key))
      .filter((d): d is Declaration => Boolean(d?.detectedValue));

    if (candidates.length === 0) {
      const misses = readings
        .map((r) => r.response.declarations.find((d) => d.key === key))
        .filter((d): d is Declaration => Boolean(d));
      const confidence =
        misses.reduce((s, d) => s + d.confidence, 0) / Math.max(misses.length, 1);
      const notApplicable = misses.find((d) => d.notApplicable)?.notApplicable;
      return { key, label: DECLARATION_LABELS[key], detectedValue: null, confidence: Number(confidence.toFixed(2)), ...(notApplicable ? { notApplicable } : {}) };
    }
    return candidates.reduce(betterOf);
  });

  const primary = readings[0];
  const detected = declarations.filter((d) => d.detectedValue);
  const foundPerImage = readings.map((r) => r.response.declarations.filter((d) => d.detectedValue).length);

  const ocr: OcrResult = {
    imageId: primary.imageId,
    engine: primary.response.ocr.engine,
    processingMs: readings.reduce((s, r) => s + r.response.ocr.processingMs, 0),
    rawText: readings
      .map((r, i) => `--- Image ${i + 1} of ${readings.length}: ${r.name} ---\n${r.response.ocr.rawText}`)
      .join('\n\n'),
    tokens: readings.flatMap((r) => r.response.ocr.tokens),
    averageConfidence: Number(
      (detected.reduce((s, d) => s + d.confidence, 0) / Math.max(detected.length, 1)).toFixed(3),
    ),
    imageWidth: primary.response.ocr.imageWidth,
    imageHeight: primary.response.ocr.imageHeight,
    estimatedDpi: primary.response.ocr.estimatedDpi,
  };

  const qualities = readings.map((r) => r.response.quality);
  const anyGood = qualities.some((q) => q.level === 'GOOD');
  const poorImages = readings.filter((r) => r.response.quality.level === 'POOR');
  const meanConfidence = qualities.reduce((s, q) => s + q.meanConfidence, 0) / qualities.length;

  let level: OcrQuality['level'];
  if (detected.length >= 8 && anyGood) level = 'GOOD';
  else if (detected.length >= 4) level = 'MARGINAL';
  else level = 'POOR';

  const advice =
    level === 'GOOD' && poorImages.length === 0
      ? undefined
      : [
          poorImages.length
            ? `${poorImages.length === 1 ? 'One image' : `${poorImages.length} images`} (${poorImages
                .map((r) => r.name)
                .join(', ')}) could not be read reliably and contributed little.`
            : '',
          detected.length < 8
            ? `Across ${readings.length} images only ${detected.length} of 12 declarations were located. Photograph the panels that carry the missing declarations from 15–20 cm, flat and parallel to the lens.`
            : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined;

  const quality: OcrQuality = {
    medianCapHeightPx: Math.min(...qualities.map((q) => q.medianCapHeightPx)),
    meanConfidence: Number(meanConfidence.toFixed(2)),
    declarationsFound: detected.length,
    wordsRead: qualities.reduce((s, q) => s + q.wordsRead, 0),
    passUsed: `${readings.length} images merged · best of ${foundPerImage.join('/')}`,
    upscaleApplied: primary.response.quality.upscaleApplied,
    refocused: qualities.some((q) => q.refocused),
    labelDetected: qualities.some((q) => q.labelDetected),
    level,
    advice,
  };

  return {
    ocr,
    declarations,
    quality,
    preprocessing: primary.response.preprocessing,
    lines: readings.flatMap((r) => r.response.lines),
    perImage: readings.map(summarise),
  };
}

function summarise(r: ImageReading): PerImageSummary {
  return {
    imageId: r.imageId,
    name: r.name,
    quality: r.response.quality,
    preprocessing: r.response.preprocessing,
    lines: r.response.lines,
    declarationsFound: r.response.declarations.filter((d) => d.detectedValue).map((d) => d.key),
    processingMs: r.response.ocr.processingMs,
  };
}
