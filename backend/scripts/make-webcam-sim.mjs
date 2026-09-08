/**
 * Simulates a 720p webcam capture: the package occupies part of a low-resolution
 * frame, so the declaration text is only a handful of pixels tall — which is the
 * regime Tesseract fails in.
 */
import { Jimp } from 'jimp';
import { writeFileSync } from 'node:fs';

const src = await Jimp.read(new URL('../../scratch/test-label.png', import.meta.url).pathname.slice(1));

for (const [name, frameW, frameH, fill] of [
  ['webcam-720p.jpg', 1280, 720, 0.62],
  ['webcam-close.jpg', 1280, 720, 0.92],
]) {
  const labelH = Math.round(frameH * fill);
  const label = src.clone().resize({ h: labelH });
  const frame = new Jimp({ width: frameW, height: frameH, color: 0xd9d5ccff });
  frame.composite(label, Math.round((frameW - label.bitmap.width) / 2), Math.round((frameH - labelH) / 2));
  frame.blur(1);
  frame.contrast(-0.1);
  const buffer = await frame.getBuffer('image/jpeg', { quality: 70 });
  writeFileSync(new URL(`../../scratch/${name}`, import.meta.url), buffer);
  const capPx = Math.round(15 * (labelH / src.bitmap.height));
  console.log(`${name}  ${frameW}x${frameH}  body text ~${capPx}px tall  ${(buffer.length / 1024).toFixed(0)} KB`);
}
