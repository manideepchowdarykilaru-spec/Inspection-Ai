/**
 * Feature extraction for the declaration-section classifier.
 *
 * A line of OCR text is turned into a sparse bag of hashed features: word
 * unigrams and bigrams, character trigrams of the normalised text, and a small
 * set of shape features (has a currency mark, a date, a PIN code, a phone
 * number, a unit, and so on). Digits are collapsed to a single symbol so
 * "07/2026" and "12/2027" share features, and everything is lower-cased.
 * Hashing keeps the model a fixed size regardless of vocabulary.
 */

export const FEATURE_DIM = 4096;

export const SECTION_CLASSES = [
  'PRODUCT_IDENTITY',
  'MANUFACTURER_NAME',
  'MANUFACTURER_ADDRESS',
  'NET_QUANTITY',
  'MRP',
  'CONSUMER_CARE',
  'DATE_OF_PACKING',
  'BEST_BEFORE',
  'COUNTRY_OF_ORIGIN',
  'IMPORTER_DETAILS',
  'FSSAI_LICENSE',
  'BATCH_NUMBER',
  'OTHER',
] as const;

export type SectionClass = (typeof SECTION_CLASSES)[number];

/** FNV-1a 32-bit hash, reduced to the feature dimension. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % FEATURE_DIM;
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[₹]/g, ' rs ')
    .replace(/\d/g, '0')
    .replace(/[^a-z0-9%./:@&()+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SHAPES: [string, RegExp][] = [
  ['#currency', /₹|\brs\.?\b|\binr\b|\bmrp\b/i],
  ['#price', /\d[\d,]*\.\d{2}\b/],
  ['#date', /\b(?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:20)?\d{2}\b/i],
  ['#months', /\b\d{1,2}\s*months?\b/i],
  ['#pin', /\b\d{3}\s?\d{3}\b/],
  ['#phone', /\b1800[\s-]?\d{3}[\s-]?\d{3,4}\b|\+91|\b\d{10}\b/],
  ['#email', /[\w.+-]+@[\w-]+\.[\w.]+/],
  ['#web', /www\.|\.com\b|\.in\b|\.co\.in\b/i],
  ['#unit', /\b\d+(?:\.\d+)?\s*(?:mg|g|gm|gms|kg|ml|l|ltr|litres?|n|pcs|pieces)\b/i],
  ['#count', /\b\d+\s*n\s*x\b/i],
  ['#long14', /\b\d{14}\b/],
  ['#code', /\b[A-Z]{1,3}[\s-]?\d{3,6}(?:[\s-]?[A-Z0-9]{1,5})?\b/],
  ['#corp', /\b(?:ltd|limited|pvt|private|llp|inc|industries|foods|mills|co)\b\.?/i],
  ['#addr', /\b(?:road|street|marg|nagar|house|plot|estate|park|sector|p\.?o\.?|distt|dist|vill|village|tehsil|floor)\b/i],
  ['#state', /\b(?:gujarat|maharashtra|telangana|karnataka|tamil nadu|kerala|delhi|uttar pradesh|uttarakhand|punjab|haryana|rajasthan|madhya pradesh|west bengal|assam|bihar|odisha|andhra|himachal|goa)\b/i],
  ['#country', /\b(?:india|china|sri lanka|nepal|usa|uk|uae|thailand|malaysia|indonesia|vietnam)\b/i],
  ['#allcaps', /^[^a-z]*[A-Z][^a-z]*$/],
  ['#short', /^.{1,14}$/],
  ['#long', /^.{60,}$/],
  ['#colon', /:/],
  ['#paren', /\(/],
  ['#pct', /%/],
  ['#digits-heavy', /^(?:[^\d]*\d){6,}/],
];

/** Sparse feature vector as index → weight. */
export function featurise(text: string): Map<number, number> {
  const f = new Map<number, number>();
  const add = (key: string, w = 1) => {
    const i = hash(key);
    f.set(i, (f.get(i) ?? 0) + w);
  };

  const norm = normalise(text);
  const words = norm.split(' ').filter(Boolean);
  for (const w of words) add(`w:${w}`);
  for (let i = 0; i < words.length - 1; i++) add(`b:${words[i]}_${words[i + 1]}`);
  if (words.length) {
    add(`first:${words[0]}`, 1.5);
    add(`last:${words[words.length - 1]}`);
  }
  const padded = ` ${norm} `;
  for (let i = 0; i < padded.length - 2; i++) add(`c:${padded.slice(i, i + 3)}`, 0.5);

  for (const [name, re] of SHAPES) if (re.test(text)) add(name, 2);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const total = Math.max(1, text.replace(/\s/g, '').length);
  add(`#digit-ratio:${Math.min(4, Math.floor((digits / total) * 5))}`, 1.5);
  add(`#letter-ratio:${Math.min(4, Math.floor((letters / total) * 5))}`, 1.5);
  add(`#words:${Math.min(8, words.length)}`);
  add('#bias');

  // L2-normalise so long lines do not dominate.
  let sq = 0;
  for (const v of f.values()) sq += v * v;
  const inv = 1 / Math.sqrt(sq || 1);
  for (const [k, v] of f) f.set(k, v * inv);
  return f;
}
