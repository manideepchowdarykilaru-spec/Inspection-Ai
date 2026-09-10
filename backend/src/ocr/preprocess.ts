import { Jimp } from 'jimp';

/**
 * Image preprocessing for OCR on photographs of packaged commodities.
 *
 * A package photograph defeats a recogniser in predictable ways: the light is
 * uneven, the label may be printed light-on-dark, the camera was not square to
 * the panel, sensor noise speckles the small print, and the text is a fraction
 * of the frame. Each stage below removes one of those obstacles, and the whole
 * pipeline is expressed as an exact geometric transform so every bounding box
 * the recogniser returns can be mapped back onto the original photograph.
 *
 *   decode → grey → bound working size → polarity → denoise → flatten
 *   lighting → deskew → { normalised grey | Sauvola binarised } → upscale →
 *   pad
 *
 * All pixel work happens on a Uint8Array luminance plane; Jimp is used only to
 * decode and encode.
 */

/* ------------------------------------------------------------------ Types */

export interface GreyImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface VariantGeometry {
  /** Recogniser pixels per source pixel (uniform). */
  scale: number;
  /** Border added around the recogniser image, in recogniser pixels. */
  padPx: number;
  /** Crop origin of this variant within the ORIGINAL image, in source pixels. */
  offsetX: number;
  offsetY: number;
  /** Working-size downscale applied before geometry (working px per source px). */
  workScale: number;
  /** Deskew rotation applied, in degrees (positive = counter-clockwise). */
  skewDeg: number;
  /** Quarter turns (90° clockwise each) applied to the source before all else. */
  quarterTurns: 0 | 1 | 2 | 3;
  /** Source dimensions the quarter-turn was applied to (after crop). */
  turnSourceWidth: number;
  turnSourceHeight: number;
  /** Rotation centre in working-image pixels. */
  centreX: number;
  centreY: number;
  /**
   * Homography mapping a point in the rectified image back to the un-rectified
   * working image (row-major 3×3). Absent when no perspective correction ran.
   */
  perspective?: number[];
}

export interface PreprocessVariant {
  name: 'normalised' | 'binarised';
  /** PNG handed to the recogniser. */
  buffer: Buffer;
  width: number;
  height: number;
  geometry: VariantGeometry;
  inverted: boolean;
}

export interface PreprocessReport {
  sourceWidth: number;
  sourceHeight: number;
  workingWidth: number;
  workingHeight: number;
  inverted: boolean;
  skewDeg: number;
  quarterTurns: number;
  upscale: number;
  sauvolaWindow: number;
  /** Median luminance of the source, 0–255 — the polarity decision input. */
  medianLuminance: number;
  /** 'pca' when a colour projection gave more contrast than plain luminance. */
  greyMethod: 'luma' | 'pca';
  /** Keystone found and removed, as a fraction of the longer edge; 0 = none. */
  perspectiveKeystone: number;
  stages: string[];
}

export interface PreprocessResult {
  variants: PreprocessVariant[];
  report: PreprocessReport;
  /** Where the print sits in the ORIGINAL image, widened through sparse print; null if unclear. */
  textRegion: Region | null;
  /** The tight ink-mass core of textRegion, before widening. */
  textRegionCore: Region | null;
  /** Downscaled PNG previews so the interface can show what the recogniser saw. */
  previews: { normalised: Buffer; binarised: Buffer };
}

/* --------------------------------------------------------------- Tunables */

/** Anything larger is downscaled before processing; OCR gains nothing beyond it. */
const MAX_WORKING_EDGE = 2400;
/** Long edge presented to the recogniser. */
const TARGET_LONG_EDGE = Number(process.env.OCR_TARGET_EDGE ?? 2400);
/** Never enlarge beyond this — interpolation past 3× only adds blur. */
const MAX_UPSCALE = Number(process.env.OCR_MAX_UPSCALE ?? 3);
const PAD_PX = 24;
/** Skew search range and step, degrees. */
const SKEW_RANGE_DEG = 12;
const SKEW_STEP_DEG = 0.5;
/** Sauvola sensitivity. Higher k → thinner strokes, fewer background specks. */
const SAUVOLA_K = 0.28;
const SAUVOLA_R = 128;
const PREVIEW_LONG_EDGE = 1000;

/* ------------------------------------------------------------- Utilities */

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* --------------------------------------------------------- Decode / grey */

/** Decoded pixels, shared across every stage of one request. */
export interface RgbaSource {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
}

/**
 * Decoding a 12 MP JPEG in pure JavaScript costs 1–2 s. It happens exactly
 * once per request; everything downstream takes the decoded pixels.
 */
export async function decodeSource(input: Buffer | RgbaSource): Promise<RgbaSource> {
  if (!Buffer.isBuffer(input)) return input;
  const image = await Jimp.fromBuffer(input);
  return { data: image.bitmap.data, width: image.bitmap.width, height: image.bitmap.height };
}

function lumaOf(data: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const grey = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) {
    // Rec. 601 luma.
    grey[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000;
  }
  return grey;
}

/**
 * Greyscale that keeps the most contrast between print and panel.
 *
 * Luminance is blind to hue: yellow print on a red panel, or dark blue on
 * green, can be nearly identical in brightness while being trivially separable
 * in colour. Print and panel are the two dominant colours of a label, so the
 * first principal component of the pixel cloud is the projection that pulls
 * them furthest apart. It is used only when it beats luminance clearly, and
 * signed so the panel comes out bright.
 */
