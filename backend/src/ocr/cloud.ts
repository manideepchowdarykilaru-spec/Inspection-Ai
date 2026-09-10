/**
 * Cloud recognisers. The local engine (tesseract.js) reads clean, upright
 * cartons well and phone photographs of curved, glossy or tiny print badly;
 * a hosted recogniser reads those too. Either provider returns words with
 * boxes in source pixels, grouped into lines; the rest of the pipeline — the
 * column split, the caption readers, the classifier, the rule engine — is the
 * same code that runs on the local engine's output.
 *
 *   OCR_PROVIDER=google    GOOGLE_VISION_API_KEY=…   Cloud Vision DOCUMENT_TEXT_DETECTION
 *   OCR_PROVIDER=ocrspace  OCRSPACE_API_KEY=…        OCR.space engine 2 (free key by e-mail)
 *   OCR_PROVIDER=tesseract (default)                 local only
 *
 * The local engine remains the fallback whenever the provider is unreachable
 * or returns too little to be a label.
 */
import type { RecognizeResult } from 'tesseract.js';
import type { Box, OcrWord } from './segments';

export type CloudProvider = 'google' | 'ocrspace';

export interface CloudLine {
  text: string;
  confidence: number; // 0..100
  bbox: Box;
  words: OcrWord[]; // confidence 0..100
}

export interface CloudRead {
  provider: CloudProvider;
  /** Lines in source pixels, already grouped by the provider (or by geometry). */
  lines: CloudLine[];
  fullText: string;
  /** Clockwise quarter turns that make the text upright (0 when already upright). */
  quarterTurns: 0 | 1 | 2 | 3;
}

export function cloudProvider(): CloudProvider | null {
  const p = (process.env.OCR_PROVIDER ?? '').toLowerCase();
  if (p === 'google' && process.env.GOOGLE_VISION_API_KEY) return 'google';
  if (p === 'ocrspace' && process.env.OCRSPACE_API_KEY) return 'ocrspace';
  if (!p) {
    if (process.env.GOOGLE_VISION_API_KEY) return 'google';
    if (process.env.OCRSPACE_API_KEY) return 'ocrspace';
  }
  return null;
}

export function cloudEngineLabel(provider: CloudProvider): string {
  return provider === 'google' ? 'Google Cloud Vision · document text' : 'OCR.space engine 2';
}

const TIMEOUT_MS = Number(process.env.OCR_CLOUD_TIMEOUT_MS ?? 25_000);

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ geometry */

interface Vertex {
  x?: number;
  y?: number;
}

function boxOf(vertices: Vertex[] | undefined): Box | null {
  if (!vertices || vertices.length < 2) return null;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Which way the text runs, from the first two vertices of a word's polygon
 * (Vision lists them in reading order: top-left, top-right, bottom-right,
 * bottom-left *of the text*, whatever its orientation in the photo).
 */
function turnsFor(vertices: Vertex[] | undefined): 0 | 1 | 2 | 3 | null {
  if (!vertices || vertices.length < 2) return null;
  const dx = (vertices[1].x ?? 0) - (vertices[0].x ?? 0);
  const dy = (vertices[1].y ?? 0) - (vertices[0].y ?? 0);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = reads left→right
  if (angle > -45 && angle <= 45) return 0;
  if (angle > 45 && angle <= 135) return 3; // reads top→bottom: turn the frame 270° cw (90° ccw) to right it
  if (angle > -135 && angle <= -45) return 1; // reads bottom→top
  return 2;
}

/** Applies `turns` clockwise quarter turns to a point, the way rotate90 turns the image. */
export function turnPoint(x: number, y: number, turns: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
  let w = width;
  let h = height;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const nx = h - y;
    const ny = x;
    x = nx;
    y = ny;
    [w, h] = [h, w];
  }
  return { x, y, width: w, height: h };
}

