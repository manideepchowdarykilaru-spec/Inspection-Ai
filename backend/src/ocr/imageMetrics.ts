import type { Box } from './segments';
import { decodeSource, type RgbaSource } from './preprocess';

/**
 * Measures print contrast from the actual pixels a declaration was read from.
 *
 * Within the detected box the ink pixels are the dark tail of the luminance
 * distribution and the substrate is the light tail. Comparing the two by the
 * WCAG relative-luminance formula gives a contrast ratio that reflects the real
 * package rather than a fabricated constant.
 */

export interface LoadedImage {
  width: number;
  height: number;
  /** Relative luminance (0..1) per pixel, row-major. */
  luminance: Float32Array;
}

function channelLuminance(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export async function loadImage(input: Buffer | RgbaSource): Promise<LoadedImage> {
  const { width, height, data } = await decodeSource(input);
  const luminance = new Float32Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    luminance[p] =
      0.2126 * channelLuminance(data[i]) +
      0.7152 * channelLuminance(data[i + 1]) +
      0.0722 * channelLuminance(data[i + 2]);
  }

  return { width, height, luminance };
}

/**
 * Contrast for a declaration, measured per word and reduced to a median.
 *
 * Measuring over the union box of a multi-line block would average in the
 * whitespace between lines and under-report contrast badly — a crisp
 * black-on-white address block reads as ~5:1 instead of ~20:1. Word boxes hug
 * the glyphs, so each one is a fair sample.
 */
export function contrastForBoxes(image: LoadedImage, boxes: Box[]): number {
  const samples = boxes
    .map((box) => contrastInBox(image, box))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (samples.length === 0) return 1;
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 0 ? (samples[mid - 1] + samples[mid]) / 2 : samples[mid];
  return Number(median.toFixed(1));
}

/** WCAG contrast ratio between the ink and the substrate inside `box`. */
export function contrastInBox(image: LoadedImage, box: Box): number {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(image.width, Math.ceil(box.x1));
  const y1 = Math.min(image.height, Math.ceil(box.y1));
  if (x1 <= x0 || y1 <= y0) return 1;

  const samples: number[] = [];
  for (let y = y0; y < y1; y++) {
    const row = y * image.width;
    for (let x = x0; x < x1; x++) samples.push(image.luminance[row + x]);
  }
  if (samples.length < 8) return 1;

  samples.sort((a, b) => a - b);
  const tail = Math.max(1, Math.floor(samples.length * 0.2));
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

  const ink = mean(samples.slice(0, tail));
  const substrate = mean(samples.slice(-tail));
  const ratio = (substrate + 0.05) / (ink + 0.05);
  return Number(Math.max(1, ratio).toFixed(1));
}