function maxContrastGrey(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
): { grey: Uint8Array; gain: number } | null {
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 60_000));

  let mr = 0, mg = 0, mb = 0, count = 0;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    mr += data[i]; mg += data[i + 1]; mb += data[i + 2]; count++;
  }
  mr /= count; mg /= count; mb /= count;

  let srr = 0, srg = 0, srb = 0, sgg = 0, sgb = 0, sbb = 0, lumaVar = 0;
  const lumaMean = 0.299 * mr + 0.587 * mg + 0.114 * mb;
  for (let p = 0; p < n; p += step) {
    const i = p * 4;
    const dr = data[i] - mr, dg = data[i + 1] - mg, db = data[i + 2] - mb;
    srr += dr * dr; srg += dr * dg; srb += dr * db; sgg += dg * dg; sgb += dg * db; sbb += db * db;
    const dl = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] - lumaMean;
    lumaVar += dl * dl;
  }
  srr /= count; srg /= count; srb /= count; sgg /= count; sgb /= count; sbb /= count; lumaVar /= count;
  if (lumaVar < 1) return null;

  // Power iteration for the leading eigenvector of the 3×3 covariance.
  let v = [0.577, 0.577, 0.577];
  for (let iter = 0; iter < 40; iter++) {
    const w = [
      srr * v[0] + srg * v[1] + srb * v[2],
      srg * v[0] + sgg * v[1] + sgb * v[2],
      srb * v[0] + sgb * v[1] + sbb * v[2],
    ];
    const norm = Math.hypot(w[0], w[1], w[2]) || 1;
    v = [w[0] / norm, w[1] / norm, w[2] / norm];
  }
  const pc1Var =
    v[0] * (srr * v[0] + srg * v[1] + srb * v[2]) +
    v[1] * (srg * v[0] + sgg * v[1] + sgb * v[2]) +
    v[2] * (srb * v[0] + sgb * v[1] + sbb * v[2]);
  // Luma weights are not unit length (|w|² ≈ 0.447); rescale so an achromatic
  // image scores ≈1.16 rather than a spurious √3 and PCA is not applied to it.
  const gain = Math.sqrt(pc1Var / (lumaVar / 0.4471));
  // Only worth the change when colour separates print from panel noticeably better.
  if (gain < 1.3) return null;

  const proj = new Float32Array(n);
  let min = Infinity, max = -Infinity;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const t = (data[i] - mr) * v[0] + (data[i + 1] - mg) * v[1] + (data[i + 2] - mb) * v[2];
    proj[p] = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  // Robust bounds and a sign that makes the majority (the panel) bright.
  const hist = new Uint32Array(1024);
  const span = max - min || 1;
  for (let p = 0; p < n; p += step) hist[Math.min(1023, Math.floor(((proj[p] - min) / span) * 1023))]++;
  let acc = 0, lo = 0, hi = 1023, med = 512;
  for (let b = 0; b < 1024; b++) { acc += hist[b]; if (acc >= count * 0.01) { lo = b; break; } }
  acc = 0;
  for (let b = 1023; b >= 0; b--) { acc += hist[b]; if (acc >= count * 0.01) { hi = b; break; } }
  acc = 0;
  for (let b = 0; b < 1024; b++) { acc += hist[b]; if (acc >= count * 0.5) { med = b; break; } }
  const flip = med - lo < hi - med;
  const loV = min + (lo / 1023) * span;
  const hiV = min + (hi / 1023) * span;
  const k = 255 / Math.max(1e-6, hiV - loV);

  const grey = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const g = clamp255((proj[p] - loV) * k);
    grey[p] = flip ? 255 - g : g;
  }
  return { grey, gain };
}

/** Area-averaging downscale of an RGBA buffer. */
function downscaleRgba(data: Uint8Array | Buffer, width: number, height: number, factor: number) {
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const out = new Uint8Array(w * h * 4);
  const inv = 1 / factor;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * inv), sy1 = Math.min(height, Math.ceil((y + 1) * inv));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * inv), sx1 = Math.min(width, Math.ceil((x + 1) * inv));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let i = (sy * width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

interface Decoded {
  grey: GreyImage;
  sourceWidth: number;
  sourceHeight: number;
  /** Crop origin in source pixels. */
  offsetX: number;
  offsetY: number;
  /** Crop size in source pixels (before downscale). */
  cropWidth: number;
  cropHeight: number;
  /** Working pixels per source pixel. */
  workScale: number;
  method: 'luma' | 'pca';
  gain: number;
}

/**
 * Decodes, crops and bounds the working size while still in colour, then
 * converts to grey. Doing the crop first matters for the colour projection:
 * its sign is chosen so the majority colour is bright, and inside a crop the
 * majority is the panel — whereas across a whole frame it may be the table.
 */
async function decodeToGrey(input: Buffer | RgbaSource, crop?: PreprocessOptions['crop']): Promise<Decoded> {
  const source = await decodeSource(input);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  let data: Uint8Array | Buffer = source.data;
  let width = sourceWidth;
  let height = sourceHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (crop) {
    const x0 = Math.max(0, Math.floor(crop.x));
    const y0 = Math.max(0, Math.floor(crop.y));
    const x1 = Math.min(width, Math.ceil(crop.x + crop.w));
    const y1 = Math.min(height, Math.ceil(crop.y + crop.h));
    const cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const from = ((y0 + y) * width + x0) * 4;
      out.set(data.subarray(from, from + cw * 4), y * cw * 4);
    }
    data = out; width = cw; height = ch; offsetX = x0; offsetY = y0;
  }
  const cropWidth = width, cropHeight = height;

  // Bound the working size so a 12 MP phone photo does not cost 12 MP of work.
  const workScale = Math.min(1, MAX_WORKING_EDGE / Math.max(width, height));
  if (workScale < 1) ({ data, width, height } = downscaleRgba(data, width, height, workScale));

  const pca = maxContrastGrey(data, width, height);
  const grey: GreyImage = pca
    ? { width, height, data: pca.grey }
    : { width, height, data: lumaOf(data, width, height) };
  return {
    grey, sourceWidth, sourceHeight, offsetX, offsetY, cropWidth, cropHeight, workScale,
    method: pca ? 'pca' : 'luma',
    gain: pca ? pca.gain : 1,
  };
}

