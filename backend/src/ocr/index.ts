import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Declaration, DeclarationKey, OcrResult, ReadabilityMetric } from '@shared/types';
import type { FieldHit } from './extract';
import { DECLARATION_LABELS, DECLARATION_ORDER, DEFAULT_MIN_HEIGHT_MM } from '@shared/data/declarations';
import { buildSegments, normaliseBox, type Segment } from './segments';
import { extractFields } from './extract';
import { contrastForBoxes, loadImage, type LoadedImage } from './imageMetrics';
import {
  decodeSource,
  encodePng,
  preprocessForOcr,
  quickGrey,
  rotate90,
  toSourceBox,
  type PreprocessReport,
  type PreprocessVariant,
  type RgbaSource,
} from './preprocess';

/**
 * OCR over a photograph of a packaged commodity.
 *
 * Strategy:
 *   1. Preprocess into two variants — a lighting-flattened grey image and a
 *      Sauvola-binarised one — because neither wins on every package.
 *   2. Recognise both; keep whichever reads more declarations with more
 *      confidence.
 *   3. If the text occupies only part of the frame, crop to it and read again
 *      at full recogniser resolution (a label held at arm's length becomes a
 *      label filling the frame).
 *   4. If the read is still thin, retry with sparse-text segmentation.
 *
 * Every bounding box is mapped back onto the original photograph through the
 * exact geometry of the variant it came from, so the overlay, the readability
 * metrics and the contrast measurement all refer to the pixels the officer sees.
 */

const ENGINE = 'Tesseract 5 (tesseract.js) · eng';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function warmUp() {
  await getWorker();
}

export async function shutdown() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

/* ------------------------------------------------------------------ Types */

export interface OcrRequest {
  buffer: Buffer;
  imageId: string;
  /** Physical width of the photographed panel in mm; enables print-height measurement. */
  panelWidthMm?: number;
  minHeightMm?: number;
}

export interface OcrQuality {
  medianCapHeightPx: number;
  meanConfidence: number;
  declarationsFound: number;
  wordsRead: number;
  /** Variant + page-segmentation mode that produced the accepted read. */
  passUsed: string;
  upscaleApplied: number;
  /** True when the label was re-read from a crop of the frame. */
  refocused: boolean;
  level: 'GOOD' | 'MARGINAL' | 'POOR';
  advice?: string;
}

export interface PreprocessingSummary extends PreprocessReport {
  /** PNG data URL of the variant the accepted read came from. */
  previewDataUrl: string;
  variantUsed: 'normalised' | 'binarised';
}

export interface OcrLine {
  text: string;
  confidence: number;
  /** Normalised against the original image. */
  box: { x: number; y: number; w: number; h: number };
}

export interface OcrResponse {
  ocr: OcrResult;
  declarations: Declaration[];
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  lines: OcrLine[];
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

/* ------------------------------------------------------------ Recognition */

interface Pass {
  variant: PreprocessVariant;
  psm: string;
  result: Awaited<ReturnType<Worker['recognize']>>;
  segments: Segment[];
  fields: ReturnType<typeof extractFields>;
  /** Words the recogniser was reasonably sure about. */
  confidentWords: number;
  meanConfidence: number;
}

const PSM_NAMES: Record<number, string> = {
  [PSM.AUTO]: 'AUTO',
  [PSM.SPARSE_TEXT]: 'SPARSE',
  [PSM.SINGLE_BLOCK]: 'BLOCK',
};

async function runPass(worker: Worker, variant: PreprocessVariant, psm: PSM): Promise<Pass> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    // Tesseract guesses DPI badly on upscaled crops; state it.
    user_defined_dpi: '300',
  });
  const result = await worker.recognize(variant.buffer, {}, { text: true, blocks: true });
  const segments = buildSegments(result.data, variant.width);
  const fields = extractFields(segments, variant.height);
  const words = segments.flatMap((s) => s.words);
  const confidentWords = words.filter((w) => w.confidence >= 60).length;
  const meanConfidence =
    words.length === 0 ? 0 : words.reduce((s, w) => s + w.confidence, 0) / words.length / 100;
  return { variant, psm: PSM_NAMES[psm], result, segments, fields, confidentWords, meanConfidence };
}

