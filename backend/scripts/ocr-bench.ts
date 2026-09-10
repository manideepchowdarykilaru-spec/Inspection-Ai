/**
 * OCR robustness bench.
 *
 * Runs the full recogniser over the clean label and every adversarial variant
 * and prints, per image: declarations located, mean confidence, the variant and
 * segmentation mode that won, whether a refocus crop was taken, the detected
 * skew and polarity, and the wall time. Run after any change to the pipeline.
 *
 *   npm run ocr:bench
 */
import { existsSync, readFileSync } from 'node:fs';
import { recognisePackage, shutdown } from '../src/ocr/index';

const FILES = [
  'test-label.png',
  'photo-sim.jpg',
  'rotated.jpg',
  'inverted.jpg',
  'shadow.jpg',
  'noisy.jpg',
  'small.jpg',
  'combined.jpg',
  'sideways-red.jpg',
  'perspective.jpg',
  'coloured.jpg',
  'perspective-coloured.jpg',
  'edge-text.jpg',
  'mixed-orientation.jpg',
  'webcam-close.jpg',
  'webcam-720p.jpg',
];

const pad = (s: string | number, n: number) => String(s).padEnd(n);

console.log(
  `${pad('image', 17)}${pad('fields', 8)}${pad('conf', 6)}${pad('pass', 20)}${pad('crop', 6)}${pad('skew', 7)}${pad('turn', 6)}${pad('inv', 5)}${pad('lbl', 5)}${pad('level', 10)}ms`,
);
console.log('-'.repeat(98));

let totalFields = 0;
let count = 0;

for (const file of FILES) {
  const url = new URL(`../../scratch/${file}`, import.meta.url);
  if (!existsSync(url)) continue;
  const buffer = readFileSync(url);
  const t0 = Date.now();
  const r = await recognisePackage({ buffer, imageId: 'bench' });
  const found = r.declarations.filter((d) => d.detectedValue).length;
  totalFields += found;
  count += 1;
  console.log(
    `${pad(file, 17)}${pad(`${found}/12`, 8)}${pad(r.quality.meanConfidence, 6)}${pad(r.quality.passUsed, 20)}` +
      `${pad(r.quality.refocused ? 'yes' : '-', 6)}${pad(r.preprocessing.skewDeg ? `${r.preprocessing.skewDeg}°` : '-', 7)}` +
      `${pad(r.preprocessing.quarterTurns ? `${r.preprocessing.quarterTurns * 90}°` : '-', 6)}` +
      `${pad(r.preprocessing.inverted ? 'yes' : '-', 5)}${pad(r.quality.labelDetected ? 'yes' : 'NO', 5)}${pad(r.quality.level, 10)}${Date.now() - t0}`,
  );
  if (process.argv.includes('--verbose')) {
    for (const d of r.declarations) {
      if (d.detectedValue) console.log(`      ${pad(d.key, 22)} ${d.detectedValue.slice(0, 60)}`);
    }
  }
}

console.log('-'.repeat(98));
console.log(`mean declarations located: ${(totalFields / Math.max(count, 1)).toFixed(1)} / 12 over ${count} images`);
await shutdown();