/** Area-averaging downscale; keeps thin strokes better than nearest-neighbour. */
function downscale(src: GreyImage, factor: number): GreyImage {
  if (factor >= 1) return src;
  const width = Math.max(1, Math.round(src.width * factor));
  const height = Math.max(1, Math.round(src.height * factor));
  const out = new Uint8Array(width * height);
  const inv = 1 / factor;
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * inv);
    const sy1 = Math.min(src.height, Math.ceil((y + 1) * inv));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * inv);
      const sx1 = Math.min(src.width, Math.ceil((x + 1) * inv));
      let sum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const row = sy * src.width;
        for (let sx = sx0; sx < sx1; sx++) {
          sum += src.data[row + sx];
          n++;
        }
      }
      out[y * width + x] = n ? sum / n : 0;
    }
  }
  return { width, height, data: out };
}

/** Bilinear upscale. */
function upscale(src: GreyImage, factor: number): GreyImage {
  if (factor <= 1.001) return src;
  const width = Math.round(src.width * factor);
  const height = Math.round(src.height * factor);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(src.height - 1, y / factor);
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, x / factor);
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const a = src.data[y0 * src.width + x0];
      const b = src.data[y0 * src.width + x1];
      const c = src.data[y1 * src.width + x0];
      const d = src.data[y1 * src.width + x1];
      out[y * width + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return { width, height, data: out };
}

/** Nearest-neighbour upscale — keeps a binary image binary. */
function upscaleNearest(src: GreyImage, factor: number): GreyImage {
  const width = Math.round(src.width * factor);
  const height = Math.round(src.height * factor);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / factor));
    const row = sy * src.width;
    for (let x = 0; x < width; x++) {
      out[y * width + x] = src.data[row + Math.min(src.width - 1, Math.floor(x / factor))];
    }
  }
  return { width, height, data: out };
}

/* --------------------------------------------------------------- Polarity */

/**
 * Detects light-on-dark labels. Tesseract is trained on dark ink on light
 * paper; a black pouch with white print has to be inverted first.
 */
function detectInverted(img: GreyImage): { inverted: boolean; medianLuminance: number } {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 20000)));
  const samples: number[] = [];
  for (let y = 0; y < img.height; y += step) {
    const row = y * img.width;
    for (let x = 0; x < img.width; x += step) samples.push(img.data[row + x]);
  }
  const med = median(samples);
  return { inverted: med < 112, medianLuminance: Math.round(med) };
}

function invert(img: GreyImage): GreyImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) out[i] = 255 - img.data[i];
  return { ...img, data: out };
}

/* ---------------------------------------------------------------- Denoise */

/** 3×3 median — removes sensor speckle and JPEG mosquito noise without eroding strokes. */
/** 3×3 box blur; two passes join the dots of dot-matrix print into strokes. */
function boxBlur3x3(img: GreyImage): GreyImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          sum += data[row + xx];
          n++;
        }
      }
      out[y * width + x] = Math.round(sum / n);
    }
  }
  return { width, height, data: out };
}

function median3x3(img: GreyImage): GreyImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const win = new Uint8Array(9);
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      win[0] = data[ym * width + xm]; win[1] = data[ym * width + x]; win[2] = data[ym * width + xp];
      win[3] = data[y * width + xm];  win[4] = data[y * width + x];  win[5] = data[y * width + xp];
      win[6] = data[yp * width + xm]; win[7] = data[yp * width + x]; win[8] = data[yp * width + xp];
      // Partial sort to the median position.
      for (let i = 0; i < 5; i++) {
        let min = i;
        for (let j = i + 1; j < 9; j++) if (win[j] < win[min]) min = j;
        const t = win[i]; win[i] = win[min]; win[min] = t;
      }
      out[y * width + x] = win[4];
    }
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------- Integral images */

interface Integral {
  sum: Float64Array;
  sq: Float64Array;
  width: number;
  height: number;
}

function integralImage(img: GreyImage): Integral {
  const { width, height, data } = img;
  const w1 = width + 1;
  const sum = new Float64Array((width + 1) * (height + 1));
  const sq = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 1; x <= width; x++) {
      const v = data[(y - 1) * width + (x - 1)];
      rowSum += v;
      rowSq += v * v;
      sum[y * w1 + x] = sum[(y - 1) * w1 + x] + rowSum;
      sq[y * w1 + x] = sq[(y - 1) * w1 + x] + rowSq;
    }
  }
  return { sum, sq, width, height };
}

/** Mean and standard deviation of the window centred on (x, y). */
function windowStats(integral: Integral, x: number, y: number, half: number) {
  const w1 = integral.width + 1;
  const x0 = Math.max(0, x - half);
  const y0 = Math.max(0, y - half);
  const x1 = Math.min(integral.width, x + half + 1);
  const y1 = Math.min(integral.height, y + half + 1);
  const n = (x1 - x0) * (y1 - y0);
  const s = integral.sum[y1 * w1 + x1] - integral.sum[y0 * w1 + x1] - integral.sum[y1 * w1 + x0] + integral.sum[y0 * w1 + x0];
  const q = integral.sq[y1 * w1 + x1] - integral.sq[y0 * w1 + x1] - integral.sq[y1 * w1 + x0] + integral.sq[y0 * w1 + x0];
  const mean = s / n;
  const variance = Math.max(0, q / n - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

/* ---------------------------------------------------- Lighting flattening */

/**
 * Divides out the slow-varying illumination so a glare gradient or a shadow
 * across the panel no longer pushes half the text past a global threshold.
 */
function flattenLighting(img: GreyImage): GreyImage {
  const integral = integralImage(img);
  const half = Math.max(12, Math.floor(Math.min(img.width, img.height) / 12));
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const { mean } = windowStats(integral, x, y, half);
      // Background is the local bright level; paper sits near the local mean
      // plus a margin because ink pulls the mean down.
      const background = Math.max(40, mean + 18);
      out[y * img.width + x] = clamp255((img.data[y * img.width + x] / background) * 238);
    }
  }
  return { ...img, data: out };
}

