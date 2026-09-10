import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { Declaration, DeclarationKey, OcrResult, ReadabilityMetric } from '@shared/types';
import type { FieldHit } from './extract';
import { DECLARATION_LABELS, DECLARATION_ORDER, DEFAULT_MIN_HEIGHT_MM } from '@shared/data/declarations';
import { buildSegments, normaliseBox, type Segment } from './segments';
import { extractFields } from './extract';
import { classifyLine, classifyLines, warmClassifier } from './nlp/classifier';
import { contrastForBoxes, loadImage, type LoadedImage } from './imageMetrics';
import { asRecognizeData, cloudEngineLabel, cloudProvider, readWithCloud } from './cloud';
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
  type VariantGeometry,
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

/**
 * A single recogniser call that must finish in time. The worker has been seen to
 * stall for ten minutes on a Windows host; when a call overruns, the worker is
 * destroyed and the next call gets a fresh one, so one bad pass costs seconds
 * rather than the whole request.
 */
const PASS_TIMEOUT_MS = Number(process.env.OCR_PASS_TIMEOUT_MS ?? 30_000);

class PassTimeout extends Error {}

async function recognizeWithTimeout(
  image: Buffer,
  psm: PSM,
  dpi: string,
): Promise<Awaited<ReturnType<Worker['recognize']>> | null> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm, user_defined_dpi: dpi });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      worker.recognize(image, {}, { text: true, blocks: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PassTimeout(`recogniser pass exceeded ${PASS_TIMEOUT_MS} ms`)), PASS_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    if (!(err instanceof PassTimeout)) throw err;
    console.warn(`[ocr] ${err.message}; restarting the recogniser`);
    workerPromise = null;
    worker.terminate().catch(() => undefined);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function warmUp() {
  warmClassifier();
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
  /** False when no printed panel was found in the photograph. */
  labelDetected: boolean;
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
  /** Declaration section from the NLP tagger; absent when OTHER or unsure. */
  section?: DeclarationKey;
  sectionConfidence?: number;
}

export interface OcrResponse {
  ocr: OcrResult;
  declarations: Declaration[];
  quality: OcrQuality;
  preprocessing: PreprocessingSummary;
  lines: OcrLine[];
}

/** One of the twelve mandatory declarations as read from a single image. */
export interface TextDeclaration {
  key: DeclarationKey;
  label: string;
  detectedValue: string | null;
  /** 0..1; 0 when not found. */
  confidence: number;
  /** Where on the original image it was read, normalised; null when not found. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Present when the declaration is not required for this package, with the reason. */
  notApplicable?: string;
}

const IMPORTER_NA = 'Made in India — the importer declaration is required only for imported commodities.';

/** Marks declarations that this package does not need, from what was read. */
function markNotApplicable<T extends { key: DeclarationKey; detectedValue: string | null; notApplicable?: string }>(declarations: T[]): T[] {
  const origin = declarations.find((d) => d.key === 'COUNTRY_OF_ORIGIN')?.detectedValue ?? '';
  if (/\bindia\b/i.test(origin)) {
    const importer = declarations.find((d) => d.key === 'IMPORTER_DETAILS');
    if (importer && !importer.detectedValue) importer.notApplicable = IMPORTER_NA;
  }
  return declarations;
}

export interface TextExtraction {
  rawText: string;
  lines: OcrLine[];
  /** All twelve declarations, found or not, so the panel can show the gaps. */
  declarations: TextDeclaration[];
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

async function runPass(variant: PreprocessVariant, psm: PSM): Promise<Pass> {
  // Tesseract guesses DPI badly on upscaled crops; state it.
  const result = await recognizeWithTimeout(variant.buffer, psm, '300');
  if (!result) {
    // A pass that timed out scores zero and adds nothing to the merge.
    const empty = { data: { text: '' } } as unknown as Awaited<ReturnType<Worker['recognize']>>;
    return { variant, psm: PSM_NAMES[psm], result: empty, segments: [], fields: {}, confidentWords: 0, meanConfidence: 0 };
  }
  const segments = buildSegments(result.data, variant.width);
  const fields = extractFields(segments, variant.height, classifyLines(segments.map((s) => s.text)));
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
  /** Recogniser that produced the read; the local engine when absent. */
  engine?: string;
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
        ...sectionOf(s.text),
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
interface Orientation {
  /** Turns applied to read the body of the label. */
  turns: QuarterTurns;
  /** Other orientations worth reading too: one the probe saw text in, and upright whenever the body was turned. */
  alternates: QuarterTurns[];
  words: Record<QuarterTurns, number>;
  /** Source-space rectangle enclosing the confidently read words, outliers dropped; null when too few. */
  wordRegion: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Median tilt of the text lines (estimator convention), or null when unmeasurable. */
  tiltDeg: number | null;
  /** Median cap height of the confident words, in source pixels. */
  capHeightPx: number | null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function detectOrientation(
  worker: Worker,
  buffer: RgbaSource,
  sourceWidth: number,
  crop?: { x: number; y: number; w: number; h: number },
): Promise<Orientation> {
  // Probing the label crop rather than the whole frame concentrates the words.
  const grey = await quickGrey(buffer, 900, crop);

  const isReal = (w: { text: string; confidence: number }) => w.confidence >= 60 && /[A-Za-z]{3,}|\d{3,}/.test(w.text);
  const probes = new Map<QuarterTurns, Segment[]>();
  const score = async (turns: QuarterTurns) => {
    const img = rotate90(grey, turns);
    const result = await recognizeWithTimeout(await encodePng(img), PSM.SPARSE_TEXT, '150');
    if (!result) { probes.set(turns, []); return 0; }
    const segments = buildSegments(result.data, img.width);
    probes.set(turns, segments);
    return segments.flatMap((s) => s.words).filter(isReal).length;
  };

  // 0°, 90° and 270° are always compared: a carton whose upright dot-matrix
  // block reads well must not stop the sideways body text from being tried.
  const words: Record<QuarterTurns, number> = { 0: await score(0), 1: await score(1), 2: 0, 3: await score(3) };
  if (Math.max(words[0], words[1], words[3]) < 6) words[2] = await score(2);

  const ranked = ([0, 1, 3, 2] as QuarterTurns[]).sort((a, b) => words[b] - words[a]);
  const best = ranked[0];
  // Only turn when another orientation is decisively better than upright.
  const turns: QuarterTurns = best !== 0 && words[best] >= Math.max(6, words[0] * 1.5) ? best : 0;
  // Four real words is enough: an upright dot-matrix block is only a price, a code and two dates.
  // When the body was turned, the untouched orientation is always read too: the
  // probe runs at 900 px and simply cannot see a small dot-matrix block.
  const alternates: QuarterTurns[] = [];
  const other = ranked.find((t) => t !== turns && words[t] >= 4 && words[t] >= words[turns] * 0.15);
  if (other !== undefined) alternates.push(other);
  if (turns !== 0 && !alternates.includes(0)) alternates.push(0);

  /* ---- what the winning probe tells us about the label ---- */
  const segments = probes.get(turns) ?? [];
  const realWords = segments.flatMap((s) => s.words).filter(isReal);

  // Probe-image → source mapping: the probe is the (cropped) frame downscaled
  // by probeScale and turned; toSourceBox undoes exactly that.
  const cropW = crop?.w ?? sourceWidth;
  const probeScale = grey.width / cropW;
  const geometry: VariantGeometry = {
    scale: 1,
    padPx: 0,
    offsetX: crop?.x ?? 0,
    offsetY: crop?.y ?? 0,
    workScale: probeScale,
    skewDeg: 0,
    quarterTurns: turns,
    turnSourceWidth: grey.width,
    turnSourceHeight: grey.height,
    centreX: 0,
    centreY: 0,
  };

  let wordRegion: Orientation['wordRegion'] = null;
  if (realWords.length >= 8) {
    const boxes = realWords.map((w) => toSourceBox(w.bbox, geometry));
    const cx = boxes.map((b) => (b.x0 + b.x1) / 2);
    const cy = boxes.map((b) => (b.y0 + b.y1) / 2);
    const mx = median(cx);
    const my = median(cy);
    const dist = boxes.map((_, i) => Math.hypot(cx[i] - mx, cy[i] - my));
    const mad = median(dist) || 1;
    // Words far from the cluster are clutter read as text; the label is the
    // cluster. The core is then grown to take in words just outside it — the
    // batch line at the foot of a panel — while distant clutter stays out.
    const core = boxes.filter((_, i) => dist[i] <= mad * 2.5);
    if (core.length >= 6) {
      const coreBox = {
        x0: Math.min(...core.map((b) => b.x0)),
        y0: Math.min(...core.map((b) => b.y0)),
        x1: Math.max(...core.map((b) => b.x1)),
        y1: Math.max(...core.map((b) => b.y1)),
      };
      const growX = (coreBox.x1 - coreBox.x0) * 0.35;
      const growY = (coreBox.y1 - coreBox.y0) * 0.35;
      const near = boxes.filter(
        (b) => b.x1 >= coreBox.x0 - growX && b.x0 <= coreBox.x1 + growX && b.y1 >= coreBox.y0 - growY && b.y0 <= coreBox.y1 + growY,
      );
      wordRegion = {
        x0: Math.min(...near.map((b) => b.x0)),
        y0: Math.min(...near.map((b) => b.y0)),
        x1: Math.max(...near.map((b) => b.x1)),
        y1: Math.max(...near.map((b) => b.y1)),
      };
    }
  }

  // Tilt: least-squares slope through the word centres of each line with three
  // or more confident words; the median across lines survives perspective fan.
  const angles: number[] = [];
  for (const seg of segments) {
    const ws = seg.words.filter((w) => w.confidence >= 50);
    if (ws.length < 3) continue;
    const xs = ws.map((w) => (w.bbox.x0 + w.bbox.x1) / 2);
    const ys = ws.map((w) => (w.bbox.y0 + w.bbox.y1) / 2);
    const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - xm) * (ys[i] - ym);
      den += (xs[i] - xm) ** 2;
    }
    if (den > 0 && Math.abs(xs[xs.length - 1] - xs[0]) > grey.width * 0.05) angles.push((Math.atan2(num, den) * 180) / Math.PI);
  }
  const tiltDeg = angles.length >= 3 ? Number(median(angles).toFixed(1)) : null;

  // The upscale is driven by the small print, not the headline: the legal block
  // is what the officer needs and it is set several sizes below the brand and
  // the net quantity. The 30th percentile of word heights stands for it, floored
  // so that speckle read as words cannot demand a pointless ×4.
  const heights = realWords.map((w) => (w.bbox.y1 - w.bbox.y0) / probeScale).sort((a, b) => a - b);
  const smallPrint = heights.length ? heights[Math.floor(0.3 * (heights.length - 1))] : 0;
  const capHeightPx = heights.length >= 4 ? Number(Math.max(6, Math.min(median(heights), smallPrint)).toFixed(1)) : null;
  if (process.env.OCR_DEBUG) {
    console.log('[probe words]', 'probeScale', probeScale.toFixed(3), 'grey', grey.width + 'x' + grey.height,
      realWords.slice(0, 12).map((w) => `${w.text}:${w.bbox.y1 - w.bbox.y0}px`).join(' '));
  }

  return { turns, alternates, words, wordRegion, tiltDeg, capHeightPx };
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

/** Wall-clock budget for the optional passes; the mandatory reads always run. */
const OCR_BUDGET_MS = Number(process.env.OCR_BUDGET_MS ?? 45_000);

async function recognise(buffer: RgbaSource, source: LoadedImage, mode: 'fields' | 'text'): Promise<Recognition> {
  const worker = await getWorker();
  const started = Date.now();
  const overBudget = () => Date.now() - started > OCR_BUDGET_MS;

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
  const orientation = await detectOrientation(worker, buffer, source.width, cropRect);
  const quarterTurns = orientation.turns;
  const hints = { skewDegHint: orientation.tiltDeg, sourceCapHeightPx: orientation.capHeightPx };
  if (process.env.OCR_DEBUG) console.log('[probe]', JSON.stringify(orientation));
  if (quarterTurns || orientation.tiltDeg != null || orientation.capHeightPx != null) {
    preprocessing = await preprocessForOcr(buffer, { quarterTurns, ...hints });
  }

  // Where the recogniser actually found words is a better guide to the label
  // than ink density when the background is busy (a room, a hand, a barcode).
  // Only when the label is well under half the frame: cropping a label that
  // already fills the frame just risks trimming its edges.
  const wordArea = orientation.wordRegion ? regionArea(orientation.wordRegion) : 0;
  const wordRect =
    orientation.wordRegion && worthRefocusing(orientation.wordRegion, source) && wordArea < source.width * source.height * 0.45
      ? cropAround(orientation.wordRegion, source)
      : undefined;
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter);
  };
  const wordCropDiffers = wordRect && (!cropRect || overlaps(wordRect, cropRect) < 0.7);
  let refocused = false;
  let usedPreprocessing = preprocessing;

  // Stage 1: if ink density already shows the label is a fraction of the frame,
  // crop to it before any recognition — a label at arm's length becomes a label
  // filling the frame, at full recogniser resolution, with deskew measured on
  // the label alone rather than on the frame.
  let cropped: Awaited<ReturnType<typeof preprocessForOcr>> | null = null;
  if (cropRect) {
    cropped = await preprocessForOcr(buffer, { crop: cropRect, quarterTurns, ...hints });
  }
  const croppedCore = coreRect ? await preprocessForOcr(buffer, { crop: coreRect, quarterTurns, ...hints }) : null;
  const croppedWords = wordCropDiffers ? await preprocessForOcr(buffer, { crop: wordRect!, quarterTurns, ...hints }) : null;

  // Every pass is kept: the final declarations are merged across all of them.
  const passes: Pass[] = [];
  const run = async (variant: PreprocessVariant, psm: PSM) => {
    const t0 = Date.now();
    const pass = await runPass(variant, psm);
    passes.push(pass);
    if (process.env.OCR_DEBUG) {
      console.log(`[pass] ${variant.name}/${PSM_NAMES[psm]} ${variant.width}×${variant.height} fields=${Object.keys(pass.fields).length} words=${pass.confidentWords} ${Date.now() - t0} ms`);
    }
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
  if (croppedWords && !overBudget()) {
    for (const variant of croppedWords.variants) {
      const pass = await run(variant, PSM.AUTO);
      if (better(best, pass, mode) === pass) {
        best = pass;
        refocused = true;
        usedPreprocessing = croppedWords;
      }
    }
  }
  const cropStrong = best && (mode === 'fields' ? Object.keys(best.fields).length >= 8 : best.confidentWords >= 25);
  if (!cropStrong && (!best || !overBudget())) {
    for (const variant of preprocessing.variants) {
      const pass = await run(variant, PSM.AUTO);
      const next = better(best, pass, mode);
      if (next === pass) {
        best = pass;
        refocused = false;
        usedPreprocessing = preprocessing;
      }
    }
  } else if (cropped && !overBudget()) {
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
  for (const alt of orientation.alternates) {
    if (overBudget()) break;
    const altRect = wordRect ?? cropRect;
    // The other orientation usually holds the dot-matrix price/batch/date block.
    const altPre = altRect
      ? await preprocessForOcr(buffer, { crop: altRect, quarterTurns: alt, sourceCapHeightPx: orientation.capHeightPx, dotMatrix: true })
      : await preprocessForOcr(buffer, { quarterTurns: alt, sourceCapHeightPx: orientation.capHeightPx, dotMatrix: true });
    const variant = altPre.variants.find((v) => v.name === 'normalised') ?? altPre.variants[0];
    await run(variant, PSM.SPARSE_TEXT);
    await run(variant, PSM.AUTO);
  }

  // Stage 2: the recogniser's own confident words may still outline a tighter
  // region than ink density did (busy artwork around the panel, for instance).
  const region = refocused || overBudget() ? null : textRegion(best!);
  if (region) {
    if (worthRefocusing(region, source)) {
      const recropped = await preprocessForOcr(buffer, { crop: cropAround(region, source), quarterTurns, ...hints });
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
  if (!overBudget() && ((mode === 'fields' && merged() < 10) || (mode === 'text' && best!.confidentWords < 12))) {
    best = better(best, await run(best!.variant, PSM.SPARSE_TEXT), mode);
    if (merged() < 4) {
      best = better(best, await run(best!.variant, PSM.SINGLE_BLOCK), mode);
    }
  }

  // Light print on a dark label: a black bottle label or a navy carton inside a
  // bright frame is read as light-on-light noise, because the frame decides the
  // polarity. When the read is this thin, the opposite polarity is tried on the
  // label crop and on the frame, and the merge keeps whichever found words.
  const thin = mode === 'fields' ? merged() < 5 || realWordCount(best!) < 12 : best!.confidentWords < 15;
  if (thin && !overBudget()) {
    const invRect = wordRect ?? cropRect;
    const invPre = await preprocessForOcr(buffer, { crop: invRect, quarterTurns, ...hints, forceInvert: true });
    const variant = invPre.variants.find((v) => v.name === 'normalised') ?? invPre.variants[0];
    let bestInv = await run(variant, PSM.AUTO);
    bestInv = better(bestInv, await run(variant, PSM.SPARSE_TEXT), mode);
    let invUsed = invPre;
    // Ink density is useless on the inverted frame (the bright room becomes
    // "ink"); the words the recogniser found outline the label instead, and the
    // label is then read on its own, at full resolution.
    const invRegion = textRegion(bestInv);
    if (process.env.OCR_DEBUG) console.log("[invert] words region", JSON.stringify(invRegion), "frame", source.width + "x" + source.height);
    if (!invRect && invRegion && worthRefocusing(invRegion, source) && !overBudget()) {
      const invCrop = await preprocessForOcr(buffer, {
        crop: cropAround(invRegion, source),
        quarterTurns,
        ...hints,
        forceInvert: true,
      });
      const cropVariant = invCrop.variants.find((v) => v.name === 'normalised') ?? invCrop.variants[0];
      let bestCrop = await run(cropVariant, PSM.AUTO);
      bestCrop = better(bestCrop, await run(cropVariant, PSM.SPARSE_TEXT), mode);
      if (passScore(bestCrop, mode) > passScore(bestInv, mode)) {
        bestInv = bestCrop;
        invUsed = invCrop;
      }
    }
    if (passScore(bestInv, mode) > passScore(best!, mode)) {
      best = bestInv;
      refocused = invUsed !== invPre || Boolean(invRect);
      usedPreprocessing = invUsed;
    }
  }

  return { best: best!, passes, fields: mergeFields(passes), refocused, preprocessing: usedPreprocessing };
}

/* ----------------------------------------------------------- Cloud engine */

function mimeOf(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

/**
 * The hosted recogniser's read, in the same shape as a local pass so that the
 * caption readers, the classifier, the merge and the evidence boxes run
 * unchanged. Null when no provider is configured or the call failed; the
 * caller then falls back to the local engine.
 */
async function cloudRecognition(buffer: Buffer, pixels: RgbaSource, source: LoadedImage): Promise<Recognition | null> {
  if (!cloudProvider()) return null;
  try {
    const read = await readWithCloud(buffer, mimeOf(buffer), source.width, source.height);
    if (!read || read.lines.length < 3) return null;
    const turned = read.quarterTurns % 2 ? { width: source.height, height: source.width } : { width: source.width, height: source.height };
    const data = asRecognizeData(read);
    const segments = buildSegments(data, turned.width);
    const fields = extractFields(segments, turned.height, classifyLines(segments.map((s) => s.text)));
    const words = segments.flatMap((s) => s.words);
    const confidentWords = words.filter((w) => w.confidence >= 60).length;
    const meanConfidence = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length / 100 : 0;
    const geometry: VariantGeometry = {
      scale: 1,
      padPx: 0,
      offsetX: 0,
      offsetY: 0,
      workScale: 1,
      skewDeg: 0,
      quarterTurns: read.quarterTurns,
      turnSourceWidth: source.width,
      turnSourceHeight: source.height,
      centreX: 0,
      centreY: 0,
    };
    const variant: PreprocessVariant = { name: 'normalised', buffer: Buffer.alloc(0), width: turned.width, height: turned.height, geometry, inverted: false };
    const pass: Pass = {
      variant,
      psm: 'CLOUD',
      result: { data } as unknown as Pass['result'],
      segments,
      fields,
      confidentWords,
      meanConfidence,
    };
    // The preview the officer sees is the photograph turned upright.
    const preprocessing = await preprocessForOcr(pixels, { quarterTurns: read.quarterTurns });
    if (process.env.OCR_DEBUG) console.log(`[cloud] ${read.provider} lines=${read.lines.length} turns=${read.quarterTurns} fields=${Object.keys(fields).length}`);
    return { best: pass, passes: [pass], fields: mergeFields([pass]), refocused: false, preprocessing, engine: cloudEngineLabel(read.provider) };
  } catch (err) {
    console.warn('[ocr] cloud recogniser failed, using the local engine:', (err as Error).message);
    return null;
  }
}

/** Cloud first when configured; the local engine when the cloud read is thin or unavailable. */
async function recogniseAny(buffer: Buffer, pixels: RgbaSource, source: LoadedImage, mode: 'fields' | 'text'): Promise<Recognition> {
  const cloud = await cloudRecognition(buffer, pixels, source);
  if (!cloud) return recognise(pixels, source, mode);
  // A near-complete cloud read stands alone. Otherwise the local engine reads
  // too and the declarations are merged across both, each key taking the
  // better-supported hit — the local engine's crops and inversions still find
  // things a single hosted pass misses.
  if (mode === 'fields' ? Object.keys(cloud.fields).length >= 8 : cloud.best.confidentWords >= 40) return cloud;
  const local = await recognise(pixels, source, mode);
  const passes = [...cloud.passes, ...local.passes];
  const lead = passScore(cloud.best, mode) >= passScore(local.best, mode) ? cloud : local;
  return {
    best: lead.best,
    passes,
    fields: mergeFields(passes),
    refocused: lead.refocused,
    preprocessing: lead.preprocessing,
    engine: lead === cloud ? cloud.engine : `${ENGINE} + ${cloud.engine}`,
  };
}

/* --------------------------------------------------------------- Quality */

const MIN_RELIABLE_CAP_PX = 18;

function medianOf(values: number[]) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Words the recogniser was confident about that also look like language or a
 * number — the test the orientation probe uses. Wall texture, hair and stripes
 * produce dozens of "words" like "il", "3" and "a N\ /" at low confidence; a
 * printed panel produces many real ones.
 */
function realWordCount(pass: Pass): number {
  return pass.segments
    .flatMap((s) => s.words)
    .filter((w) => w.confidence >= 60 && /[A-Za-z]{3,}|\d{3,}/.test(w.text)).length;
}

function labelPresent(rec: Recognition): boolean {
  const realWords = Math.max(...rec.passes.map(realWordCount));
  // Only confident, word-like declarations count: background noise yields
  // "values" such as "Ps +" at 17% that must not vouch for a label.
  const strongDeclarations = Object.values(rec.fields).filter(
    (pick) => pick && pick.hit.confidence >= 0.6 && /[A-Za-z0-9]{3}/.test(pick.hit.value),
  ).length;
  return realWords >= 6 || strongDeclarations >= 2;
}

const NO_LABEL_ADVICE =
  'No readable label was found in this photograph — either no printed panel is in the frame, or the print is too small or blurred to read. Fill the frame with the panel that carries the declarations (name, net quantity, MRP, dates, manufacturer), hold the camera steady about 15–20 cm away, and scan again.';

function assessQuality(pass: Pass, declarationsFound: number, refocused: boolean, labelDetected = true): OcrQuality {
  const g = pass.variant.geometry;
  const recogniserCap = medianOf(pass.segments.map((s) => s.capHeightPx));
  const sourceCap = Number((recogniserCap / (g.scale * g.workScale)).toFixed(1));
  const wordsRead = pass.segments.reduce((n, s) => n + s.words.length, 0);

  if (!labelDetected) {
    return {
      medianCapHeightPx: sourceCap,
      meanConfidence: Number(pass.meanConfidence.toFixed(2)),
      declarationsFound: 0,
      wordsRead,
      passUsed: `${pass.variant.name}/${pass.psm}`,
      upscaleApplied: Number(g.scale.toFixed(2)),
      refocused,
      labelDetected: false,
      level: 'POOR',
      advice: NO_LABEL_ADVICE,
    };
  }

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
    labelDetected: true,
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

/** Section tag for display: only confident, non-OTHER classifications are surfaced. */
function sectionOf(text: string): Pick<OcrLine, 'section' | 'sectionConfidence'> {
  const tag = classifyLine(text);
  if (tag.section === 'OTHER' || tag.confidence < 0.55) return {};
  return { section: tag.section, sectionConfidence: tag.confidence };
}

function linesOf(pass: Pass, source: LoadedImage): OcrLine[] {
  return pass.segments.map((s) => {
    const box = toSourceBox(s.bbox, pass.variant.geometry);
    return {
      text: s.text,
      confidence: Number(s.confidence.toFixed(2)),
      box: normaliseBox(box, source.width, source.height),
      ...sectionOf(s.text),
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
  const rec = await recogniseAny(request.buffer, pixels, source, 'fields');
  const { best } = rec;

  const mmPerPx =
    request.panelWidthMm && request.panelWidthMm > 0 ? request.panelWidthMm / source.width : null;
  const minMm = request.minHeightMm ?? DEFAULT_MIN_HEIGHT_MM;

  const labelDetected = labelPresent(rec);

  const declarations: Declaration[] = DECLARATION_ORDER.map((key: DeclarationKey) => {
    // Without a label, every "reading" is noise from the background — report none.
    const pick = labelDetected ? rec.fields[key] : undefined;
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

  markNotApplicable(declarations);
  const detected = declarations.filter((d) => d.detectedValue);
  const { lines, extra } = mergeLines(best, rec.passes, source);
  const rawText = [best.result.data.text.replace(/\n{3,}/g, '\n\n').trim(), ...extra.map((l) => l.text)]
    .filter(Boolean)
    .join('\n');

  return {
    ocr: {
      imageId: request.imageId,
      engine: rec.engine ?? ENGINE,
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
    quality: assessQuality(best, detected.length, rec.refocused, labelDetected),
    preprocessing: summarisePreprocessing(rec),
    lines,
  };
}

/** Plain text extraction — what the recogniser can read, line by line. */
/** The twelve declarations with the source-image box of each hit. */
function declarationsOf(rec: Recognition, source: LoadedImage): TextDeclaration[] {
  return DECLARATION_ORDER.map((key: DeclarationKey) => {
    const pick = rec.fields[key];
    if (!pick) return { key, label: DECLARATION_LABELS[key], detectedValue: null, confidence: 0, box: null };
    const g = pick.pass.variant.geometry;
    const segs = pick.hit.segments;
    const recogniserBox = {
      x0: Math.min(...segs.map((s) => s.bbox.x0)),
      y0: Math.min(...segs.map((s) => s.bbox.y0)),
      x1: Math.max(...segs.map((s) => s.bbox.x1)),
      y1: Math.max(...segs.map((s) => s.bbox.y1)),
    };
    return {
      key,
      label: DECLARATION_LABELS[key],
      detectedValue: pick.hit.value,
      confidence: Number(pick.hit.confidence.toFixed(2)),
      box: normaliseBox(toSourceBox(recogniserBox, g), source.width, source.height),
    };
  });
}

export async function extractText(buffer: Buffer): Promise<TextExtraction> {
  const started = Date.now();
  const pixels = await decodeSource(buffer);
  const source = await loadImage(pixels);
  const rec = await recogniseAny(buffer, pixels, source, 'text');
  const { lines } = mergeLines(rec.best, rec.passes, source);
  const labelDetected = labelPresent(rec);
  return {
    rawText: lines.map((l) => l.text).join('\n'),
    lines,
    declarations: labelDetected
      ? markNotApplicable(declarationsOf(rec, source))
      : DECLARATION_ORDER.map((key: DeclarationKey) => ({ key, label: DECLARATION_LABELS[key], detectedValue: null, confidence: 0, box: null })),
    quality: assessQuality(rec.best, Object.keys(rec.fields).length, rec.refocused, labelDetected),
    preprocessing: summarisePreprocessing(rec),
    processingMs: Date.now() - started,
    imageWidth: source.width,
    imageHeight: source.height,
  };
}
