/**
 * Builds adversarial variants of the clean test label, each isolating one of
 * the ways a real package photograph defeats OCR:
 *
 *   rotated     camera not square to the panel
 *   inverted    light print on a dark pouch
 *   shadow      strong illumination gradient across the panel
 *   small       label occupies a third of a phone-resolution frame
 *   noisy       sensor noise + heavy JPEG compression
 *   combined    small + rotated + shadow together
 */
import { Jimp } from 'jimp';
import { writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const src = await Jimp.read(new URL('../../scratch/test-label.png', here).pathname.slice(1));

function save(name, image, quality = 82) {
  return image.getBuffer('image/jpeg', { quality }).then((buf) => {
    writeFileSync(new URL(`../../scratch/${name}`, here), buf);
    console.log(`${name.padEnd(16)} ${image.bitmap.width}x${image.bitmap.height}  ${(buf.length / 1024).toFixed(0)} KB`);
  });
}

/** Multiplies each pixel by a horizontal gradient from `left` to `right`. */
function shade(image, left, right) {
  const { width, height, data } = image.bitmap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = left + (right - left) * (x / width);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, data[i + c] * f);
    }
  }
  return image;
}

function addNoise(image, sigma) {
  const { data } = image.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 2;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, data[i + c] + n));
  }
  return image;
}

/** Places the label inside a larger neutral frame at the given fill ratio. */
function inFrame(label, frameW, frameH, fill, bg = 0xcfc9bfff) {
  const scaled = label.clone().resize({ h: Math.round(frameH * fill) });
  const frame = new Jimp({ width: frameW, height: frameH, color: bg });
  frame.composite(
    scaled,
    Math.round((frameW - scaled.bitmap.width) / 2),
    Math.round((frameH - scaled.bitmap.height) / 2),
  );
  return frame;
}

// rotated: 6° tilt, canvas grows and is filled with a paper tone.
{
  const rotated = src.clone().rotate(6);
  const bg = new Jimp({ width: rotated.bitmap.width, height: rotated.bitmap.height, color: 0xf2efe9ff });
  bg.composite(rotated, 0, 0);
  await save('rotated.jpg', bg.blur(1));
}

// inverted: white print on a near-black pouch.
await save('inverted.jpg', src.clone().invert().blur(1));

// shadow: bright on the left falling to deep shadow on the right.
await save('shadow.jpg', shade(src.clone(), 1.05, 0.38).blur(1));

// small: a 12 MP-class frame where the label fills ~35% of the height.
await save('small.jpg', inFrame(src, 3000, 4000, 0.35).blur(1), 78);

// noisy: sensor grain plus aggressive compression.
await save('noisy.jpg', addNoise(src.clone(), 22), 45);

// combined: small, tilted and shadowed at once.
{
  const tilted = src.clone().rotate(-4);
  const bg = new Jimp({ width: tilted.bitmap.width, height: tilted.bitmap.height, color: 0xf2efe9ff });
  bg.composite(tilted, 0, 0);
  await save('combined.jpg', shade(inFrame(bg, 2400, 3200, 0.45), 1.0, 0.5).blur(1), 70);
}

// sideways-red: the Dabur case — a carton photographed on its side, light
// print on a saturated red panel, small inside a cluttered frame.
{
  const label = src.clone();
  const { width, height, data } = label.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    const ink = data[i] < 128; // black text on the source
    if (ink) { data[i] = 250; data[i + 1] = 244; data[i + 2] = 232; }   // cream print
    else     { data[i] = 188; data[i + 1] = 28;  data[i + 2] = 44;  }   // red panel
  }
  void width; void height;
  const sideways = label.rotate(90);
  const frame = new Jimp({ width: 2000, height: 1500, color: 0x8a8f94ff });
  // Some clutter: a few grey blocks like shelves and a laptop.
  for (const [x, y, w, h, c] of [[60, 80, 500, 300, 0x5a5f66ff], [1500, 900, 420, 500, 0x33363aff], [100, 1100, 700, 300, 0xb9b3a8ff]]) {
    frame.composite(new Jimp({ width: w, height: h, color: c }), x, y);
  }
  const scaled = sideways.resize({ w: Math.round(2000 * 0.62) });
  frame.composite(scaled, Math.round((2000 - scaled.bitmap.width) / 2), Math.round((1500 - scaled.bitmap.height) / 2));
  await save('sideways-red.jpg', frame.blur(1), 80);
}

// ---------------------------------------------------------------- perspective
// Applies a homography so the label becomes a trapezoid — a carton shot from
// below-left, as a hand-held phone usually does.
function warpToQuad(label, frameW, frameH, quad, bg) {
  const { width: sw, height: sh, data: sdata } = label.bitmap;
  const out = new Jimp({ width: frameW, height: frameH, color: bg });
  // Solve H mapping label rect → quad, then inverse-map every frame pixel.
  const src = [[0, 0], [sw, 0], [sw, sh], [0, sh]];
  const A = [], b = [];
  quad.forEach(([x, y], i) => {
    const [u, v] = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  });
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const H = A.map((row, i) => b[i] / row[i]); H.push(1);
  // Invert H (3×3) to map frame → label.
  const [a, bb, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  const inv = [
    (e * i - f * h) / det, (c * h - bb * i) / det, (bb * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (bb * g - a * h) / det, (a * e - bb * d) / det,
  ];
  const odata = out.bitmap.data;
  for (let y = 0; y < frameH; y++) for (let x = 0; x < frameW; x++) {
    const w = inv[6] * x + inv[7] * y + inv[8];
    const u = (inv[0] * x + inv[1] * y + inv[2]) / w, v = (inv[3] * x + inv[4] * y + inv[5]) / w;
    if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) continue;
    const si = (Math.floor(v) * sw + Math.floor(u)) * 4, oi = (y * frameW + x) * 4;
    odata[oi] = sdata[si]; odata[oi + 1] = sdata[si + 1]; odata[oi + 2] = sdata[si + 2]; odata[oi + 3] = 255;
  }
  return out;
}

{
  // Panel bordered so its edges are visible against the frame, as on a real carton.
  const bordered = new Jimp({ width: src.bitmap.width + 60, height: src.bitmap.height + 60, color: 0xf7f4eeff });
  bordered.composite(src, 30, 30);
  const quad = [[260, 180], [1120, 260], [1060, 1420], [180, 1300]];
  await save('perspective.jpg', warpToQuad(bordered, 1400, 1600, quad, 0x7d8489ff).blur(1), 80);
}

// ---------------------------------------------------------------- coloured
// Dark blue print on a yellow panel: nearly equal in luminance, far apart in hue.
{
  const label = src.clone();
  const { data } = label.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    const ink = data[i] < 128;
    if (ink) { data[i] = 24;  data[i + 1] = 40;  data[i + 2] = 120; }   // navy print
    else     { data[i] = 232; data[i + 1] = 176; data[i + 2] = 30;  }   // yellow panel
  }
  await save('coloured.jpg', label.clone().blur(1), 82);

  const bordered = new Jimp({ width: label.bitmap.width + 60, height: label.bitmap.height + 60, color: 0xe6c85cff });
  bordered.composite(label, 30, 30);
  const quad = [[300, 220], [1150, 300], [1090, 1400], [220, 1280]];
  await save('perspective-coloured.jpg', warpToQuad(bordered, 1400, 1600, quad, 0x6b6f75ff).blur(1), 80);
}
