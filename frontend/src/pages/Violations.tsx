import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Search, ShieldAlert } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { Input, Select } from '@/components/ui/Form';
import { Badge, SeverityBadge, ViolationStateBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ChartCard, ChartTooltip, CHART_COLORS } from '@/components/charts/ChartCard';
import { KpiCard } from '@/components/ui/KpiCard';
import { listViolations } from '@/services/inspectionService';
import { COMPLIANCE_RULES } from '@shared/data/rules';
import { formatDate } from '@shared/lib/format';
import type { Inspection, Violation } from '@shared/types';

type Row = Violation & { inspection: Inspection };

export default function Violations() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [state, setState] = useState<'ALL' | 'OPEN' | 'VERIFIED' | 'DISMISSED'>('ALL');
  const [rule, setRule] = useState('ALL');

  const all = useDatabase(() => listViolations(), []);

  usePageChrome(
    {
      title: 'Violation Register',
      subtitle: 'Every potential non-compliance raised by the screening engine, pending officer verification',
    },
    [],
  );

  const rows = useMemo(
    () =>
      all.filter((v) => {
        if (severity !== 'ALL' && v.severity !== severity) return false;
        if (state !== 'ALL' && v.state !== state) return false;
        if (rule !== 'ALL' && v.ruleId !== rule) return false;
        if (search.trim()) {
          const haystack = `${v.title} ${v.ruleId} ${v.inspection.productName} ${v.inspection.brand} ${v.inspection.id}`;
          if (!haystack.toLowerCase().includes(search.trim().toLowerCase())) return false;
        }
        return true;
      }),
    [all, severity, state, rule, search],
  );

  const bySeverity = useMemo(
    () =>
      (['HIGH', 'MEDIUM', 'LOW'] as const).map((s) => ({
        name: s === 'HIGH' ? 'High' : s === 'MEDIUM' ? 'Medium' : 'Low',
        value: all.filter((v) => v.severity === s).length,
        color: s === 'HIGH' ? CHART_COLORS.red : s === 'MEDIUM' ? CHART_COLORS.amber : CHART_COLORS.brand,
      })),
    [all],
  );

  const columns: Column<Row>[] = [
    {
      key: 'finding',
      header: 'Finding',
      sortValue: (r) => r.title,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{r.title}</p>
          <p className="truncate font-mono text-2xs text-slate-400">{r.ruleId}</p>
        </div>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      sortValue: (r) => r.inspection.productName,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-800">{r.inspection.productName}</p>
          <p className="truncate text-2xs text-slate-500">{r.inspection.brand}</p>
        </div>
      ),
    },
    {
      key: 'inspection',
      header: 'Inspection',
      hideOnMobile: true,
      render: (r) => <span className="font-mono text-2xs text-navy-800">{r.inspection.id}</span>,
    },
    {
      key: 'date',
      header: 'Detected',
      sortValue: (r) => r.inspection.inspectedAt,
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-slate-600">{formatDate(r.inspection.inspectedAt)}</span>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      sortValue: (r) => r.severity,
      render: (r) => <SeverityBadge severity={r.severity} />,
    },
    {
      key: 'state',
      header: 'Officer action',
      sortValue: (r) => r.state,
      render: (r) => <ViolationStateBadge state={r.state} />,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      hideOnMobile: true,
      sortValue: (r) => r.confidence,
      render: (r) => <span className="font-mono text-xs text-slate-600">{(r.confidence * 100).toFixed(0)}%</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total findings" value={all.length} icon={<ShieldAlert size={17} />} tone="navy" />
        <KpiCard
          label="High severity"
          value={all.filter((v) => v.severity === 'HIGH').length}
          tone="red"
          sublabel="requires priority verification"
        />
        <KpiCard label="Awaiting verification" value={all.filter((v) => v.state === 'OPEN').length} tone="amber" />
        <KpiCard
          label="Verified by officers"
          value={all.filter((v) => v.state === 'VERIFIED').length}
          tone="green"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <section className="surface overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <div className="relative min-w-[12rem] flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search findings, rules or products…"
                className="pl-9"
                aria-label="Search findings"
              />
            </div>
            <Select
              className="w-auto min-w-[8rem]"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
              aria-label="Filter by severity"
            >
              <option value="ALL">Any severity</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
            <Select
              className="w-auto min-w-[9rem]"
              value={state}
              onChange={(e) => setState(e.target.value as typeof state)}
              aria-label="Filter by officer action"
            >
              <option value="ALL">Any action</option>
              <option value="OPEN">Open</option>
              <option value="VERIFIED">Verified</option>
              <option value="DISMISSED">Dismissed</option>
            </Select>
            <Select
              className="w-auto min-w-[11rem]"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              aria-label="Filter by rule"
            >
              <option value="ALL">All rules</option>
              {COMPLIANCE_RULES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.name}
                </option>
              ))}
            </Select>
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/app/inspections/${r.inspectionId}?finding=${r.id}`)}
            pageSize={12}
            emptyTitle="No findings match"
            emptyDescription="Adjust the filters to see potential non-compliances."
          />
        </section>

        <div className="space-y-4">
          <ChartCard
            title="Severity distribution"
            subtitle="Across the live inspection corpus"
            question="How much of the caseload needs priority attention?"
            height={220}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={bySeverity}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={72}
                  paddingAngle={2}
                  stroke="none"
                >
                  {bySeverity.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="surface p-4">
            <h2 className="text-sm font-bold tracking-tight text-slate-900">How findings are classified</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div>
                <dt className="font-semibold text-red-800">High</dt>
                <dd className="text-slate-600">
                  A mandatory declaration is absent or unreadable — the package cannot be cleared without
                  verification.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-amber-800">Medium</dt>
                <dd className="text-slate-600">
                  The declaration exists but its form, units or print height depart from the prescribed manner.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-brand-800">Low</dt>
                <dd className="text-slate-600">
                  Advisory observation, typically image-quality related, recorded for the officer&apos;s
                  attention.
                </dd>
              </div>
            </dl>
            <Badge tone="slate" size="sm" className="mt-3">
              All findings require official verification
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