/** Global contrast stretch between the 1st and 99th percentiles. */
function stretchContrast(img: GreyImage): GreyImage {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  const total = img.data.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.01) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.01) { hi = v; break; }
  }
  if (hi - lo < 20) return img;
  const out = new Uint8Array(img.data.length);
  const k = 255 / (hi - lo);
  for (let i = 0; i < img.data.length; i++) out[i] = clamp255((img.data[i] - lo) * k);
  return { ...img, data: out };
}

/* ------------------------------------------------------------- Binarise */

/**
 * Sauvola adaptive threshold. The threshold follows the local mean and
 * standard deviation, so lit and shadowed regions of the same panel are
 * binarised on their own terms.
 */
function sauvola(img: GreyImage, window: number, k = SAUVOLA_K): GreyImage {
  const integral = integralImage(img);
  const half = Math.floor(window / 2);
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const { mean, std } = windowStats(integral, x, y, half);
      const threshold = mean * (1 + k * (std / SAUVOLA_R - 1));
      out[y * img.width + x] = img.data[y * img.width + x] > threshold ? 255 : 0;
    }
  }
  return { ...img, data: out };
}

/* ---------------------------------------------------------------- Deskew */

/**
 * Estimates the skew of the text lines.
 *
 * Text lines produce a strongly banded horizontal projection when they are
 * level; as the image tilts the bands smear together. The angle that maximises
 * the variance of the row-ink profile is the angle that levels the lines.
 */
function estimateSkewDeg(binary: GreyImage): number {
  const small = downscale(binary, Math.min(1, 700 / Math.max(binary.width, binary.height)));
  const { width, height, data } = small;
  const ink: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 128) ink.push(y * width + x);
    }
  }
  // Too little ink to measure — or a solid image — means no reliable estimate.
  if (ink.length < 200 || ink.length > width * height * 0.6) return 0;

  const cx = width / 2;
  const cy = height / 2;
  let bestAngle = 0;
  let bestScore = -Infinity;
  const profile = new Float64Array(height * 2 + 4);

  for (let deg = -SKEW_RANGE_DEG; deg <= SKEW_RANGE_DEG + 1e-9; deg += SKEW_STEP_DEG) {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    profile.fill(0);
    for (const idx of ink) {
      const x = (idx % width) - cx;
      const y = Math.floor(idx / width) - cy;
      const ry = Math.round(-x * sin + y * cos + cy) + height / 2;
      if (ry >= 0 && ry < profile.length) profile[ry]++;
    }
    let mean = 0;
    for (let i = 0; i < profile.length; i++) mean += profile[i];
    mean /= profile.length;
    let variance = 0;
    for (let i = 0; i < profile.length; i++) variance += (profile[i] - mean) ** 2;
    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = deg;
    }
  }
  // A maximum on the edge of the search range is not a measurement — clutter,
  // a barcode or converging lines pushed the score monotonically; do nothing.
  if (Math.abs(bestAngle) >= SKEW_RANGE_DEG - SKEW_STEP_DEG / 2) return 0;
  return Math.abs(bestAngle) < SKEW_STEP_DEG ? 0 : bestAngle;
}

/** Rotates about the centre into a same-size canvas filled with paper white. */
function rotate(img: GreyImage, deg: number): GreyImage {
  if (deg === 0) return img;
  const { width, height, data } = img;
  const out = new Uint8Array(data.length).fill(255);
  const rad = (-deg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = dx * cos - dy * sin + cx;
      const sy = dx * sin + dy * cos + cy;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const wx = sx - x0;
      const wy = sy - y0;
      const a = data[y0 * width + x0];
      const b = data[y0 * width + x0 + 1];
      const c = data[(y0 + 1) * width + x0];
      const d = data[(y0 + 1) * width + x0 + 1];
      out[y * width + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------- Text region */

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Finds where the print is, from ink density alone.
 *
 * The bounds are taken where the cumulative ink mass passes 1.5% and 98.5% on
 * each axis, which ignores isolated specks and background clutter while
 * enclosing the printed panel. Works before any OCR has run, so a label that
 * is too small to read on the first pass can still be located and re-read.
 */
function inkRegion(binary: GreyImage): Region | null {
  const { width, height, data } = binary;
  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < 128) {
        rows[y]++;
        cols[x]++;
        total++;
      }
    }
  }
  if (total < width * height * 0.002) return null;

  const bounds = (profile: Float64Array) => {
    const lo = total * 0.015;
    const hi = total * 0.985;
    let acc = 0;
    let start = 0;
    let end = profile.length - 1;
    for (let i = 0; i < profile.length; i++) {
      acc += profile[i];
      if (acc >= lo) { start = i; break; }
    }
    acc = 0;
    for (let i = profile.length - 1; i >= 0; i--) {
      acc += profile[i];
      if (acc >= total - hi) { end = i; break; }
    }
    return [start, end] as const;
  };

  const [y0, y1] = bounds(rows);
  const [x0, x1] = bounds(cols);
  if (x1 - x0 < width * 0.05 || y1 - y0 < height * 0.05) return null;

  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Widens an ink-mass region through sparse print.
 *
 * The mass bounds discard the outer 1.5% of ink on each side, which is also a
 * small batch line at the foot of a panel whenever a photograph or logo holds
 * most of the ink. Rows and columns that still carry print are added, gaps the
 * size of line spacing are tolerated, and a longer gap ends the panel. Used for
 * the refocus crop only: the perspective detector wants the tight core, whose
 * edges are where the panel's borders are.
 */
function growInkRegion(binary: GreyImage, core: Region): Region {
  const { width, height, data } = binary;
  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < 128) { rows[y]++; cols[x]++; }
    }
  }
  const grow = (profile: Float64Array, start: number, end: number, axisLength: number, rowLength: number) => {
    let coreSum = 0;
    for (let i = start; i <= end; i++) coreSum += profile[i];
    const coreMean = coreSum / Math.max(1, end - start + 1);
    const floor = Math.max(coreMean * 0.06, rowLength * 0.003);
    const maxGap = Math.max(4, Math.round(axisLength * 0.04));
    let s = start;
    let gap = 0;
    for (let i = start - 1; i >= 0; i--) {
      if (profile[i] >= floor) { s = i; gap = 0; } else if (++gap > maxGap) break;
    }
    let e = end;
    gap = 0;
    for (let i = end + 1; i < profile.length; i++) {
      if (profile[i] >= floor) { e = i; gap = 0; } else if (++gap > maxGap) break;
    }
    return [s, e] as const;
  };
  const [y0, y1] = grow(rows, core.y0, core.y1 - 1, height, width);
  const [x0, x1] = grow(cols, core.x0, core.x1 - 1, width, height);

  // If growing more than doubles the area, the "print" beyond the core is
  // background clutter and the mass bounds were the better estimate.
  const coreArea = (core.x1 - core.x0) * (core.y1 - core.y0);
  const grownArea = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (grownArea > coreArea * 2.2) return core;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/* ---------------------------------------------------------- Perspective */

