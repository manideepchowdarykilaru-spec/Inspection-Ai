/**
 * Runs the field extractor over the transcribed label fixtures and reports every
 * declaration that does not match its expected value.
 *
 *   npm run extract:test            all fixtures
 *   npm run extract:test -- dove    fixtures whose name contains "dove"
 *
 * Lines are laid out as a single column in reading order; captions and values
 * that share a printed line share a segment, which is what the OCR produces on
 * these panels. This checks the extraction logic on the wording; the OCR bench
 * checks the pixels.
 */
import { extractFields } from '../src/ocr/extract';
import { classifyLines } from '../src/ocr/nlp/classifier';
import type { Segment } from '../src/ocr/segments';
import { CARTONS } from './fixtures/cartons';

const KEYS = [
  'PRODUCT_IDENTITY', 'MANUFACTURER_NAME', 'MANUFACTURER_ADDRESS', 'NET_QUANTITY', 'MRP', 'CONSUMER_CARE',
  'DATE_OF_PACKING', 'BEST_BEFORE', 'COUNTRY_OF_ORIGIN', 'FSSAI_LICENSE', 'BATCH_NUMBER', 'IMPORTER_DETAILS',
] as const;

function segmentsFor(lines: string[]): Segment[] {
  return lines.map((text, i) => {
    const y0 = 40 + i * 34;
    const bbox = { x0: 20, y0, x1: 20 + Math.max(4, text.length) * 11, y1: y0 + 26 };
    const tokens = text.split(/\s+/).filter(Boolean);
    const step = (bbox.x1 - bbox.x0) / Math.max(1, tokens.length);
    const words = tokens.map((w, j) => ({
      text: w,
      confidence: 90,
      bbox: { x0: bbox.x0 + j * step, y0, x1: bbox.x0 + (j + 1) * step - 4, y1: y0 + 26 },
    }));
    return { text, confidence: 0.9, bbox, words, capHeightPx: i < 3 ? 40 - i * 6 : 26 };
  });
}

const filter = process.argv[2]?.toLowerCase();
let failures = 0;
let checks = 0;

for (const carton of CARTONS) {
  if (filter && !carton.name.toLowerCase().includes(filter)) continue;
  const segments = segmentsFor(carton.lines);
  const fields = extractFields(segments, 40 + carton.lines.length * 34 + 40, classifyLines(carton.lines)) as Record<
    string,
    { value: string; confidence: number } | undefined
  >;
  console.log(`\n=== ${carton.name} ===`);
  for (const key of KEYS) {
    const got = fields[key]?.value ?? null;
    const want = carton.expect[key];
    let ok: boolean | null = null;
    if (want !== undefined) {
      checks++;
      ok =
        want === null
          ? got === null
          : got !== null && (want instanceof RegExp ? want.test(got) : got.toLowerCase().includes(want.toLowerCase()));
      if (!ok) failures++;
    }
    const mark = ok === null ? '     ' : ok ? '  ok ' : ' FAIL';
    const expectation = want === undefined ? '' : want === null ? '  (expected: not present)' : ok ? '' : `  (expected: ${want instanceof RegExp ? want.source : want})`;
    console.log(`${mark} ${key.padEnd(22)} ${(got ?? '—').slice(0, 70)}${expectation}`);
  }
}

console.log(`\n${checks - failures}/${checks} expectations met across ${CARTONS.length} cartons`);
if (failures) process.exitCode = 1;
