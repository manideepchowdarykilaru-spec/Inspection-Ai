import { labelDataUri } from '@shared/data/labelImages';
import { caseByImageId, getDb } from './storage';

/**
 * Resolves an imageId to a renderable source.
 *
 * Uploaded photographs are stored as data URLs on the evidence record; seeded
 * products fall back to their vector label render. A production build swaps
 * this for signed object-storage URLs.
 */

const cache = new Map<string, string>();

export function resolveImage(imageId?: string | null): string {
  if (!imageId) return '';
  const cached = cache.get(imageId);
  if (cached) return cached;

  const uploaded = getDb().evidence.find((e) => e.imageId === imageId && e.dataUrl);
  if (uploaded?.dataUrl) {
    cache.set(imageId, uploaded.dataUrl);
    return uploaded.dataUrl;
  }

  const demo = caseByImageId(imageId);
  if (demo) {
    const uri = labelDataUri(demo.label);
    cache.set(imageId, uri);
    return uri;
  }
  return '';
}

export function cacheImage(imageId: string, dataUrl: string) {
  cache.set(imageId, dataUrl);
}

/** Longest edge kept for uploads — the same budget as camera captures. */
export const UPLOAD_MAX_EDGE = 2600;

export interface PreparedUpload {
  dataUrl: string;
  /** Approximate byte size of the encoded image. */
  size: number;
  width: number;
  height: number;
  downscaled: boolean;
}

async function decodeUpload(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap honours the EXIF orientation of phone photographs, so a
  // portrait shot arrives upright rather than rotated 90° with an orientation tag.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Normalises an uploaded photograph before it leaves the device.
 *
 * A 12 MP phone JPEG is 4–6 MB; as a base64 payload it is a third larger again,
 * it is stored on the evidence record, and the recogniser gains nothing above
 * ~2600 px. Re-encoding here keeps the upload small on a mobile connection and
 * the server's memory flat, and it is the point where an undecodable format
 * (HEIC from an iPhone, for instance) is caught with a clear message instead of
 * failing inside the scan.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const source = await decodeUpload(file);
  const naturalWidth = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const naturalHeight = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!naturalWidth || !naturalHeight) throw new Error('The image could not be decoded.');

  const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  // PNG transparency would otherwise become black in the JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return {
    dataUrl,
    size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
    width,
    height,
    downscaled: scale < 1,
  };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