interface Pt { x: number; y: number }
interface Quad { tl: Pt; tr: Pt; br: Pt; bl: Pt }

/** Solves the 3×3 homography that maps the unit rectangle (0..w, 0..h) onto `quad`. */
function homographyRectToQuad(w: number, h: number, q: Quad): number[] {
  const src: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const dst: Pt[] = [q.tl, q.tr, q.br, q.bl];
  // 8 equations in the 8 unknowns of H (h33 = 1).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = src[i];
    const { x, y } = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    const d = A[col][col] || 1e-12;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const hv = A.map((row, i) => b[i] / (row[i] || 1e-12));
  return [...hv, 1];
}

function applyH(H: number[], x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8] || 1e-12;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/**
 * Finds the four edges of the printed panel.
 *
 * Sobel edges → Hough lines → the strongest near-horizontal line just above
 * the ink, just below it, and the strongest near-vertical line just left and
 * just right of it. The ink region anchors the search so shelf edges and
 * background clutter elsewhere in the frame are ignored. Returns null unless
 * the four lines make a plausible, genuinely skewed quadrilateral.
 */
function detectPanelQuad(grey: GreyImage, ink: Region): Quad | null {
  const f = Math.min(1, 640 / Math.max(grey.width, grey.height));
  const ds = downscale(grey, f);
  const { width: w, height: h, data } = ds;
  const region = { x0: ink.x0 * f, y0: ink.y0 * f, x1: ink.x1 * f, y1: ink.y1 * f };

  // Sobel gradient magnitude.
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1] + data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1];
      const gy =
        -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1] + data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  // Edge threshold at the 92nd percentile of gradient magnitude.
  const sorted = Float32Array.from(mag).sort();
  const threshold = Math.max(40, sorted[Math.floor(sorted.length * 0.92)]);
  const edges: number[] = [];
  for (let i = 0; i < mag.length; i++) if (mag[i] >= threshold) edges.push(i);
  if (edges.length < 200) return null;
  const stride = Math.max(1, Math.floor(edges.length / 30_000));

  // Hough accumulator: theta 0..179 (degrees), rho −R..R.
  const R = Math.ceil(Math.hypot(w, h));
  const acc = new Int32Array(180 * (2 * R + 1));
  const cosT = new Float64Array(180), sinT = new Float64Array(180);
  for (let t = 0; t < 180; t++) { cosT[t] = Math.cos((t * Math.PI) / 180); sinT[t] = Math.sin((t * Math.PI) / 180); }
  for (let e = 0; e < edges.length; e += stride) {
    const x = edges[e] % w, y = Math.floor(edges[e] / w);
    for (let t = 0; t < 180; t++) {
      const rho = Math.round(x * cosT[t] + y * sinT[t]) + R;
      acc[t * (2 * R + 1) + rho]++;
    }
  }

  const cx = w / 2, cy = h / 2;
  const minVotes = Math.max(25, 0.3 * (region.x1 - region.x0) / stride);
  type Line = { t: number; rho: number; votes: number };
  const best = (
    thetas: number[],
    inBand: (line: Line) => boolean,
  ): Line | null => {
    let top: Line | null = null;
    for (const t of thetas) {
      const base = t * (2 * R + 1);
      for (let r = 0; r < 2 * R + 1; r++) {
        const votes = acc[base + r];
        if (votes < minVotes || (top && votes <= top.votes)) continue;
        const line = { t, rho: r - R, votes };
        if (inBand(line)) top = line;
      }
    }
    return top;
  };
  const yAtCx = (l: Line) => (l.rho - cx * cosT[l.t]) / (sinT[l.t] || 1e-9);
  const xAtCy = (l: Line) => (l.rho - cy * sinT[l.t]) / (cosT[l.t] || 1e-9);

  const horiz = Array.from({ length: 41 }, (_, i) => 70 + i);                 // 70..110
  const vert = [...Array.from({ length: 21 }, (_, i) => i), ...Array.from({ length: 20 }, (_, i) => 160 + i)];
  const rh = region.y1 - region.y0, rw = region.x1 - region.x0;

  const top = best(horiz, (l) => { const y = yAtCx(l); return y > region.y0 - 0.45 * rh && y < region.y0 + 0.04 * rh; });
  const bottom = best(horiz, (l) => { const y = yAtCx(l); return y > region.y1 - 0.04 * rh && y < region.y1 + 0.45 * rh; });
  const left = best(vert, (l) => { const x = xAtCy(l); return x > region.x0 - 0.45 * rw && x < region.x0 + 0.04 * rw; });
  const right = best(vert, (l) => { const x = xAtCy(l); return x > region.x1 - 0.04 * rw && x < region.x1 + 0.45 * rw; });
  if (!top || !bottom || !left || !right) return null;

  const intersect = (a: Line, b: Line): Pt | null => {
    const det = cosT[a.t] * sinT[b.t] - sinT[a.t] * cosT[b.t];
    if (Math.abs(det) < 1e-6) return null;
    return {
      x: (a.rho * sinT[b.t] - b.rho * sinT[a.t]) / det,
      y: (b.rho * cosT[a.t] - a.rho * cosT[b.t]) / det,
    };
  };
  const tl = intersect(top, left), tr = intersect(top, right), br = intersect(bottom, right), bl = intersect(bottom, left);
  if (!tl || !tr || !br || !bl) return null;

  // Plausibility: on-frame, convex, sizeable, and actually skewed.
  const pts = [tl, tr, br, bl];
  if (pts.some((p) => p.x < -0.15 * w || p.x > 1.15 * w || p.y < -0.15 * h || p.y > 1.15 * h)) return null;
  const area = Math.abs(
    (tl.x * tr.y - tr.x * tl.y) + (tr.x * br.y - br.x * tr.y) + (br.x * bl.y - bl.x * br.y) + (bl.x * tl.y - tl.x * bl.y),
  ) / 2;
  if (area < 0.12 * w * h) return null;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const signs = [cross(tl, tr, br), cross(tr, br, bl), cross(br, bl, tl), cross(bl, tl, tr)].map(Math.sign);
  if (new Set(signs).size !== 1) return null;
  const keystone =
    Math.max(Math.abs(tl.x - bl.x), Math.abs(tr.x - br.x), Math.abs(tl.y - tr.y), Math.abs(bl.y - br.y)) / Math.max(w, h);
  if (keystone < 0.015 || keystone > 0.45) return null;

  const up = (p: Pt): Pt => ({ x: p.x / f, y: p.y / f });
  return { tl: up(tl), tr: up(tr), br: up(br), bl: up(bl) };
}

