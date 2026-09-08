import type { BoundingBox, DeclarationKey } from '@shared/types';

/**
 * Synthetic package-label renderer.
 *
 * The demo corpus ships vector labels rather than photographs so that every
 * declaration has an exact, reproducible pixel region. The OCR mock returns
 * boxes from LABEL_REGIONS, which means the annotation overlay, the
 * click-to-highlight interaction and the readability estimator all operate on
 * true coordinates instead of random rectangles.
 *
 * When a real OCR backend is connected, LABEL_REGIONS is simply replaced by the
 * word boxes returned by the engine — nothing else in the UI changes.
 */

export const LABEL_WIDTH = 800;
export const LABEL_HEIGHT = 1040;

type Rect = { x: number; y: number; w: number; h: number };

export const LABEL_REGIONS: Record<string, Rect> = {
  PRODUCT_IDENTITY: { x: 48, y: 112, w: 704, h: 132 },
  NET_QUANTITY: { x: 48, y: 296, w: 330, h: 96 },
  MRP: { x: 422, y: 296, w: 330, h: 96 },
  MANUFACTURER_NAME: { x: 48, y: 416, w: 704, h: 58 },
  MANUFACTURER_ADDRESS: { x: 48, y: 478, w: 704, h: 84 },
  DATE_OF_PACKING: { x: 48, y: 582, w: 330, h: 80 },
  BEST_BEFORE: { x: 422, y: 582, w: 330, h: 80 },
  CONSUMER_CARE: { x: 48, y: 686, w: 704, h: 82 },
  COUNTRY_OF_ORIGIN: { x: 48, y: 790, w: 330, h: 72 },
  IMPORTER_DETAILS: { x: 422, y: 790, w: 330, h: 72 },
  FSSAI_LICENSE: { x: 48, y: 878, w: 340, h: 48 },
  BATCH_NUMBER: { x: 412, y: 878, w: 340, h: 48 },
  BARCODE: { x: 48, y: 942, w: 704, h: 74 },
};

/** Convert a pixel region on the synthetic label into a normalised bounding box. */
export function toBox(key: string): BoundingBox {
  const r = LABEL_REGIONS[key] ?? LABEL_REGIONS.PRODUCT_IDENTITY;
  return {
    x: r.x / LABEL_WIDTH,
    y: r.y / LABEL_HEIGHT,
    w: r.w / LABEL_WIDTH,
    h: r.h / LABEL_HEIGHT,
  };
}

