import type { DeclarationKey, ProductCategory } from '@shared/types';
import { labelDataUri, type LabelSpec } from './labelImages';

/**
 * Demo corpus for the SIH walkthrough.
 *
 * Each case carries (a) the vector label that is rendered as the "photograph",
 * and (b) the field-level extraction that the mock OCR engine returns for it.
 * The rule engine then derives declarations, violations and the screening score
 * from this extraction — no score or violation text is hard-coded.
 */

export interface ExtractedField {
  value: string | null;
  confidence: number;
  /** Cap height of the printed text in pixels, measured on the source image. */
  textHeightPx?: number;
  /** Foreground/background contrast ratio measured in the detected region. */
  contrastRatio?: number;
  /** Set when the OCR engine produced a partial or ambiguous read. */
  partial?: boolean;
}

export interface DemoCase {
  id: string;
  title: string;
  subtitle: string;
  category: ProductCategory;
  brand: string;
  productName: string;
  expectedOutcome: 'COMPLIANT' | 'NEEDS_REVIEW' | 'NON_COMPLIANT';
  headline: string;
  label: LabelSpec;
  extraction: Partial<Record<DeclarationKey, ExtractedField>>;
  ocrMeta: { engine: string; imageWidth: number; imageHeight: number; estimatedDpi: number };
}

const OCR_META = {
  engine: 'PaddleOCR v4 (PP-OCRv4) · en+hi',
  imageWidth: 800,
  imageHeight: 1040,
  estimatedDpi: 254,
};

