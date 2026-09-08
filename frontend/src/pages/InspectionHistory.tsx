import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FileBarChart, Filter, Images, RefreshCcw, ScanLine, Search, X } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { listInspections, type InspectionQuery } from '@/services/inspectionService';
import { distinctBrands, distinctCategories } from '@/services/productService';
import { USERS, REGIONS } from '@shared/data/mockData';
import { formatDate } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { Inspection } from '@shared/types';

const EMPTY: InspectionQuery = {
  search: '',
  status: 'ALL',
  category: 'ALL',
  brand: 'ALL',
  inspectorId: 'ALL',
  region: 'ALL',
  severity: 'ALL',
  from: '',
  to: '',
};

export default function InspectionHistory() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [query, setQuery] = useState<InspectionQuery>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);

  const rows = useDatabase(() => listInspections(query), [JSON.stringify(query)]);
  const brands = useDatabase(() => distinctBrands(), []);
  const categories = useDatabase(() => distinctCategories(), []);

  const activeFilters = useMemo(
    () =>
      Object.entries(query).filter(
        ([key, value]) => key !== 'search' && value && value !== 'ALL' && value !== '',
      ).length,
    [query],
  );

  usePageChrome(
    {
      title: 'Inspection History',
      subtitle: 'Search, filter and reopen previously recorded inspections',
      actions: can('inspection:create') ? (
        <Button size="sm" icon={<ScanLine size={14} />} onClick={() => navigate('/app/new-inspection')}>
          <span className="hidden sm:inline">New Inspection</span>
        </Button>
      ) : undefined,
    },
    [],
  );

  const set = (patch: Partial<InspectionQuery>) => setQuery((q) => ({ ...q, ...patch }));

  const columns: Column<Inspection>[] = [
    {
      key: 'id',
      header: 'Inspection ID',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-xs font-semibold text-navy-900">{r.id}</span>,
    },
    {
      key: 'product',
      header: 'Product',
      sortValue: (r) => r.productName,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{r.productName}</p>
          <p className="truncate text-2xs text-slate-500">{r.brand}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Inspection date',
      sortValue: (r) => r.inspectedAt,
      render: (r) => (
        <div className="whitespace-nowrap">
          <p className="text-xs text-slate-700">{formatDate(r.inspectedAt)}</p>
          <p className="text-2xs text-slate-400">{r.region}</p>
        </div>
      ),
    },
    {
      key: 'inspector',
      header: 'Inspector',
      hideOnMobile: true,
      sortValue: (r) => r.inspectorName,
      render: (r) => <span className="text-xs text-slate-600">{r.inspectorName}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      sortValue: (r) => r.screeningScore,
      render: (r) => (
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            r.screeningScore >= 90 ? 'text-emerald-700' : r.screeningScore >= 70 ? 'text-amber-700' : 'text-red-700',
          )}
        >
          {r.screeningScore}
        </span>
      ),
    },
    {
      key: 'violations',
      header: 'Findings',
      sortValue: (r) => r.violations.length,
      render: (r) => {
        const high = r.violations.filter((v) => v.severity === 'HIGH').length;
        return (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-slate-700">{r.violations.length}</span>
            {high > 0 && (
              <Badge tone="red" size="sm">
                {high} high
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} size="sm" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" aria-label="View inspection" onClick={() => navigate(`/app/inspections/${r.id}`)}>
            <Eye size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="View report"
            onClick={() => navigate(r.reportId ? `/app/reports/${r.reportId}` : `/app/inspections/${r.id}`)}
          >
            <FileBarChart size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="View evidence"
            onClick={() => navigate(`/app/inspections/${r.id}`)}
          >
            <Images size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Re-scan product"
            onClick={() => navigate('/app/new-inspection')}
          >
            <RefreshCcw size={14} />
          </Button>
        </div>
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
              placeholder="Search by inspection ID, product, brand, inspector or place…"
              className="pl-9"
              aria-label="Search inspections"
            />
          </div>
          <Button
            size="md"
            variant={showFilters ? 'secondary' : 'outline'}
            icon={<Filter size={14} />}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filters
            {activeFilters > 0 && (
              <span className="ml-1 rounded-full bg-white/25 px-1.5 text-2xs font-bold">{activeFilters}</span>
            )}
          </Button>
          {(activeFilters > 0 || query.search) && (
            <Button size="md" variant="ghost" icon={<X size={14} />} onClick={() => setQuery(EMPTY)}>
              Clear
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="label-text mb-1 block">Compliance status</span>
              <Select value={query.status} onChange={(e) => set({ status: e.target.value as InspectionQuery['status'] })}>
                <option value="ALL">All statuses</option>
                <option value="COMPLIANT">Compliant</option>
                <option value="NEEDS_REVIEW">Needs review</option>
                <option value="NON_COMPLIANT">Non-compliant</option>
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Product category</span>
              <Select value={query.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="ALL">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Brand</span>
              <Select value={query.brand} onChange={(e) => set({ brand: e.target.value })}>
                <option value="ALL">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Violation severity</span>
              <Select value={query.severity} onChange={(e) => set({ severity: e.target.value as InspectionQuery['severity'] })}>
                <option value="ALL">Any severity</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Inspector</span>
              <Select value={query.inspectorId} onChange={(e) => set({ inspectorId: e.target.value })}>
                <option value="ALL">All inspectors</option>
                {USERS.filter((u) => u.role === 'INSPECTOR').map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Region</span>
              <Select value={query.region} onChange={(e) => set({ region: e.target.value })}>
                <option value="ALL">All regions</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">From date</span>
              <Input type="date" value={query.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="block">
              <span className="label-text mb-1 block">To date</span>
              <Input type="date" value={query.to} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-2 text-2xs text-slate-500">
          <span>
            <strong className="text-slate-700">{rows.length}</strong> inspection(s) matched
          </span>
          <span>Sorted by most recent</span>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/app/inspections/${r.id}`)}
          pageSize={12}
          emptyTitle="No inspections match these filters"
          emptyDescription="Try widening the date range, clearing the severity filter or searching by product name."
        />
      </section>
    </div>
  );
}
