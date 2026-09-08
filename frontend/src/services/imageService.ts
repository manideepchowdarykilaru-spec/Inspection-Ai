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

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
