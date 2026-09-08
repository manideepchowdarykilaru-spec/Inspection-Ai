/**
 * Degrades the clean test label into something resembling a hand-held camera
 * photograph: the package occupies part of the frame, the exposure is uneven,
 * focus is soft and JPEG compression has been applied.
 *
 * Used to test OCR robustness without needing a physical package to hand.
 */
import { Jimp } from 'jimp';
import { writeFileSync } from 'node:fs';

const src = await Jimp.read(new URL('../../scratch/test-label.png', import.meta.url).pathname.slice(1));

// A phone held at arm's length: the label is maybe 55% of the frame.
const frameW = 1080;
const frameH = 1440;
const labelW = Math.round(frameW * 0.72);
const label = src.clone().resize({ w: labelW });

const frame = new Jimp({ width: frameW, height: frameH, color: 0xe8e4dcff });
frame.composite(label, Math.round((frameW - labelW) / 2), Math.round((frameH - label.bitmap.height) / 2));

// Soft focus, a warm indoor cast and reduced contrast from ambient light.
frame.blur(1);
frame.brightness(1.06);
frame.contrast(-0.12);

// Uneven exposure: a bright gradient across the panel, as from a shop light.
for (let y = 0; y < frameH; y++) {
  for (let x = 0; x < frameW; x++) {
    const glare = Math.max(0, 1 - Math.hypot(x - frameW * 0.7, y - frameH * 0.35) / (frameW * 0.75));
    if (glare <= 0) continue;
    const idx = (y * frameW + x) * 4;
    const lift = glare * 46;
    for (let c = 0; c < 3; c++) {
      frame.bitmap.data[idx + c] = Math.min(255, frame.bitmap.data[idx + c] + lift);
    }
  }
}

const buffer = await frame.getBuffer('image/jpeg', { quality: 72 });
writeFileSync(new URL('../../scratch/photo-sim.jpg', import.meta.url), buffer);
console.log(`wrote photo-sim.jpg  ${frameW}x${frameH}  ${(buffer.length / 1024).toFixed(0)} KB`);