/** Warps the quadrilateral onto an upright rectangle; returns the rectified image and dest→source homography. */
function rectify(grey: GreyImage, q: Quad): { image: GreyImage; H: number[]; keystone: number } {
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(32, Math.round((dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2));
  const h = Math.max(32, Math.round((dist(q.tl, q.bl) + dist(q.tr, q.br)) / 2));
  const H = homographyRectToQuad(w, h, q);
  const out = new Uint8Array(w * h).fill(255);
  const { width: sw, height: sh, data } = grey;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = applyH(H, x, y);
      if (s.x < 0 || s.y < 0 || s.x >= sw - 1 || s.y >= sh - 1) continue;
      const x0 = Math.floor(s.x), y0 = Math.floor(s.y);
      const wx = s.x - x0, wy = s.y - y0;
      const a = data[y0 * sw + x0], b = data[y0 * sw + x0 + 1], c = data[(y0 + 1) * sw + x0], d = data[(y0 + 1) * sw + x0 + 1];
      out[y * w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  const keystone =
    Math.max(Math.abs(q.tl.x - q.bl.x), Math.abs(q.tr.x - q.br.x), Math.abs(q.tl.y - q.tr.y), Math.abs(q.bl.y - q.br.y)) /
    Math.max(grey.width, grey.height);
  return { image: { width: w, height: h, data: out }, H, keystone };
}

/* ------------------------------------------------------------- Sharpen */

/** Unsharp mask on the grey variant; binarised output must not be sharpened. */
function sharpen(img: GreyImage): GreyImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const v =
        5 * data[y * width + x] -
        data[ym * width + x] -
        data[yp * width + x] -
        data[y * width + xm] -
        data[y * width + xp];
      out[y * width + x] = clamp255(v);
    }
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------------- Encoding */

function pad(img: GreyImage, px: number): GreyImage {
  const width = img.width + px * 2;
  const height = img.height + px * 2;
  const out = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < img.height; y++) {
    out.set(img.data.subarray(y * img.width, (y + 1) * img.width), (y + px) * width + px);
  }
  return { width, height, data: out };
}

async function encodePng(img: GreyImage): Promise<Buffer> {
  const out = new Jimp({ width: img.width, height: img.height, color: 0xffffffff });
  const bitmap = out.bitmap.data;
  for (let i = 0, p = 0; p < img.data.length; i += 4, p++) {
    const v = img.data[p];
    bitmap[i] = v;
    bitmap[i + 1] = v;
    bitmap[i + 2] = v;
    bitmap[i + 3] = 255;
  }
  // Greyscale colour type at a light deflate level: a quarter of the bytes
  // and roughly half the encode time, with no effect on recognition.
  return Buffer.from(await out.getBuffer('image/png', { deflateLevel: 1, filterType: 0, colorType: 0 }));
}

async function preview(img: GreyImage): Promise<Buffer> {
  const factor = Math.min(1, PREVIEW_LONG_EDGE / Math.max(img.width, img.height));
  return encodePng(downscale(img, factor));
}

/* -------------------------------------------------------------- Pipeline */

export interface PreprocessOptions {
  /** Crop region of the original image to process, in source pixels. */
  crop?: { x: number; y: number; w: number; h: number };
  /** 90° clockwise turns to apply so the text reads left-to-right. */
  quarterTurns?: 0 | 1 | 2 | 3;
  /**
   * Tilt of the text lines measured by the recogniser on the probe pass, in the
   * same convention as the projection estimator. Preferred over the estimator,
   * which clutter and barcodes can fool.
   */
  skewDegHint?: number | null;
  /** Median cap height of the print in source pixels, from the probe; drives the upscale. */
  sourceCapHeightPx?: number | null;
  /**
   * Dot-matrix mode for the price, batch and date block: the median filter that
   * removes sensor speckle also removes the dots of a dot-matrix glyph, so a
   * light blur that joins the dots into strokes is used instead.
   */
  dotMatrix?: boolean;
  /**
   * Read the opposite polarity from the one detected. A dark label on a bright
   * bottle or shelf fools the whole-frame polarity test: the frame reads as
   * light, so the white print on the label is never inverted.
   */
  forceInvert?: boolean;
}