/**
 * Orders passes by usefulness. Declarations located is what the officer needs;
 * confident word count breaks ties and is the criterion in text-only mode.
 */
function passScore(p: Pass, mode: 'fields' | 'text'): number {
  const fields = Object.keys(p.fields).length;
  return mode === 'fields'
    ? fields * 100 + p.confidentWords + p.meanConfidence * 10
    : p.confidentWords * 10 + p.meanConfidence * 100 + fields;
}

function better(a: Pass | null, b: Pass, mode: 'fields' | 'text'): Pass {
  return !a || passScore(b, mode) > passScore(a, mode) ? b : a;
}

/**
 * Source-space rectangle enclosing the confidently read words of a pass, used
 * to decide whether the label deserves a second, tighter read.
 */
function textRegion(pass: Pass) {
  const words = pass.segments.flatMap((s) => s.words).filter((w) => w.confidence >= 55);
  if (words.length < 4) return null;
  const boxes = words.map((w) => toSourceBox(w.bbox, pass.variant.geometry));
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** A declaration together with the pass that read it, so its boxes map back through that pass's geometry. */
interface FieldPick {
  hit: FieldHit;
  pass: Pass;
}

interface Recognition {
  /** The pass whose read is shown as the preview and used for quality. */
  best: Pass;
  /** Every pass that ran; declarations and lines are merged across them. */
  passes: Pass[];
  fields: Partial<Record<DeclarationKey, FieldPick>>;
  refocused: boolean;
  preprocessing: Awaited<ReturnType<typeof preprocessForOcr>>;
}

/** Prefers confidence, then completeness (a full address beats a fragment). */
function betterHit(a: FieldHit, b: FieldHit): boolean {
  if (Math.abs(a.confidence - b.confidence) > 0.08) return a.confidence > b.confidence;
  return a.value.length > b.value.length;
}

/**
 * Keeps, for every declaration, the best reading from any pass.
 *
 * Choosing one whole pass threw away what the others had found: the crop of
 * the panel reads the small print well but may exclude a line at its edge,
 * while the full frame has that line but reads the small print worse. The
 * officer needs both.
 */
function mergeFields(passes: Pass[]): Partial<Record<DeclarationKey, FieldPick>> {
  const merged: Partial<Record<DeclarationKey, FieldPick>> = {};
  for (const pass of passes) {
    for (const [key, hit] of Object.entries(pass.fields) as [DeclarationKey, FieldHit][]) {
      const current = merged[key];
      if (!current || betterHit(hit, current.hit)) merged[key] = { hit, pass };
    }
  }
  return merged;
}

function overlapRatio(a: OcrLine['box'], b: OcrLine['box']): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * The accepted pass's lines, plus lines other passes read in parts of the image
 * the accepted pass did not read well.
 *
 * Where a line from another pass overlaps one already present, the more
 * confident reading wins: a carton photographed sideways yields garbage where
 * its upright dot-matrix values are, and the upright pass reads those values
 * cleanly — so the garbage is replaced rather than protecting its area.
 */
function mergeLines(best: Pass, passes: Pass[], source: LoadedImage): { lines: OcrLine[]; extra: OcrLine[] } {
  const lines = linesOf(best, source);
  const extra: OcrLine[] = [];
  for (const pass of passes) {
    if (pass === best) continue;
    for (const s of pass.segments) {
      // Segment confidence is 0..1.
      if (s.confidence < 0.55 || s.words.length === 0 || !s.text.trim()) continue;
      const candidate: OcrLine = {
        text: s.text,
        confidence: Number(s.confidence.toFixed(2)),
        box: normaliseBox(toSourceBox(s.bbox, pass.variant.geometry), source.width, source.height),
      };
      const clash = lines.filter((l) => overlapRatio(l.box, candidate.box) > 0.3);
      if (clash.some((l) => l.confidence >= candidate.confidence)) continue;
      if (extra.some((l) => overlapRatio(l.box, candidate.box) > 0.3)) continue;
      for (const l of clash) lines.splice(lines.indexOf(l), 1);
      extra.push(candidate);
    }
  }
  extra.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { lines: [...lines, ...extra], extra };
}

type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * Decides which way up the text is.
 *
 * A box photographed on its side reads as noise at 0°. Rather than trust a
 * separate orientation model, each of the four rotations is tried on a small,
 * fast copy and the one that yields the most confident real words wins. The
 * 0° case is checked first and accepted immediately when it is clearly legible,
 * so a correctly held photograph pays almost nothing for this.
 */
async function detectOrientation(
  worker: Worker,
  buffer: RgbaSource,
  crop?: { x: number; y: number; w: number; h: number },
): Promise<QuarterTurns> {
  // Probing the label crop rather than the whole frame gives the 0° pass enough
  // words to be accepted immediately in the common case.
  const grey = await quickGrey(buffer, 900, crop);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });

  const score = async (turns: QuarterTurns) => {
    const img = rotate90(grey, turns);
    const result = await worker.recognize(await encodePng(img), {}, { text: true, blocks: true });
    const segments = buildSegments(result.data, img.width);
    return segments
      .flatMap((s) => s.words)
      .filter((w) => w.confidence >= 60 && /[A-Za-z]{3,}|d{3,}/.test(w.text)).length;
  };

  const upright = await score(0);
  if (upright >= 15) return 0;

  let best: { turns: QuarterTurns; words: number } = { turns: 0, words: upright };
  for (const turns of [1, 3, 2] as QuarterTurns[]) {
    const words = await score(turns);
    if (words > best.words) best = { turns, words };
  }
  // Only turn the image when another orientation is decisively better.
  return best.words >= Math.max(6, upright * 1.5) ? best.turns : 0;
}