function turnBox(b: Box, turns: number, width: number, height: number): Box {
  const a = turnPoint(b.x0, b.y0, turns, width, height);
  const c = turnPoint(b.x1, b.y1, turns, width, height);
  return { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
}

/* ------------------------------------------------------- Google Vision */

interface VisionSymbol {
  text?: string;
  confidence?: number;
  property?: { detectedBreak?: { type?: string } };
}
interface VisionWord {
  boundingBox?: { vertices?: Vertex[] };
  confidence?: number;
  symbols?: VisionSymbol[];
}
interface VisionParagraph {
  words?: VisionWord[];
}
interface VisionBlock {
  paragraphs?: VisionParagraph[];
}
interface VisionResponse {
  responses?: Array<{
    error?: { message?: string };
    fullTextAnnotation?: { text?: string; pages?: Array<{ blocks?: VisionBlock[] }> };
  }>;
}

async function readWithGoogle(image: Buffer, width: number, height: number): Promise<CloudRead> {
  const key = process.env.GOOGLE_VISION_API_KEY!;
  const json = (await postJson(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    requests: [
      {
        image: { content: image.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['en'] },
      },
    ],
  })) as VisionResponse;
  const response = json.responses?.[0];
  if (!response) throw new Error('Vision returned no response');
  if (response.error?.message) throw new Error(`Vision: ${response.error.message}`);

  // Lines: words in a paragraph run on until a symbol carries a line break.
  const raw: { words: { text: string; confidence: number; vertices: Vertex[] }[] }[] = [];
  const turnVotes = [0, 0, 0, 0];
  for (const page of response.fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        let current: (typeof raw)[number] = { words: [] };
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text ?? '').join('');
          const vertices = word.boundingBox?.vertices ?? [];
          if (text.trim()) {
            current.words.push({ text, confidence: Math.round((word.confidence ?? 0.9) * 100), vertices });
            const t = turnsFor(vertices);
            if (t !== null && text.length >= 2) turnVotes[t] += text.length;
          }
          const brk = word.symbols?.[word.symbols.length - 1]?.property?.detectedBreak?.type;
          if (brk === 'LINE_BREAK' || brk === 'EOL_SURE_SPACE') {
            if (current.words.length) raw.push(current);
            current = { words: [] };
          }
        }
        if (current.words.length) raw.push(current);
      }
    }
  }
  const quarterTurns = turnVotes.indexOf(Math.max(...turnVotes)) as 0 | 1 | 2 | 3;

  const lines: CloudLine[] = raw.map((line) => {
    const words: OcrWord[] = line.words
      .map((w) => {
        const b = boxOf(w.vertices);
        return b ? { text: w.text, confidence: w.confidence, bbox: turnBox(b, quarterTurns, width, height) } : null;
      })
      .filter((w): w is OcrWord => w !== null)
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const bbox: Box = {
      x0: Math.min(...words.map((w) => w.bbox.x0)),
      y0: Math.min(...words.map((w) => w.bbox.y0)),
      x1: Math.max(...words.map((w) => w.bbox.x1)),
      y1: Math.max(...words.map((w) => w.bbox.y1)),
    };
    return {
      text: words.map((w) => w.text).join(' '),
      confidence: words.reduce((s, w) => s + w.confidence, 0) / Math.max(1, words.length),
      bbox,
      words,
    };
  });
  return { provider: 'google', lines, fullText: response.fullTextAnnotation?.text ?? '', quarterTurns };
}

/**
 * OCR.space tokenises punctuation as words of its own — "csc @ marico . com",
 * "Rs . 00 . 53", "1800 - 208 - 2653". A punctuation token that sits tight
 * against its neighbours is glued back onto them so e-mails, prices and phone
 * numbers read as one token again.
 */