/** Cap height the recogniser reads comfortably; the upscale aims the print at it. */
const TARGET_CAP_PX = 28;
/** Upscale ceiling when the print is known to be small. */
const MAX_UPSCALE_FOR_SMALL_PRINT = 4;
const MAX_UPSCALED_EDGE = 4400;

/** Exact 90° clockwise rotation, repeated `turns` times. */
export function rotate90(img: GreyImage, turns: number): GreyImage {
  let out = img;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const { width, height, data } = out;
    const rotated = new Uint8Array(data.length);
    // (x, y) → (height − 1 − y, x) in the new width×height = height×width image.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        rotated[x * height + (height - 1 - y)] = data[y * width + x];
      }
    }
    out = { width: height, height: width, data: rotated };
  }
  return out;
}

/**
 * Fast path for the orientation probe: grey, polarity-corrected, downscaled.
 * Skips the expensive stages so four rotations can be tried cheaply.
 */
export async function quickGrey(
  input: Buffer | RgbaSource,
  longEdge = 900,
  crop?: PreprocessOptions['crop'],
): Promise<GreyImage> {
  // Colour-aware grey, so a coloured panel probes as well as it reads.
  const { grey } = await decodeToGrey(input, crop);
  const scaled = downscale(grey, Math.min(1, longEdge / Math.max(grey.width, grey.height)));
  const polarity = detectInverted(scaled);
  const oriented = polarity.inverted ? invert(scaled) : scaled;
  return stretchContrast(median3x3(oriented));
}

export { encodePng };

export async function preprocessForOcr(
  input: Buffer | RgbaSource,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const stages: string[] = [];
  const decoded = await decodeToGrey(input, options.crop);
  let grey = decoded.grey;
  const { offsetX, offsetY, workScale } = decoded;

  if (options.crop) stages.push(`crop ${decoded.cropWidth}×${decoded.cropHeight} @ (${offsetX}, ${offsetY})`);
  if (workScale < 1) stages.push(`downscale ×${workScale.toFixed(2)} → ${grey.width}×${grey.height}`);
  if (decoded.method === 'pca') {
    stages.push(`max-contrast grey (colour PCA, ×${decoded.gain.toFixed(1)} contrast vs luminance)`);
  }

  // Turn after the downscale: the inverse mapping undoes the turn in working space.
  const quarterTurns = options.quarterTurns ?? 0;
  const turnSourceWidth = grey.width;
  const turnSourceHeight = grey.height;
  if (quarterTurns) {
    grey = rotate90(grey, quarterTurns);
    stages.push(`rotate ${quarterTurns * 90}° (text was sideways)`);
  }

  const detected = detectInverted(grey);
  const polarity = { ...detected, inverted: options.forceInvert ? !detected.inverted : detected.inverted };
  if (polarity.inverted) {
    grey = invert(grey);
    stages.push(
      options.forceInvert
        ? `invert (forced — light print on a dark label inside a bright frame)`
        : `invert (median luminance ${polarity.medianLuminance} — light text on dark)`,
    );
  }

  if (options.dotMatrix) {
    grey = boxBlur3x3(boxBlur3x3(grey));
    stages.push('dot-matrix closing (2× 3×3 blur, no median)');
  } else {
    grey = median3x3(grey);
    stages.push('median 3×3 denoise');
  }

  grey = flattenLighting(grey);
  grey = stretchContrast(grey);
  stages.push('flatten illumination + contrast stretch (1st–99th percentile)');

  // Ink region first: it anchors both the panel-edge search and the refocus crop.
  const sauvolaWindow = Math.max(15, (Math.floor(Math.min(grey.width, grey.height) / 40) | 1));
  let quickBinary = sauvola(grey, sauvolaWindow);
  const inkCore = inkRegion(quickBinary);
  const textRegion = inkCore ? growInkRegion(quickBinary, inkCore) : null;

  // Perspective: a panel photographed off-axis is a trapezoid; the recogniser
  // wants a rectangle. Only applied when four plausible panel edges are found.
  let perspective: number[] | undefined;
  let perspectiveKeystone = 0;
  const quad = inkCore ? detectPanelQuad(grey, inkCore) : null;
  if (quad) {
    const rectified = rectify(grey, quad);
    grey = rectified.image;
    perspective = rectified.H;
    perspectiveKeystone = Number(rectified.keystone.toFixed(3));
    quickBinary = sauvola(grey, sauvolaWindow);
    stages.push(`perspective rectify (keystone ${(rectified.keystone * 100).toFixed(1)}% → ${grey.width}×${grey.height})`);
  }
  // The tilt of the text lines; levelling them means rotating by the opposite
  // angle. The recogniser's own measurement from the probe pass is preferred
  // over the projection estimator whenever it is available.
  const hinted = options.skewDegHint != null && Math.abs(options.skewDegHint) <= 20 && Math.abs(options.skewDegHint) >= 0.5;
  const tilt = hinted ? Math.round(options.skewDegHint! * 2) / 2 : estimateSkewDeg(quickBinary);
  const skewDeg = -tilt;
  if (skewDeg !== 0) {
    grey = rotate(grey, skewDeg);
    stages.push(`deskew ${skewDeg > 0 ? '+' : ''}${skewDeg.toFixed(1)}°${hinted ? ' (measured on text lines)' : ''}`);
  }

  const binarised = skewDeg !== 0 ? sauvola(grey, sauvolaWindow) : quickBinary;
  stages.push(`Sauvola binarise (window ${sauvolaWindow}, k ${SAUVOLA_K})`);

  const longEdge = Math.max(grey.width, grey.height);
  let scale = Math.min(MAX_UPSCALE, Math.max(1, TARGET_LONG_EDGE / longEdge));
  // Small print asks for more: aim the measured cap height at what the
  // recogniser reads well, within a hard ceiling on the output size.
  const capNow = options.sourceCapHeightPx ? options.sourceCapHeightPx * workScale : null;
  let capNote = '';
  if (capNow && capNow > 0 && capNow < TARGET_CAP_PX) {
    const wanted = Math.min(MAX_UPSCALE_FOR_SMALL_PRINT, TARGET_CAP_PX / capNow, MAX_UPSCALED_EDGE / longEdge);
    if (wanted > scale) {
      scale = wanted;
      capNote = ` (print ≈${capNow.toFixed(0)} px → ${(capNow * scale).toFixed(0)} px)`;
    }
  }
  const greyUp = scale > 1.001 ? sharpen(upscale(grey, scale)) : grey;
  // The binary variant is upscaled as-is: re-running Sauvola at 2400 px costs
  // ~0.5 s and the recogniser gains nothing from softened binary edges.
  const binaryUp = scale > 1.001 ? upscaleNearest(binarised, scale) : binarised;
  if (scale > 1.001) stages.push(`upscale ×${scale.toFixed(2)} + unsharp mask${capNote}`);

  const geometry: VariantGeometry = {
    scale,
    padPx: PAD_PX,
    offsetX,
    offsetY,
    workScale,
    skewDeg,
    quarterTurns,
    turnSourceWidth,
    turnSourceHeight,
    centreX: grey.width / 2,
    centreY: grey.height / 2,
    perspective,
  };

  const normalisedPadded = pad(greyUp, PAD_PX);
  const binarisedPadded = pad(binaryUp, PAD_PX);

  const [normalisedPng, binarisedPng, previewN, previewB] = await Promise.all([
    encodePng(normalisedPadded),
    encodePng(binarisedPadded),
    preview(greyUp),
    preview(binaryUp),
  ]);

  // The ink region was measured in working space (turned + downscaled, before
  // deskew); map it back through the same geometry, minus the later stages.
  const regionGeometry: VariantGeometry = {
    ...geometry,
    scale: 1,
    padPx: 0,
    skewDeg: 0,
    // The ink region was measured before rectification.
    perspective: undefined,
  };
  const textRegionSource: Region | null = textRegion ? toSourceBox(textRegion, regionGeometry) : null;
  const textRegionCoreSource: Region | null = inkCore ? toSourceBox(inkCore, regionGeometry) : null;

  return {
    textRegion: textRegionSource,
    textRegionCore: textRegionCoreSource,
    variants: [
      {
        name: 'normalised',
        buffer: normalisedPng,
        width: normalisedPadded.width,
        height: normalisedPadded.height,
        geometry,
        inverted: polarity.inverted,
      },
      {
        name: 'binarised',
        buffer: binarisedPng,
        width: binarisedPadded.width,
        height: binarisedPadded.height,
        geometry,
        inverted: polarity.inverted,
      },
    ],
    report: {
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
      workingWidth: grey.width,
      workingHeight: grey.height,
      inverted: polarity.inverted,
      skewDeg,
      quarterTurns,
      greyMethod: decoded.method,
      perspectiveKeystone,
      upscale: Number(scale.toFixed(2)),
      sauvolaWindow,
      medianLuminance: polarity.medianLuminance,
      stages,
    },
    previews: { normalised: previewN, binarised: previewB },
  };
}

