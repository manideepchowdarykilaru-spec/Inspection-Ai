import type { DeclarationKey, ProductCategory } from '@shared/types';
import type { LabelSpec } from './labelImages';
import type { DemoCase, ExtractedField } from './demoProducts';

/**
 * Derives an OCR extraction from a label specification.
 *
 * The seeded inspection corpus is built with this factory so that every
 * historical record in the prototype carries a real label render, real
 * declarations and real rule results — opening any inspection from History
 * produces the same fidelity as running a live scan.
 */

const DEFAULT_HEIGHT_PX: Record<DeclarationKey, number> = {
  PRODUCT_IDENTITY: 42,
  MANUFACTURER_NAME: 22,
  MANUFACTURER_ADDRESS: 17,
  NET_QUANTITY: 34,
  MRP: 34,
  CONSUMER_CARE: 19,
  DATE_OF_PACKING: 24,
  BEST_BEFORE: 24,
  COUNTRY_OF_ORIGIN: 22,
  IMPORTER_DETAILS: 16,
  FSSAI_LICENSE: 18,
  BATCH_NUMBER: 18,
};

const LABEL_FIELD: Record<DeclarationKey, keyof LabelSpec> = {
  PRODUCT_IDENTITY: 'productName',
  MANUFACTURER_NAME: 'manufacturerName',
  MANUFACTURER_ADDRESS: 'manufacturerAddress',
  NET_QUANTITY: 'netQuantity',
  MRP: 'mrp',
  CONSUMER_CARE: 'consumerCare',
  DATE_OF_PACKING: 'packedOn',
  BEST_BEFORE: 'bestBefore',
  COUNTRY_OF_ORIGIN: 'countryOfOrigin',
  IMPORTER_DETAILS: 'importer',
  FSSAI_LICENSE: 'fssai',
  BATCH_NUMBER: 'batch',
};

const OCR_META = {
  engine: 'PaddleOCR v4 (PP-OCRv4) · en+hi',
  imageWidth: 800,
  imageHeight: 1040,
  estimatedDpi: 254,
};

export interface CaseSeed {
  id: string;
  title: string;
  subtitle: string;
  category: ProductCategory;
  headline?: string;
  label: LabelSpec;
}

export function synthesizeCase(seed: CaseSeed): DemoCase {
  const tiny = new Set(seed.label.tinyFields ?? []);
  const faded = new Set(seed.label.fadedFields ?? []);
  const extraction: Partial<Record<DeclarationKey, ExtractedField>> = {};

  (Object.keys(LABEL_FIELD) as DeclarationKey[]).forEach((key) => {
    const raw = seed.label[LABEL_FIELD[key]];
    if (typeof raw !== 'string' || raw.trim() === '') {
      extraction[key] = { value: null, confidence: 0.92 };
      return;
    }
    const isTiny = tiny.has(key);
    const isFaded = faded.has(key);
    const confidence = isTiny && isFaded ? 0.68 : isTiny ? 0.74 : isFaded ? 0.8 : 0.95;
    extraction[key] = {
      value: raw.split(' | ').join(', '),
      confidence,
      textHeightPx: isTiny ? 13 : DEFAULT_HEIGHT_PX[key],
      contrastRatio: isFaded ? 2.9 : 10.8,
      partial: isTiny || isFaded,
    };
  });

  return {
    id: seed.id,
    title: seed.title,
    subtitle: seed.subtitle,
    category: seed.category,
    brand: seed.label.brand,
    productName: seed.label.productName,
    expectedOutcome: 'NEEDS_REVIEW',
    headline: seed.headline ?? '',
    label: seed.label,
    extraction,
    ocrMeta: OCR_META,
  };
}
