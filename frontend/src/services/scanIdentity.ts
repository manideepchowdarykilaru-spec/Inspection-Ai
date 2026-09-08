import type { Declaration, DeclarationKey, ProductCategory } from '@shared/types';
import type { DemoCase, ExtractedField } from '@shared/data/demoProducts';

/**
 * Derives the commodity's identity from what OCR actually read.
 *
 * Without this the inspection would inherit the demonstration sample's name,
 * brand and category — so a photograph of toor dal would be filed against
 * "Premium Basmati Rice". The product record has to describe the package that
 * was scanned, not the sample that happened to be selected on the form.
 */

const value = (declarations: Declaration[], key: DeclarationKey) =>
  declarations.find((d) => d.key === key)?.detectedValue ?? undefined;

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Rebuilds the extraction map so the product record stores the read values. */
function extractionFrom(declarations: Declaration[]): Partial<Record<DeclarationKey, ExtractedField>> {
  return declarations.reduce<Partial<Record<DeclarationKey, ExtractedField>>>((acc, d) => {
    acc[d.key] = {
      value: d.detectedValue,
      confidence: d.confidence,
      textHeightPx: d.readability?.textHeightPx,
      contrastRatio: d.readability?.contrastRatio,
    };
    return acc;
  }, {});
}

export function caseFromScan(
  base: DemoCase,
  declarations: Declaration[],
  category: ProductCategory,
): DemoCase {
  const productName = value(declarations, 'PRODUCT_IDENTITY') ?? 'Unidentified commodity';
  const manufacturer = value(declarations, 'MANUFACTURER_NAME');
  const brand = manufacturer ?? 'Not declared';
  const barcode = value(declarations, 'BATCH_NUMBER');

  // A stable id keyed on the declared identity, so re-inspecting the same
  // commodity attaches to its existing product record and compliance history.
  const identity = slug(`${productName}-${manufacturer ?? 'unknown'}`) || 'unidentified';

  return {
    ...base,
    id: identity,
    title: productName,
    subtitle: `${value(declarations, 'NET_QUANTITY') ?? 'Quantity not declared'} · ${category}`,
    category,
    brand,
    productName,
    headline: 'Read from the uploaded photograph',
    extraction: extractionFrom(declarations),
    label: {
      ...base.label,
      brand,
      productName,
      barcode: barcode ?? base.label.barcode,
    },
  };
}