/* ------------------------------------------------------ Coordinate mapping */

/**
 * Maps a point in recogniser space back to the ORIGINAL image.
 *
 * Inverse of: crop → work-downscale → rotate about centre → upscale → pad.
 */
export function toSourcePoint(px: number, py: number, g: VariantGeometry): { x: number; y: number } {
  // Remove padding and upscale → working (rotated) space.
  let x = (px - g.padPx) / g.scale;
  let y = (py - g.padPx) / g.scale;
  // Undo the deskew rotation. rotate(img, d) samples the source at R(−d)·p, so
  // a recogniser point maps back to the source through R(−d) as well.
  if (g.skewDeg !== 0) {
    const rad = (-g.skewDeg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const dx = x - g.centreX;
    const dy = y - g.centreY;
    x = dx * cos - dy * sin + g.centreX;
    y = dx * sin + dy * cos + g.centreY;
  }
  // Undo the perspective rectification: the deskew ran in rectified space, so
  // this comes after it and before the working downscale is undone.
  if (g.perspective) {
    const p = applyH(g.perspective, x, y);
    x = p.x;
    y = p.y;
  }
  // Undo the quarter turns in working space. Each clockwise turn mapped
  // (x, y) → (H − 1 − y, x) where H is the height before that turn.
  let w = g.turnSourceWidth;
  let h = g.turnSourceHeight;
  if (g.quarterTurns % 2 === 1) [w, h] = [h, w];
  for (let t = 0; t < g.quarterTurns; t++) {
    const nx = y;
    const ny = w - 1 - x;
    x = nx;
    y = ny;
    [w, h] = [h, w];
  }
  // Undo the working downscale, then add the crop origin → source pixels.
  return { x: x / g.workScale + g.offsetX, y: y / g.workScale + g.offsetY };
}

/** Axis-aligned source-space box enclosing a recogniser-space box. */
export function toSourceBox(
  box: { x0: number; y0: number; x1: number; y1: number },
  g: VariantGeometry,
): { x0: number; y0: number; x1: number; y1: number } {
  const corners = [
    toSourcePoint(box.x0, box.y0, g),
    toSourcePoint(box.x1, box.y0, g),
    toSourcePoint(box.x0, box.y1, g),
    toSourcePoint(box.x1, box.y1, g),
  ];
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    y0: Math.min(...corners.map((c) => c.y)),
    x1: Math.max(...corners.map((c) => c.x)),
    y1: Math.max(...corners.map((c) => c.y)),
  };
}

/** Kept for callers that only need a single normalised-grey pass. */
export async function prepareForOcr(input: Buffer | RgbaSource) {
  const result = await preprocessForOcr(input);
  const v = result.variants[0];
  return {
    buffer: v.buffer,
    scale: v.geometry.scale,
    originalWidth: result.report.sourceWidth,
    originalHeight: result.report.sourceHeight,
  };
}