export function gluePunctuation(words: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  const priceLine = words.some((w) => /m\.?\s?r\.?\s?p|^rs\.?$|₹|taxes/i.test(w.text));
  const isPunct = (t: string) => /^[.,:;@/\-()]+$/.test(t);
  const gap = (a: OcrWord, b: OcrWord) => b.bbox.x0 - a.bbox.x1;
  const height = (w: OcrWord) => Math.max(8, w.bbox.y1 - w.bbox.y0);
  const merge = (a: OcrWord, b: OcrWord, space: boolean): OcrWord => ({
    text: space ? `${a.text} ${b.text}` : a.text + b.text,
    confidence: Math.min(a.confidence, b.confidence),
    bbox: { x0: Math.min(a.bbox.x0, b.bbox.x0), y0: Math.min(a.bbox.y0, b.bbox.y0), x1: Math.max(a.bbox.x1, b.bbox.x1), y1: Math.max(a.bbox.y1, b.bbox.y1) },
  });
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && isPunct(w.text) && gap(prev, w) < height(prev) * 0.7) {
      out[out.length - 1] = merge(prev, w, false);
      continue;
    }
    if (prev && gap(prev, w) < height(prev) * 0.45) {
      // "csc@" + "marico" → "csc@marico"; "20." + "00" → "20.00"; "marico." + "com" → "marico.com";
      // "1800-" + "208" → "1800-208". "Ltd." + "7th" and "contact:" stay separate words.
      const joinsNumber = /\d[.,:]$/.test(prev.text) && /^\d/.test(w.text);
      const joinsAddress = /[@/\-]$/.test(prev.text) && /^[A-Za-z0-9]/.test(w.text);
      const joinsDomain = /\.$/.test(prev.text) && (/@/.test(prev.text) || /^(?:com|in|org|net|co|biz|info)\b/i.test(w.text));
      if (joinsNumber || joinsAddress || joinsDomain) {
        const joined = merge(prev, w, false);
        // A colon between digits is a dot-matrix full stop the recogniser misread.
        if (joinsNumber && priceLine) joined.text = joined.text.replace(/(\d):(\d)/g, '$1.$2');
        out[out.length - 1] = joined;
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

/* ------------------------------------------------------------ OCR.space */

interface SpaceWord {
  WordText?: string;
  Left?: number;
  Top?: number;
  Height?: number;
  Width?: number;
}
interface SpaceLine {
  LineText?: string;
  Words?: SpaceWord[];
}
interface SpaceResponse {
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ParsedResults?: Array<{
    TextOrientation?: string;
    ParsedText?: string;
    TextOverlay?: { Lines?: SpaceLine[] };
  }>;
}

async function readWithOcrSpace(image: Buffer, mime: string, width: number, height: number): Promise<CloudRead> {
  const key = process.env.OCRSPACE_API_KEY!;
  const form = new FormData();
  form.set('base64Image', `data:${mime};base64,${image.toString('base64')}`);
  form.set('language', 'eng');
  form.set('OCREngine', '2');
  form.set('isOverlayRequired', 'true');
  form.set('detectOrientation', 'true');
  form.set('scale', 'true');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let json: SpaceResponse;
  try {
    const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', headers: { apikey: key }, body: form, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    json = (await res.json()) as SpaceResponse;
  } finally {
    clearTimeout(timer);
  }
  if (json.IsErroredOnProcessing) {
    const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join('; ') : json.ErrorMessage;
    throw new Error(`OCR.space: ${msg ?? 'processing error'}`);
  }
  const result = json.ParsedResults?.[0];
  if (!result) throw new Error('OCR.space returned no result');
  // The overlay gives each line's words in reading order with boxes in the
  // photograph's frame. Sideways text is detected from where a line's last
  // word sits relative to its first, the boxes are turned upright, and the
  // words are then ordered left-to-right in that upright frame.
  const rawLines = (result.TextOverlay?.Lines ?? []).map((line) =>
    (line.Words ?? [])
      .filter((w) => (w.WordText ?? '').trim())
      .map((w) => ({
        text: w.WordText!.trim(),
        confidence: 85,
        bbox: { x0: w.Left ?? 0, y0: w.Top ?? 0, x1: (w.Left ?? 0) + (w.Width ?? 0), y1: (w.Top ?? 0) + (w.Height ?? 0) } as Box,
      })),
  );
  const votes = [0, 0, 0, 0];
  for (const words of rawLines) {
    if (words.length < 2) continue;
    const first = words[0].bbox;
    const last = words[words.length - 1].bbox;
    const dx = (last.x0 + last.x1 - first.x0 - first.x1) / 2;
    const dy = (last.y0 + last.y1 - first.y0 - first.y1) / 2;
    const t = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : dy >= 0 ? 3 : 1;
    votes[t] += words.length;
  }
  const quarterTurns = votes.indexOf(Math.max(...votes)) as 0 | 1 | 2 | 3;
  const lines: CloudLine[] = rawLines
    .map((raw) => {
      const words: OcrWord[] = gluePunctuation(
        raw.map((w) => ({ ...w, bbox: turnBox(w.bbox, quarterTurns, width, height) })).sort((a, b) => a.bbox.x0 - b.bbox.x0),
      );
      if (!words.length) return null;
      return {
        text: words.map((w) => w.text).join(' '),
        confidence: 85,
        bbox: {
          x0: Math.min(...words.map((w) => w.bbox.x0)),
          y0: Math.min(...words.map((w) => w.bbox.y0)),
          x1: Math.max(...words.map((w) => w.bbox.x1)),
          y1: Math.max(...words.map((w) => w.bbox.y1)),
        },
        words,
      };
    })
    .filter((l): l is CloudLine => l !== null);
  return { provider: 'ocrspace', lines, fullText: result.ParsedText ?? '', quarterTurns };
}

/* --------------------------------------------------------------- public */

export async function readWithCloud(image: Buffer, mime: string, width: number, height: number): Promise<CloudRead | null> {
  const provider = cloudProvider();
  if (!provider) return null;
  return provider === 'google' ? readWithGoogle(image, width, height) : readWithOcrSpace(image, mime, width, height);
}

/**
 * The provider's lines in the shape tesseract.js returns them, so the same
 * column-splitting segment builder runs over both engines' output.
 */
export function asRecognizeData(read: CloudRead): RecognizeResult['data'] {
  return {
    text: read.fullText,
    blocks: [
      {
        paragraphs: [
          {
            lines: read.lines.map((l) => ({
              text: l.text,
              confidence: l.confidence,
              bbox: l.bbox,
              words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
            })),
          },
        ],
      },
    ],
  } as unknown as RecognizeResult['data'];
}
