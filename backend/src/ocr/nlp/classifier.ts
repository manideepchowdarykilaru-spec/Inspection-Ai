import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_DIM, SECTION_CLASSES, featurise, type SectionClass } from './features';

/**
 * Declaration-section classifier.
 *
 * Tags a line of label text with the declaration it belongs to — MRP, net
 * quantity, packing date, expiry, manufacturer, address, consumer care, FSSAI
 * licence, batch, country, importer, product name — or OTHER for ingredients,
 * directions and marketing copy. The model is a softmax regression over hashed
 * text features trained by backend/scripts/train-line-classifier.ts; it runs
 * in well under a millisecond per line and needs no external service.
 *
 * It complements the caption patterns in extract.ts: where a caption is
 * missing, garbled or printed in another orientation, the tag says what a line
 * is, and the value is then pulled from it with the class's own pattern.
 */

export interface LineTag {
  section: SectionClass;
  /** Probability of the winning class, 0..1. */
  confidence: number;
  /** Runner-up, useful for ambiguous date lines. */
  second: SectionClass;
  secondConfidence: number;
}

interface Model {
  version: number;
  featureDim: number;
  classes: readonly string[];
  scales: number[];
  weights: string;
}

let loaded: { W: Int8Array; scales: Float32Array; K: number } | null = null;

function model() {
  if (loaded) return loaded;
  const path = fileURLToPath(new URL('./model.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Model;
  if (raw.featureDim !== FEATURE_DIM || raw.classes.length !== SECTION_CLASSES.length) {
    throw new Error('nlp/model.json does not match features.ts — run `npm run nlp:train`');
  }
  const buf = Buffer.from(raw.weights, 'base64');
  loaded = {
    W: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    scales: Float32Array.from(raw.scales),
    K: raw.classes.length,
  };
  return loaded;
}

export function classifyLine(text: string): LineTag {
  const { W, scales, K } = model();
  const f = featurise(text);
  const z = new Float64Array(K);
  for (const [i, v] of f) {
    for (let k = 0; k < K; k++) z[k] += W[k * FEATURE_DIM + i] * scales[k] * v;
  }
  let max = -Infinity;
  for (const v of z) max = Math.max(max, v);
  let sum = 0;
  for (let k = 0; k < K; k++) {
    z[k] = Math.exp(z[k] - max);
    sum += z[k];
  }
  let best = 0;
  let second = -1;
  for (let k = 0; k < K; k++) {
    z[k] /= sum;
    if (z[k] > z[best]) {
      second = best;
      best = k;
    } else if (second < 0 || z[k] > z[second]) {
      second = k;
    }
  }
  return {
    section: SECTION_CLASSES[best],
    confidence: Number(z[best].toFixed(3)),
    second: SECTION_CLASSES[second < 0 ? best : second],
    secondConfidence: Number((second < 0 ? 0 : z[second]).toFixed(3)),
  };
}

export function classifyLines(texts: string[]): LineTag[] {
  return texts.map(classifyLine);
}

/** Warms the model so the first scan does not pay for parsing it. */
export function warmClassifier() {
  model();
}
