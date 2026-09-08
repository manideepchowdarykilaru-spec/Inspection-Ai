import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, Boxes, LayoutGrid, List, Search } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { distinctBrands, distinctCategories, listProducts, type ProductQuery } from '@/services/productService';
import { resolveImage } from '@/services/imageService';
import { formatCurrency, formatDate } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { Product } from '@shared/types';

export default function ProductRepository() {
  const navigate = useNavigate();
  const [query, setQuery] = useState<ProductQuery>({ search: '', category: 'ALL', status: 'ALL', brand: 'ALL' });
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const products = useDatabase(() => listProducts(query), [JSON.stringify(query)]);
  const brands = useDatabase(() => distinctBrands(), []);
  const categories = useDatabase(() => distinctCategories(), []);

  usePageChrome(
    {
      title: 'Product Repository',
      subtitle: 'Every commodity scanned by the department, with its compliance history',
    },
    [],
  );

  const set = (patch: Partial<ProductQuery>) => setQuery((q) => ({ ...q, ...patch }));

  const columns: Column<Product>[] = [
    {
      key: 'product',
      header: 'Product',
      sortValue: (p) => p.name,
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={resolveImage(p.imageId)}
            alt=""
            className="h-10 w-8 shrink-0 rounded border border-slate-200 object-cover object-top"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{p.name}</p>
            <p className="truncate text-2xs text-slate-500">{p.category}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'brand',
      header: 'Brand',
      sortValue: (p) => p.brand,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-700">{p.brand}</p>
          {p.repeatOffender && (
            <Badge tone="red" size="sm" className="mt-1">
              Repeat offender
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'manufacturer',
      header: 'Manufacturer',
      hideOnMobile: true,
      sortValue: (p) => p.manufacturer,
      render: (p) => <span className="text-xs text-slate-600">{p.manufacturer}</span>,
    },
    {
      key: 'last',
      header: 'Last inspection',
      sortValue: (p) => p.lastInspectedAt ?? '',
      render: (p) => (
        <span className="whitespace-nowrap text-xs text-slate-600">
          {p.lastInspectedAt ? formatDate(p.lastInspectedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      sortValue: (p) => p.latestScore ?? 0,
      render: (p) => (
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            (p.latestScore ?? 0) >= 90
              ? 'text-emerald-700'
              : (p.latestScore ?? 0) >= 70
                ? 'text-amber-700'
                : 'text-red-700',
          )}
        >
          {p.latestScore ?? '—'}
        </span>
      ),
    },
    {
      key: 'violations',
      header: 'Open findings',
      sortValue: (p) => p.openViolations,
      render: (p) => <span className="font-mono text-xs text-slate-700">{p.openViolations}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (p) => p.latestStatus ?? '',
      render: (p) => (p.latestStatus ? <StatusBadge status={p.latestStatus} size="sm" /> : '—'),
    },
    {
      key: 'action',
      header: 'Action',
      render: (p) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/app/products/${p.id}`);
          }}
        >
          Open
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={query.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Search by product, brand, manufacturer, barcode or product ID…"
              className="pl-9"
              aria-label="Search products"
            />
          </div>
          <Select
            className="w-auto min-w-[10rem]"
            value={query.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Filter by category"
          >
            <option value="ALL">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto min-w-[9rem]"
            value={query.brand}
            onChange={(e) => set({ brand: e.target.value })}
            aria-label="Filter by brand"
          >
            <option value="ALL">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto min-w-[9rem]"
            value={query.status}
            onChange={(e) => set({ status: e.target.value as ProductQuery['status'] })}
            aria-label="Filter by status"
          >
            <option value="ALL">Any status</option>
            <option value="COMPLIANT">Compliant</option>
            <option value="NEEDS_REVIEW">Needs review</option>
            <option value="NON_COMPLIANT">Non-compliant</option>
          </Select>
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={cn('p-2 transition-colors', view === 'grid' ? 'bg-navy-900 text-white' : 'text-slate-500 hover:bg-slate-50')}
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={cn('p-2 transition-colors', view === 'table' ? 'bg-navy-900 text-white' : 'text-slate-500 hover:bg-slate-50')}
              aria-label="Table view"
              aria-pressed={view === 'table'}
            >
              <List size={15} />
            </button>
          </div>
        </div>

        {view === 'table' ? (
          <DataTable
            columns={columns}
            rows={products}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate(`/app/products/${p.id}`)}
            pageSize={10}
          />
        ) : products.length === 0 ? (
          <EmptyState
            title="No products match"
            description="Adjust the search or filters to see scanned commodities."
            icon={<Boxes size={20} />}
          />
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/app/products/${p.id}`)}
                className="surface group flex gap-3 p-3 text-left transition-all hover:border-slate-300 hover:shadow-elevated"
              >
                <img
                  src={resolveImage(p.imageId)}
                  alt=""
                  className="h-24 w-[72px] shrink-0 rounded border border-slate-200 object-cover object-top"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
                  <p className="truncate text-2xs text-slate-500">{p.brand}</p>
                  <p className="mt-1 truncate text-2xs text-slate-400">{p.category}</p>

                  <div className="mt-2 flex items-baseline gap-2">
                    <span
                      className={cn(
                        'font-mono text-lg font-extrabold tabular-nums leading-none',
                        (p.latestScore ?? 0) >= 90
                          ? 'text-emerald-700'
                          : (p.latestScore ?? 0) >= 70
                            ? 'text-amber-700'
                            : 'text-red-700',
                      )}
                    >
                      {p.latestScore ?? '—'}
                    </span>
                    <span className="text-2xs text-slate-400">screening score</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.latestStatus && <StatusBadge status={p.latestStatus} size="sm" />}
                    {p.repeatOffender && (
                      <Badge tone="red" size="sm" icon={<AlertOctagon size={10} />}>
                        Repeat
                      </Badge>
                    )}
                  </div>

                  <p className="mt-2 text-2xs text-slate-500">
                    {formatCurrency(p.mrp)} · {p.netQuantity} · {p.inspectionCount} inspection(s)
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