function regionArea(r: { x0: number; y0: number; x1: number; y1: number }) {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

/** Crop rectangle around a region with a proportional margin, clamped to the frame. */
function cropAround(region: { x0: number; y0: number; x1: number; y1: number }, source: LoadedImage) {
  const marginX = (region.x1 - region.x0) * 0.06;
  const marginY = (region.y1 - region.y0) * 0.06;
  const x = Math.max(0, region.x0 - marginX);
  const y = Math.max(0, region.y0 - marginY);
  return {
    x,
    y,
    w: Math.min(source.width, region.x1 + marginX) - x,
    h: Math.min(source.height, region.y1 + marginY) - y,
  };
}

/** True when the print occupies a small enough part of the frame to be worth a tighter read. */
function worthRefocusing(region: { x0: number; y0: number; x1: number; y1: number }, source: LoadedImage) {
  const regionArea = (region.x1 - region.x0) * (region.y1 - region.y0);
  const frameArea = source.width * source.height;
  const wideEnough = region.x1 - region.x0 > source.width * 0.08;
  return regionArea < frameArea * 0.6 && regionArea > frameArea * 0.02 && wideEnough;
}

async function recognise(buffer: RgbaSource, source: LoadedImage, mode: 'fields' | 'text'): Promise<Recognition> {
  const worker = await getWorker();

  // The untouched full-frame pass gives the ink region needed for everything
  // else; it is only redone if the image turns out to be sideways.
  let preprocessing = await preprocessForOcr(buffer);
  const cropRect =
    preprocessing.textRegion && worthRefocusing(preprocessing.textRegion, source)
      ? cropAround(preprocessing.textRegion, source)
      : undefined;
  // The tight ink core is read as well when widening changed the crop
  // materially: a panel bordered by artwork reads better from the core, a
  // panel with sparse print at its foot reads better from the widened crop,
  // and the merge keeps the best of each.
  const core = preprocessing.textRegionCore;
  const coreRect =
    cropRect && core && regionArea(core) < regionArea(preprocessing.textRegion!) * 0.85
      ? cropAround(core, source)
      : undefined;

  const upright = preprocessing;
  const quarterTurns = await detectOrientation(worker, buffer, cropRect);
  if (quarterTurns) preprocessing = await preprocessForOcr(buffer, { quarterTurns });
  let refocused = false;
  let usedPreprocessing = preprocessing;

  // Stage 1: if ink density already shows the label is a fraction of the frame,
  // crop to it before any recognition — a label at arm's length becomes a label
  // filling the frame, at full recogniser resolution, with deskew measured on
  // the label alone rather than on the frame.
  let cropped: Awaited<ReturnType<typeof preprocessForOcr>> | null = null;
  if (cropRect) {
    cropped = await preprocessForOcr(buffer, { crop: cropRect, quarterTurns });
  }
  const croppedCore = coreRect ? await preprocessForOcr(buffer, { crop: coreRect, quarterTurns }) : null;

  // Every pass is kept: the final declarations are merged across all of them.
  const passes: Pass[] = [];
  const run = async (variant: PreprocessVariant, psm: PSM) => {
    const pass = await runPass(worker, variant, psm);
    passes.push(pass);
    return pass;
  };
  const merged = () => Object.keys(mergeFields(passes)).length;

  let best: Pass | null = null;
  // The crop is read first: when it wins it is also the common case.
  if (cropped) {
    for (const variant of cropped.variants) {
      best = better(best, await run(variant, PSM.AUTO), mode);
    }
    refocused = true;
    usedPreprocessing = cropped;
  }
  if (croppedCore) {
    for (const variant of croppedCore.variants) {
      const pass = await run(variant, PSM.AUTO);
      if (better(best, pass, mode) === pass) {
        best = pass;
        usedPreprocessing = croppedCore;
      }
    }
  }
  const cropStrong = best && (mode === 'fields' ? Object.keys(best.fields).length >= 8 : best.confidentWords >= 25);
  if (!cropStrong) {
    for (const variant of preprocessing.variants) {
      const pass = await run(variant, PSM.AUTO);
      const next = better(best, pass, mode);
      if (next === pass) {
        best = pass;
        refocused = false;
        usedPreprocessing = preprocessing;
      }
    }
  } else if (cropped) {
    // The crop won on the panel, but the frame around it may still carry a
    // declaration the crop excluded. Read the whole frame once, with the
    // variant that worked on the crop, and let the merge keep what it adds.
    const same = preprocessing.variants.find((v) => v.name === best!.variant.name) ?? preprocessing.variants[0];
    await run(same, PSM.AUTO);
  }

  // Mixed orientations. On many cartons the printed captions run one way and
  // the dot-matrix MRP, batch number and dates another, so a photograph that
  // was turned to read the body text has just made those values sideways. The
  // untouched orientation is read once more — the caption-free fallbacks pick a
  // price and dates out of it — and the merge keeps the best of both.
  if (quarterTurns !== 0) {
    const uprightCrop = cropRect ? await preprocessForOcr(buffer, { crop: cropRect }) : upright;
    const variant = uprightCrop.variants.find((v) => v.name === 'normalised') ?? uprightCrop.variants[0];
    await run(variant, PSM.SPARSE_TEXT);
    await run(variant, PSM.AUTO);
  }

  // Stage 2: the recogniser's own confident words may still outline a tighter
  // region than ink density did (busy artwork around the panel, for instance).
  const region = refocused ? null : textRegion(best!);
  if (region) {
    if (worthRefocusing(region, source)) {
      const recropped = await preprocessForOcr(buffer, { crop: cropAround(region, source), quarterTurns });
      let bestCropped: Pass | null = null;
      for (const variant of recropped.variants) {
        bestCropped = better(bestCropped, await run(variant, PSM.AUTO), mode);
      }
      if (bestCropped && passScore(bestCropped, mode) > passScore(best!, mode)) {
        best = bestCropped;
        refocused = true;
        usedPreprocessing = recropped;
      }
    }
  }

  // Still missing declarations → the sparse-text segmenter finds isolated lines
  // that automatic layout analysis folds into blocks or drops.
  if ((mode === 'fields' && merged() < 10) || (mode === 'text' && best!.confidentWords < 12)) {
    best = better(best, await run(best!.variant, PSM.SPARSE_TEXT), mode);
    if (merged() < 4) {
      best = better(best, await run(best!.variant, PSM.SINGLE_BLOCK), mode);
    }
  }

  return { best: best!, passes, fields: mergeFields(passes), refocused, preprocessing: usedPreprocessing };
}

/* --------------------------------------------------------------- Quality */

const MIN_RELIABLE_CAP_PX = 18;

function medianOf(values: number[]) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function assessQuality(pass: Pass, declarationsFound: number, refocused: boolean): OcrQuality {
  const g = pass.variant.geometry;
  const recogniserCap = medianOf(pass.segments.map((s) => s.capHeightPx));
  const sourceCap = Number((recogniserCap / (g.scale * g.workScale)).toFixed(1));
  const wordsRead = pass.segments.reduce((n, s) => n + s.words.length, 0);

  let level: OcrQuality['level'] = 'GOOD';
  const reasons: string[] = [];

  if (recogniserCap > 0 && recogniserCap < MIN_RELIABLE_CAP_PX) {
    level = 'POOR';
    reasons.push(`the printed text is only about ${sourceCap} px tall in this image`);
  }
  if (pass.meanConfidence < 0.6) {
    level = 'POOR';
    reasons.push('the recogniser had low confidence in most words');
  } else if (pass.meanConfidence < 0.75 && level !== 'POOR') {
    level = 'MARGINAL';
    reasons.push('several words were read with limited confidence');
  }
  if (declarationsFound < 4) {
    level = 'POOR';
    reasons.push(`only ${declarationsFound} of 12 declarations could be located`);
  } else if (declarationsFound < 8 && level === 'GOOD') {
    level = 'MARGINAL';
  }

  return {
    medianCapHeightPx: sourceCap,
    meanConfidence: Number(pass.meanConfidence.toFixed(2)),
    declarationsFound,
    wordsRead,
    passUsed: `${pass.variant.name}/${pass.psm}`,
    upscaleApplied: Number(g.scale.toFixed(2)),
    refocused,
    level,
    advice:
      level === 'GOOD'
        ? undefined
        : `Re-capture the package: ${reasons.join(', ')}. Fill the frame with the declarations panel alone, hold the camera parallel to the label about 15–20 cm away, and avoid glare from overhead lights.`,
  };
}

function summarisePreprocessing(rec: Recognition): PreprocessingSummary {
  const variant = rec.best.variant.name;
  const png = rec.preprocessing.previews[variant];
  return {
    ...rec.preprocessing.report,
    variantUsed: variant,
    previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
  };
}

function linesOf(pass: Pass, source: LoadedImage): OcrLine[] {
  return pass.segments.map((s) => {
    const box = toSourceBox(s.bbox, pass.variant.geometry);
    return {
      text: s.text,
      confidence: Number(s.confidence.toFixed(2)),
      box: normaliseBox(box, source.width, source.height),
    };
  });
}

/* ----------------------------------------------------------- Readability */

function buildReadability(
  segments: Segment[],
  pass: Pass,
  confidence: number,
  contrastRatio: number,
  mmPerPx: number | null,
  minMm: number,
): ReadabilityMetric {
  const g = pass.variant.geometry;
  const capHeightPx = Math.max(...segments.map((s) => s.capHeightPx)) / (g.scale * g.workScale);
  const scaleKnown = mmPerPx !== null;
  const estimatedMm = scaleKnown ? Number((capHeightPx * mmPerPx!).toFixed(2)) : 0;

  let status: ReadabilityMetric['status'];
  if (contrastRatio < 3 || confidence < 0.6) status = 'POOR';
  else if (!scaleKnown) status = contrastRatio < 4.5 || confidence < 0.85 ? 'REVIEW' : 'GOOD';
  else if (estimatedMm < minMm * 0.95) status = 'POOR';
  else if (estimatedMm < minMm * 1.12 || contrastRatio < 4.5 || confidence < 0.85) status = 'REVIEW';
  else status = 'GOOD';

  return {
    textHeightPx: Math.round(capHeightPx),
    estimatedFontPt: scaleKnown ? Number(((capHeightPx * mmPerPx!) / 0.3528).toFixed(1)) : 0,
    requiredMinMm: minMm,
    estimatedMm,
    contrastRatio,
    ocrConfidence: Number(confidence.toFixed(2)),
    status,
    scaleKnown,
  };
}

/* ------------------------------------------------------------ Public API */

/** Full declaration extraction for the inspection pipeline. */
export async function recognisePackage(request: OcrRequest): Promise<OcrResponse> {
  const started = Date.now();
  const pixels = await decodeSource(request.buffer);
  const source = await loadImage(pixels);
  const rec = await recognise(pixels, source, 'fields');
  const { best } = rec;

  const mmPerPx =
    request.panelWidthMm && request.panelWidthMm > 0 ? request.panelWidthMm / source.width : null;
  const minMm = request.minHeightMm ?? DEFAULT_MIN_HEIGHT_MM;

  const declarations: Declaration[] = DECLARATION_ORDER.map((key: DeclarationKey) => {
    const pick = rec.fields[key];
    if (!pick) {
      return {
        key,
        label: DECLARATION_LABELS[key],
        detectedValue: null,
        confidence: Number((1 - best.meanConfidence).toFixed(2)),
      };
    }
    const { hit, pass } = pick;
    const g = pass.variant.geometry;

    const recogniserBox = {
      x0: Math.min(...hit.segments.map((s) => s.bbox.x0)),
      y0: Math.min(...hit.segments.map((s) => s.bbox.y0)),
      x1: Math.max(...hit.segments.map((s) => s.bbox.x1)),
      y1: Math.max(...hit.segments.map((s) => s.bbox.y1)),
    };
    const sourceBox = toSourceBox(recogniserBox, g);
    const wordBoxes = hit.segments.flatMap((s) => s.words.map((w) => toSourceBox(w.bbox, g)));
    const contrastRatio = contrastForBoxes(source, wordBoxes.length ? wordBoxes : [sourceBox]);

    return {
      key,
      label: DECLARATION_LABELS[key],
      detectedValue: hit.value,
      rawText: hit.segments.map((s) => s.text).join('\n'),
      confidence: Number(hit.confidence.toFixed(2)),
      region: {
        id: `rgn-${key.toLowerCase()}`,
        imageId: request.imageId,
        box: normaliseBox(sourceBox, source.width, source.height),
        label: DECLARATION_LABELS[key],
      },
      readability: buildReadability(hit.segments, pass, hit.confidence, contrastRatio, mmPerPx, minMm),
    };
  });

  const detected = declarations.filter((d) => d.detectedValue);
  const { lines, extra } = mergeLines(best, rec.passes, source);
  const rawText = [best.result.data.text.replace(/\n{3,}/g, '\n\n').trim(), ...extra.map((l) => l.text)]
    .filter(Boolean)
    .join('\n');

  return {
    ocr: {
      imageId: request.imageId,
      engine: ENGINE,
      processingMs: Date.now() - started,
      rawText,
      tokens: lines.map((l) => ({ text: l.text, confidence: l.confidence, box: l.box })),
      averageConfidence: Number(
        (detected.reduce((s, d) => s + d.confidence, 0) / Math.max(detected.length, 1)).toFixed(3),
      ),
      imageWidth: source.width,
      imageHeight: source.height,
      estimatedDpi: mmPerPx ? Math.round(25.4 / mmPerPx) : 0,
    },
    declarations,
    quality: assessQuality(best, detected.length, rec.refocused),
    preprocessing: summarisePreprocessing(rec),
    lines,
  };
}

/** Plain text extraction — what the recogniser can read, line by line. */
export async function extractText(buffer: Buffer): Promise<TextExtraction> {
  const started = Date.now();
  const pixels = await decodeSource(buffer);
  const source = await loadImage(pixels);
  const rec = await recognise(pixels, source, 'text');
  const { lines } = mergeLines(rec.best, rec.passes, source);
  return {
    rawText: lines.map((l) => l.text).join('\n'),
    lines,
    quality: assessQuality(rec.best, Object.keys(rec.fields).length, rec.refocused),
    preprocessing: summarisePreprocessing(rec),
    processingMs: Date.now() - started,
    imageWidth: source.width,
    imageHeight: source.height,
  };
}