export const DEMO_CASES: DemoCase[] = [
  /* ------------------------------------------------------------ 1. Rice */
  {
    id: 'demo-rice',
    title: 'Packaged Basmati Rice',
    subtitle: '5 kg · Cereals & Grains',
    category: 'Cereals & Grains',
    brand: 'Annapurna Select',
    productName: 'Premium Basmati Rice',
    expectedOutcome: 'COMPLIANT',
    headline: 'Fully declared label — expected to clear screening',
    label: {
      imageId: 'img-demo-rice',
      brandColor: '#166534',
      accentColor: '#65A30D',
      brand: 'Annapurna Select',
      productName: 'Premium Basmati Rice',
      descriptor: 'Aged 12 Months · Extra Long Grain',
      netQuantity: '5 kg',
      mrp: 'MRP Rs. 650.00 (incl. of all taxes)',
      manufacturerName: 'Annapurna Agro Foods Pvt. Ltd.',
      manufacturerAddress:
        'Plot 42, Food Park Phase II, Medchal | Hyderabad, Telangana - 501401 | India',
      packedOn: '08/2026',
      bestBefore: '18 months from packing',
      consumerCare: 'Consumer Care Cell, Annapurna Agro Foods Pvt. Ltd. | 1800-200-4455 | care@annapurnaagro.example',
      countryOfOrigin: 'India',
      fssai: '10018043002915',
      batch: 'BR-2608-A17',
      barcode: '8901234567895',
    },
    extraction: {
      PRODUCT_IDENTITY: { value: 'Premium Basmati Rice', confidence: 0.99, textHeightPx: 42, contrastRatio: 12.1 },
      MANUFACTURER_NAME: { value: 'Annapurna Agro Foods Pvt. Ltd.', confidence: 0.97, textHeightPx: 22, contrastRatio: 11.4 },
      MANUFACTURER_ADDRESS: {
        value: 'Plot 42, Food Park Phase II, Medchal, Hyderabad, Telangana - 501401, India',
        confidence: 0.94,
        textHeightPx: 17,
        contrastRatio: 10.2,
      },
      NET_QUANTITY: { value: '5 kg', confidence: 0.98, textHeightPx: 34, contrastRatio: 12.6 },
      MRP: { value: 'MRP Rs. 650.00 (incl. of all taxes)', confidence: 0.98, textHeightPx: 34, contrastRatio: 12.6 },
      CONSUMER_CARE: {
        value: 'Consumer Care Cell, Annapurna Agro Foods Pvt. Ltd., 1800-200-4455, care@annapurnaagro.example',
        confidence: 0.93,
        textHeightPx: 19,
        contrastRatio: 4.2,
      },
      DATE_OF_PACKING: { value: '08/2026', confidence: 0.96, textHeightPx: 24, contrastRatio: 11.8 },
      BEST_BEFORE: { value: '18 months from packing', confidence: 0.92, textHeightPx: 24, contrastRatio: 11.8 },
      COUNTRY_OF_ORIGIN: { value: 'India', confidence: 0.97, textHeightPx: 22, contrastRatio: 11.9 },
      FSSAI_LICENSE: { value: '10018043002915', confidence: 0.95, textHeightPx: 18, contrastRatio: 10.9 },
      BATCH_NUMBER: { value: 'BR-2608-A17', confidence: 0.95, textHeightPx: 18, contrastRatio: 10.9 },
    },
    ocrMeta: OCR_META,
  },

  /* ---------------------------------------------------------- 2. Spices */
  {
    id: 'demo-spices',
    title: 'Packaged Spice Blend',
    subtitle: '500 g · Spices & Condiments',
    category: 'Spices & Condiments',
    brand: 'Deccan Masala',
    productName: 'Sambar Masala Powder',
    expectedOutcome: 'NON_COMPLIANT',
    headline: 'Missing consumer care, malformed MRP and sub-threshold print',
    label: {
      imageId: 'img-demo-spices',
      brandColor: '#B45309',
      accentColor: '#DC2626',
      brand: 'Deccan Masala',
      productName: 'Sambar Masala Powder',
      descriptor: 'Traditional South Indian Blend',
      netQuantity: '500gms.',
      mrp: 'Rs 185/-',
      manufacturerName: 'Deccan Spice Works',
      manufacturerAddress: 'Sy. No. 118, Jeedimetla Industrial Area | Hyderabad - 500055',
      packedOn: '07/2026',
      bestBefore: '12 months',
      countryOfOrigin: 'India',
      fssai: '13319004000278',
      barcode: '8902345678901',
      tinyFields: ['NET_QUANTITY', 'DATE_OF_PACKING'],
      fadedFields: ['MANUFACTURER_ADDRESS', 'BEST_BEFORE'],
    },
    extraction: {
      PRODUCT_IDENTITY: { value: 'Sambar Masala Powder', confidence: 0.98, textHeightPx: 42, contrastRatio: 11.6 },
      MANUFACTURER_NAME: { value: 'Deccan Spice Works', confidence: 0.95, textHeightPx: 22, contrastRatio: 10.8 },
      MANUFACTURER_ADDRESS: {
        value: 'Sy. No. 118, Jeedimetla Industrial Area, Hyderabad - 500055',
        confidence: 0.81,
        textHeightPx: 17,
        contrastRatio: 2.9,
      },
      NET_QUANTITY: { value: '500gms.', confidence: 0.72, textHeightPx: 13, contrastRatio: 9.4 },
      MRP: { value: 'Rs 185/-', confidence: 0.94, textHeightPx: 34, contrastRatio: 12.2 },
      CONSUMER_CARE: { value: null, confidence: 0.94 },
      DATE_OF_PACKING: { value: '07/2026', confidence: 0.7, textHeightPx: 13, contrastRatio: 9.1 },
      BEST_BEFORE: { value: '12 months', confidence: 0.68, textHeightPx: 24, contrastRatio: 2.7, partial: true },
      COUNTRY_OF_ORIGIN: { value: 'India', confidence: 0.96, textHeightPx: 22, contrastRatio: 11.5 },
      FSSAI_LICENSE: { value: '13319004000278', confidence: 0.93, textHeightPx: 18, contrastRatio: 10.4 },
      BATCH_NUMBER: { value: null, confidence: 0.91 },
    },
    ocrMeta: OCR_META,
  },

  /* -------------------------------------------------------- 3. Biscuits */
  {
    id: 'demo-biscuits',
    title: 'Packaged Biscuits',
    subtitle: '200 g · Bakery & Confectionery',
    category: 'Bakery & Confectionery',
    brand: 'Golden Crust',
    productName: 'Butter Cookies',
    expectedOutcome: 'NEEDS_REVIEW',
    headline: 'Declarations present but print height needs physical verification',
    label: {
      imageId: 'img-demo-biscuits',
      brandColor: '#A16207',
      accentColor: '#F59E0B',
      brand: 'Golden Crust',
      productName: 'Butter Cookies',
      descriptor: 'Baked with Real Butter',
      netQuantity: '200 g',
      mrp: 'MRP Rs. 60',
      manufacturerName: 'Golden Crust Bakers Pvt. Ltd.',
      manufacturerAddress: 'Unit 7, MIDC Bhosari | Pune, Maharashtra - 411026 | India',
      packedOn: '09/2026',
      bestBefore: '06 months from packing',
      consumerCare: 'Golden Crust Bakers Pvt. Ltd. | 022-4000-1188',
      countryOfOrigin: 'India',
      fssai: '11517008000342',
      barcode: '8903456789012',
      tinyFields: ['DATE_OF_PACKING', 'CONSUMER_CARE'],
      fadedFields: ['CONSUMER_CARE'],
    },
    extraction: {
      PRODUCT_IDENTITY: { value: 'Butter Cookies', confidence: 0.99, textHeightPx: 42, contrastRatio: 11.9 },
      MANUFACTURER_NAME: { value: 'Golden Crust Bakers Pvt. Ltd.', confidence: 0.96, textHeightPx: 22, contrastRatio: 11.1 },
      MANUFACTURER_ADDRESS: {
        value: 'Unit 7, MIDC Bhosari, Pune, Maharashtra - 411026, India',
        confidence: 0.93,
        textHeightPx: 17,
        contrastRatio: 10.4,
      },
      NET_QUANTITY: { value: '200 g', confidence: 0.97, textHeightPx: 34, contrastRatio: 12.4 },
      MRP: { value: 'MRP Rs. 60', confidence: 0.96, textHeightPx: 34, contrastRatio: 12.4 },
      CONSUMER_CARE: {
        value: 'Golden Crust Bakers Pvt. Ltd., 022-4000-1188',
        confidence: 0.79,
        textHeightPx: 13,
        contrastRatio: 3.4,
        partial: true,
      },
      DATE_OF_PACKING: { value: '09/2026', confidence: 0.74, textHeightPx: 15, contrastRatio: 9.6 },
      BEST_BEFORE: { value: '06 months from packing', confidence: 0.9, textHeightPx: 24, contrastRatio: 11.2 },
      COUNTRY_OF_ORIGIN: { value: 'India', confidence: 0.96, textHeightPx: 22, contrastRatio: 11.4 },
      FSSAI_LICENSE: { value: '11517008000342', confidence: 0.94, textHeightPx: 18, contrastRatio: 10.6 },
      BATCH_NUMBER: { value: null, confidence: 0.88 },
    },
    ocrMeta: OCR_META,
  },

  /* ------------------------------------------------- 4. Imported choc. */
  {
    id: 'demo-chocolate',
    title: 'Imported Chocolate',
    subtitle: '100 g · Imported Goods',
    category: 'Imported Goods',
    brand: 'Alpen Noir',
    productName: 'Dark Chocolate 70%',
    expectedOutcome: 'NEEDS_REVIEW',
    headline: 'Importer declaration incomplete — import compliance check triggered',
    label: {
      imageId: 'img-demo-chocolate',
      brandColor: '#3F1D0B',
      accentColor: '#92400E',
      brand: 'Alpen Noir',
      productName: 'Dark Chocolate 70%',
      descriptor: 'Single Origin Cacao · Swiss Made',
      netQuantity: '100 G',
      mrp: 'MRP Rs. 425.00 (incl. of all taxes)',
      manufacturerName: 'Alpen Noir Schokolade AG',
      manufacturerAddress: 'Industriestrasse 14, 6300 Zug | Switzerland',
      packedOn: '06/2026',
      bestBefore: '12/2027',
      consumerCare: 'Consumer Desk, Continental Gourmet Imports | 1800-419-7788 | help@cgimports.example',
      countryOfOrigin: 'Switzerland',
      importer: 'Continental Gourmet Imports',
      fssai: '10021032001884',
      batch: 'AN-70-2606',
      barcode: '7612345098761',
      tinyFields: ['IMPORTER_DETAILS'],
      fadedFields: ['IMPORTER_DETAILS'],
    },
    extraction: {
      PRODUCT_IDENTITY: { value: 'Dark Chocolate 70%', confidence: 0.98, textHeightPx: 42, contrastRatio: 11.7 },
      MANUFACTURER_NAME: { value: 'Alpen Noir Schokolade AG', confidence: 0.95, textHeightPx: 22, contrastRatio: 10.9 },
      MANUFACTURER_ADDRESS: {
        value: 'Industriestrasse 14, 6300 Zug, Switzerland',
        confidence: 0.92,
        textHeightPx: 17,
        contrastRatio: 10.1,
      },
      NET_QUANTITY: { value: '100 G', confidence: 0.95, textHeightPx: 34, contrastRatio: 12.3 },
      MRP: { value: 'MRP Rs. 425.00 (incl. of all taxes)', confidence: 0.97, textHeightPx: 34, contrastRatio: 12.3 },
      CONSUMER_CARE: {
        value: 'Consumer Desk, Continental Gourmet Imports, 1800-419-7788, help@cgimports.example',
        confidence: 0.91,
        textHeightPx: 19,
        contrastRatio: 10.5,
      },
      DATE_OF_PACKING: { value: '06/2026', confidence: 0.94, textHeightPx: 24, contrastRatio: 11.6 },
      BEST_BEFORE: { value: '12/2027', confidence: 0.94, textHeightPx: 24, contrastRatio: 11.6 },
      COUNTRY_OF_ORIGIN: { value: 'Switzerland', confidence: 0.96, textHeightPx: 22, contrastRatio: 11.5 },
      IMPORTER_DETAILS: {
        value: 'Continental Gourmet Imports',
        confidence: 0.68,
        textHeightPx: 13,
        contrastRatio: 3.1,
        partial: true,
      },
      FSSAI_LICENSE: { value: '10021032001884', confidence: 0.93, textHeightPx: 18, contrastRatio: 10.3 },
      BATCH_NUMBER: { value: 'AN-70-2606', confidence: 0.93, textHeightPx: 18, contrastRatio: 10.3 },
    },
    ocrMeta: OCR_META,
  },
];

export function getDemoCase(id: string) {
  return DEMO_CASES.find((c) => c.id === id);
}

/** Cached data URIs so the SVG is serialised once per session. */
const imageCache = new Map<string, string>();

export function demoImage(caseId: string): string {
  const cached = imageCache.get(caseId);
  if (cached) return cached;
  const demo = getDemoCase(caseId);
  const uri = demo ? labelDataUri(demo.label) : '';
  imageCache.set(caseId, uri);
  return uri;
}

export function imageForId(imageId: string): string {
  const demo = DEMO_CASES.find((c) => c.label.imageId === imageId);
  return demo ? demoImage(demo.id) : '';
}