export interface LabelSpec {
  imageId: string;
  brandColor: string;
  accentColor: string;
  brand: string;
  productName: string;
  descriptor: string;
  netQuantity?: string;
  mrp?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  packedOn?: string;
  bestBefore?: string;
  consumerCare?: string;
  countryOfOrigin?: string;
  importer?: string;
  fssai?: string;
  batch?: string;
  barcode?: string;
  /** Declarations rendered at sub-threshold size to demo the readability engine. */
  tinyFields?: DeclarationKey[];
  /** Declarations rendered at low contrast (faded print / worn packaging). */
  fadedFields?: DeclarationKey[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function block(
  key: string,
  caption: string,
  value: string | undefined,
  opts: { valueSize?: number; tiny?: boolean; faded?: boolean; lines?: string[] } = {},
) {
  if (!value && !opts.lines) return '';
  const r = LABEL_REGIONS[key];
  const size = opts.tiny ? 13 : opts.valueSize ?? 26;
  const fill = opts.faded ? '#94A3B8' : '#0F172A';
  const lines = opts.lines ?? [value!];
  const body = lines
    .map(
      (line, i) =>
        `<text x="${r.x + 14}" y="${r.y + 46 + i * (size + 6)}" font-family="Inter, Segoe UI, sans-serif" font-size="${size}" font-weight="${opts.tiny ? 500 : 700}" fill="${fill}">${esc(line)}</text>`,
    )
    .join('');
  return `
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="#FFFFFF" stroke="#E2E8F0"/>
    <text x="${r.x + 14}" y="${r.y + 22}" font-family="Inter, Segoe UI, sans-serif" font-size="12" font-weight="700" letter-spacing="1.1" fill="#64748B">${esc(caption.toUpperCase())}</text>
    ${body}`;
}

function barcodeBars(x: number, y: number, w: number, h: number, seed: string) {
  let bars = '';
  let cursor = x + 12;
  for (let i = 0; cursor < x + w - 130; i++) {
    const code = seed.charCodeAt(i % seed.length);
    const barW = 2 + (code % 4);
    if (i % 2 === 0) {
      bars += `<rect x="${cursor}" y="${y + 10}" width="${barW}" height="${h - 32}" fill="#0F172A"/>`;
    }
    cursor += barW + 2;
  }
  return bars;
}

export function renderLabelSvg(spec: LabelSpec): string {
  const tiny = new Set(spec.tinyFields ?? []);
  const faded = new Set(spec.fadedFields ?? []);
  const is = (k: DeclarationKey) => ({ tiny: tiny.has(k), faded: faded.has(k) });
  const bc = LABEL_REGIONS.BARCODE;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" viewBox="0 0 ${LABEL_WIDTH} ${LABEL_HEIGHT}">
  <defs>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${spec.brandColor}"/>
      <stop offset="100%" stop-color="${spec.accentColor}"/>
    </linearGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" fill="#F1F5F9"/>
  <rect x="16" y="16" width="${LABEL_WIDTH - 32}" height="${LABEL_HEIGHT - 32}" rx="18" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>
  <rect x="16" y="16" width="${LABEL_WIDTH - 32}" height="76" rx="18" fill="url(#hdr)"/>
  <rect x="16" y="70" width="${LABEL_WIDTH - 32}" height="22" fill="url(#hdr)"/>
  <text x="48" y="64" font-family="Inter, Segoe UI, sans-serif" font-size="30" font-weight="800" letter-spacing="1.5" fill="#FFFFFF">${esc(spec.brand.toUpperCase())}</text>
  <text x="${LABEL_WIDTH - 48}" y="64" text-anchor="end" font-family="Inter, Segoe UI, sans-serif" font-size="15" font-weight="600" fill="#FFFFFFCC">${esc(spec.descriptor)}</text>

  <rect x="${LABEL_REGIONS.PRODUCT_IDENTITY.x}" y="${LABEL_REGIONS.PRODUCT_IDENTITY.y}" width="${LABEL_REGIONS.PRODUCT_IDENTITY.w}" height="${LABEL_REGIONS.PRODUCT_IDENTITY.h}" rx="8" fill="#F8FAFC" stroke="#E2E8F0"/>
  <text x="${LABEL_REGIONS.PRODUCT_IDENTITY.x + 18}" y="${LABEL_REGIONS.PRODUCT_IDENTITY.y + 30}" font-family="Inter, Segoe UI, sans-serif" font-size="12" font-weight="700" letter-spacing="1.1" fill="#64748B">PRODUCT</text>
  <text x="${LABEL_REGIONS.PRODUCT_IDENTITY.x + 18}" y="${LABEL_REGIONS.PRODUCT_IDENTITY.y + 82}" font-family="Inter, Segoe UI, sans-serif" font-size="42" font-weight="800" fill="#0B2545">${esc(spec.productName)}</text>
  <text x="${LABEL_REGIONS.PRODUCT_IDENTITY.x + 18}" y="${LABEL_REGIONS.PRODUCT_IDENTITY.y + 114}" font-family="Inter, Segoe UI, sans-serif" font-size="17" font-weight="500" fill="#475569">${esc(spec.descriptor)}</text>

  ${block('NET_QUANTITY', 'Net Quantity', spec.netQuantity, { valueSize: 34, ...is('NET_QUANTITY') })}
  ${block('MRP', 'Maximum Retail Price', spec.mrp, { valueSize: 34, ...is('MRP') })}
  ${block('MANUFACTURER_NAME', 'Manufactured / Packed by', spec.manufacturerName, { valueSize: 22, ...is('MANUFACTURER_NAME') })}
  ${block('MANUFACTURER_ADDRESS', 'Address', undefined, {
    valueSize: 17,
    ...is('MANUFACTURER_ADDRESS'),
    lines: spec.manufacturerAddress ? spec.manufacturerAddress.split(' | ') : undefined,
  })}
  ${block('DATE_OF_PACKING', 'Month & Year of Packing', spec.packedOn, { valueSize: 24, ...is('DATE_OF_PACKING') })}
  ${block('BEST_BEFORE', 'Best Before', spec.bestBefore, { valueSize: 24, ...is('BEST_BEFORE') })}
  ${block('CONSUMER_CARE', 'Consumer Care', undefined, {
    valueSize: 19,
    ...is('CONSUMER_CARE'),
    lines: spec.consumerCare ? spec.consumerCare.split(' | ') : undefined,
  })}
  ${block('COUNTRY_OF_ORIGIN', 'Country of Origin', spec.countryOfOrigin, { valueSize: 22, ...is('COUNTRY_OF_ORIGIN') })}
  ${block('IMPORTER_DETAILS', 'Imported / Marketed by', spec.importer, { valueSize: 16, ...is('IMPORTER_DETAILS') })}
  ${block('FSSAI_LICENSE', 'FSSAI Lic. No.', spec.fssai, { valueSize: 18, ...is('FSSAI_LICENSE') })}
  ${block('BATCH_NUMBER', 'Batch No.', spec.batch, { valueSize: 18, ...is('BATCH_NUMBER') })}

  ${
    spec.barcode
      ? `<rect x="${bc.x}" y="${bc.y}" width="${bc.w}" height="${bc.h}" rx="6" fill="#FFFFFF" stroke="#E2E8F0"/>
         ${barcodeBars(bc.x, bc.y, bc.w, bc.h, spec.barcode)}
         <text x="${bc.x + bc.w - 16}" y="${bc.y + 46}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="20" font-weight="600" fill="#0F172A">${esc(spec.barcode)}</text>`
      : ''
  }
</svg>`;
}

export function labelDataUri(spec: LabelSpec): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderLabelSvg(spec))}`;
}
