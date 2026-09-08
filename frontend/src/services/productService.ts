import type { ComplianceStatus, Product } from '@shared/types';
import { getDb } from './storage';
import { listInspections } from './inspectionService';

export interface ProductQuery {
  search?: string;
  category?: string | 'ALL';
  status?: ComplianceStatus | 'ALL';
  brand?: string | 'ALL';
  onlyRepeatOffenders?: boolean;
}

export function listProducts(query: ProductQuery = {}): Product[] {
  const search = query.search?.trim().toLowerCase();
  return getDb()
    .products.filter((p) => {
      if (query.category && query.category !== 'ALL' && p.category !== query.category) return false;
      if (query.brand && query.brand !== 'ALL' && p.brand !== query.brand) return false;
      if (query.status && query.status !== 'ALL' && p.latestStatus !== query.status) return false;
      if (query.onlyRepeatOffenders && !p.repeatOffender) return false;
      if (search) {
        const haystack = [p.name, p.brand, p.manufacturer, p.barcode, p.category, p.id]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => +new Date(b.lastInspectedAt ?? 0) - +new Date(a.lastInspectedAt ?? 0));
}

export function getProduct(id: string) {
  return getDb().products.find((p) => p.id === id);
}

export function productInspections(productId: string) {
  return listInspections().filter((i) => i.productId === productId);
}

export function complianceHistory(productId: string) {
  return productInspections(productId)
    .slice()
    .reverse()
    .map((i) => ({
      date: new Date(i.inspectedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      score: i.screeningScore,
      violations: i.violations.length,
    }));
}

export function distinctBrands() {
  return Array.from(new Set(getDb().products.map((p) => p.brand))).sort();
}

export function distinctCategories() {
  return Array.from(new Set(getDb().products.map((p) => p.category))).sort();
}
