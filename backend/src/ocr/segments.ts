import type { RecognizeResult } from 'tesseract.js';

/**
 * Turns a Tesseract result into layout-aware text segments.
 *
 * Tesseract returns a "line" per horizontal band, which on a two-column package
 * label merges unrelated declarations — "NET QUANTITY  MAXIMUM RETAIL PRICE"
 * arrives as one line. Splitting each line at large horizontal gaps recovers the
 * columns, which is what makes keyword→value association work on real packages.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Box;
}

export interface Segment {
  text: string;
  confidence: number;
  bbox: Box;
  words: OcrWord[];
  /** Height of the tallest word — a proxy for printed cap height. */
  capHeightPx: number;
}

interface TesseractLine {
  text: string;
  confidence: number;
  bbox: Box;
  words?: OcrWord[];
}

function collectLines(data: RecognizeResult['data']): TesseractLine[] {
  const blocks = (data as unknown as { blocks?: unknown[] }).blocks;
  if (!Array.isArray(blocks)) return [];
  const lines: TesseractLine[] = [];
  for (const block of blocks as Array<{ paragraphs?: Array<{ lines?: TesseractLine[] }> }>) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (line?.bbox) lines.push(line);
      }
    }
  }
  return lines;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function toSegment(words: OcrWord[]): Segment {
  const bbox = union(words.map((w) => w.bbox));
  return {
    text: clean(words.map((w) => w.text).join(' ')),
    confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length / 100,
    bbox,
    words,
    capHeightPx: Math.max(...words.map((w) => w.bbox.y1 - w.bbox.y0)),
  };
}

/**
 * @param gapRatio Fraction of image width treated as a column break.
 */
export function buildSegments(
  data: RecognizeResult['data'],
  imageWidth: number,
  gapRatio = 0.045,
): Segment[] {
  const gapThreshold = imageWidth * gapRatio;
  const segments: Segment[] = [];

  for (const line of collectLines(data)) {
    // Keep low-confidence words: short numerals such as "1" in "1 kg" score
    // poorly on their own, and dropping them loses the whole declaration. The
    // confidence is surfaced to the officer instead of being filtered away.
    const words = (line.words ?? [])
      .filter((w) => clean(w.text).length > 0 && w.confidence > 8)
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);

    if (words.length === 0) {
      const text = clean(line.text);
      if (text) {
        segments.push({
          text,
          confidence: (line.confidence ?? 0) / 100,
          bbox: line.bbox,
          words: [],
          capHeightPx: line.bbox.y1 - line.bbox.y0,
        });
      }
      continue;
    }

    let group: OcrWord[] = [words[0]];
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].bbox.x0 - group[group.length - 1].bbox.x1;
      if (gap > gapThreshold) {
        segments.push(toSegment(group));
        group = [words[i]];
      } else {
        group.push(words[i]);
      }
    }
    segments.push(toSegment(group));
  }

  return segments
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

/** Horizontal overlap between two boxes as a fraction of the narrower one. */
export function xOverlap(a: Box, b: Box): number {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const narrower = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  return narrower <= 0 ? 0 : overlap / narrower;
}

/**
 * The segment that reads as the value for a caption segment: the closest one
 * below it that shares a column, within a vertical window.
 */
export function segmentBelow(
  segments: Segment[],
  caption: Segment,
  opts: { maxGapPx: number; minOverlap?: number; skip?: (s: Segment) => boolean } = { maxGapPx: 120 },
): Segment | undefined {
  const minOverlap = opts.minOverlap ?? 0.25;
  return segments
    .filter(
      (s) =>
        s !== caption &&
        s.bbox.y0 >= caption.bbox.y1 - (caption.bbox.y1 - caption.bbox.y0) * 0.3 &&
        s.bbox.y0 - caption.bbox.y1 <= opts.maxGapPx &&
        xOverlap(caption.bbox, s.bbox) >= minOverlap &&
        !(opts.skip?.(s) ?? false),
    )
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
}

export function normaliseBox(box: Box, width: number, height: number) {
  return {
    x: Math.max(0, box.x0 / width),
    y: Math.max(0, box.y0 / height),
    w: Math.min(1, (box.x1 - box.x0) / width),
    h: Math.min(1, (box.y1 - box.y0) / height),
  };
}
