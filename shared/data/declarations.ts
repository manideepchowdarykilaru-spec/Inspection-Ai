import type { DeclarationKey } from '../types';

/**
 * Shared declaration vocabulary.
 *
 * Deliberately free of path aliases and browser APIs so the OCR service on the
 * server and the React client can both import it without duplication.
 */

export const DECLARATION_LABELS: Record<DeclarationKey, string> = {
  PRODUCT_IDENTITY: 'Product Name / Identity',
  MANUFACTURER_NAME: 'Manufacturer / Packer',
  MANUFACTURER_ADDRESS: 'Address',
  NET_QUANTITY: 'Net Quantity',
  MRP: 'Maximum Retail Price',
  CONSUMER_CARE: 'Consumer Care Details',
  DATE_OF_PACKING: 'Month & Year of Packing',
  COUNTRY_OF_ORIGIN: 'Country of Origin',
  IMPORTER_DETAILS: 'Importer Details',
  BEST_BEFORE: 'Best Before / Use By',
  FSSAI_LICENSE: 'Licence Number (FSSAI / Mfg. Lic.)',
  BATCH_NUMBER: 'Batch / Lot Number',
};

export const DECLARATION_ORDER: DeclarationKey[] = [
  'PRODUCT_IDENTITY',
  'MANUFACTURER_NAME',
  'MANUFACTURER_ADDRESS',
  'NET_QUANTITY',
  'MRP',
  'CONSUMER_CARE',
  'DATE_OF_PACKING',
  'BEST_BEFORE',
  'COUNTRY_OF_ORIGIN',
  'IMPORTER_DETAILS',
  'FSSAI_LICENSE',
  'BATCH_NUMBER',
];

/** Minimum print height applied by the readability rule, in millimetres. */
export const DEFAULT_MIN_HEIGHT_MM = 1.5;
