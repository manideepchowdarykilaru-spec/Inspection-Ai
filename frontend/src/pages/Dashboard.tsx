import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Eye,
  Percent,
  ScanLine,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useDatabase } from '@/hooks/useDatabase';
import { KpiCard } from '@/components/ui/KpiCard';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { AXIS_PROPS, ChartCard, ChartTooltip, CHART_COLORS, GRID_PROPS } from '@/components/charts/ChartCard';
import { formatDate, formatNumber } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { Inspection } from '@shared/types';
import {
  categoryStats,
  dashboardMetrics,
  regionStats,
  trend,
  violationStats,
} from '@/services/analyticsService';
import { listInspections } from '@/services/inspectionService';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const metrics = useDatabase(() => dashboardMetrics(), []);
  const inspections = useDatabase(() => listInspections(), []);
  const trendData = trend('6M');
  const violations = violationStats('12M').slice(0, 6);
  const categories = categoryStats().slice(0, 6);
  const regions = regionStats();

  usePageChrome(
    {
      title: 'Compliance Monitoring Dashboard',
      subtitle: user ? `${user.designation} · ${user.region}` : undefined,
      actions: can('inspection:create') ? (
        <Button
          size="sm"
          icon={<ScanLine size={14} />}
          onClick={() => navigate('/app/new-inspection')}
          aria-label="Start a new inspection"
        >
          <span className="hidden sm:inline">New Inspection</span>
        </Button>
      ) : undefined,
    },
    [user?.id],
  );

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
          <p className="truncate text-2xs text-slate-500 lg:hidden">{r.brand}</p>
        </div>
      ),
    },
    {
      key: 'brand',
      header: 'Brand',
      hideOnMobile: true,
      sortValue: (r) => r.brand,
      render: (r) => <span className="text-xs text-slate-600">{r.brand}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      sortValue: (r) => r.category,
      render: (r) => <span className="text-xs text-slate-600">{r.category}</span>,
    },
    {
      key: 'inspector',
      header: 'Inspector',
      hideOnMobile: true,
      sortValue: (r) => r.inspectorName,
      render: (r) => <span className="text-xs text-slate-600">{r.inspectorName}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sortValue: (r) => r.inspectedAt,
      render: (r) => <span className="whitespace-nowrap text-xs text-slate-600">{formatDate(r.inspectedAt)}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      sortValue: (r) => r.screeningScore,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-sm font-bold tabular-nums',
              r.screeningScore >= 90
                ? 'text-emerald-700'
                : r.screeningScore >= 70
                  ? 'text-amber-700'
                  : 'text-red-700',
            )}
          >
            {r.screeningScore}
          </span>
          <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-slate-100 sm:block">
            <span
              className={cn(
                'block h-full rounded-full',
                r.screeningScore >= 90
                  ? 'bg-emerald-600'
                  : r.screeningScore >= 70
                    ? 'bg-amber-500'
                    : 'bg-red-600',
              )}
              style={{ width: `${r.screeningScore}%` }}
            />
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} size="sm" />,
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          icon={<Eye size={13} />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/app/inspections/${r.id}`);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label="Total Inspections"
          value={formatNumber(metrics.totalInspections)}
          icon={<ClipboardList size={17} />}
          tone="navy"
          delta={metrics.deltas.totalInspections}
          sublabel="vs previous period"
          onClick={() => navigate('/app/inspections')}
        />
        <KpiCard
          label="Compliant"
          value={formatNumber(metrics.compliant)}
          icon={<CheckCircle2 size={17} />}
          tone="green"
          delta={metrics.deltas.compliant}
          progress={(metrics.compliant / metrics.totalInspections) * 100}
        />
        <KpiCard
          label="Non-Compliant"
          value={formatNumber(metrics.nonCompliant)}
          icon={<XCircle size={17} />}
          tone="red"
          delta={metrics.deltas.nonCompliant}
          progress={(metrics.nonCompliant / metrics.totalInspections) * 100}
        />
        <KpiCard
          label="Needs Review"
          value={formatNumber(metrics.needsReview)}
          icon={<AlertTriangle size={17} />}
          tone="amber"
          delta={metrics.deltas.needsReview}
          progress={(metrics.needsReview / metrics.totalInspections) * 100}
        />
        <KpiCard
          label="Compliance Rate"
          value={`${metrics.complianceRate}%`}
          icon={<Percent size={17} />}
          tone="blue"
          delta={metrics.deltas.complianceRate}
          progress={metrics.complianceRate}
        />
        <KpiCard
          label="Violations Detected"
          value={formatNumber(metrics.violationsDetected)}
          icon={<ShieldAlert size={17} />}
          tone="slate"
          delta={metrics.deltas.violationsDetected}
          sublabel="across all categories"
          onClick={() => navigate('/app/violations')}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="Compliance trend"
          subtitle="Inspection outcomes over the last six months"
          question="Is label compliance improving across the district?"
          height={280}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gCompliant" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gNon" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.red} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={CHART_COLORS.red} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="period" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area
                type="monotone"
                dataKey="compliant"
                name="Compliant"
                stroke={CHART_COLORS.green}
                strokeWidth={2}
                fill="url(#gCompliant)"
              />
              <Area
                type="monotone"
                dataKey="nonCompliant"
                name="Non-compliant"
                stroke={CHART_COLORS.red}
                strokeWidth={2}
                fill="url(#gNon)"
              />
              <Line
                type="monotone"
                dataKey="needsReview"
                name="Needs review"
                stroke={CHART_COLORS.amber}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Top recurring violations"
          subtitle="Detections in the last 12 months"
          question="Which labelling failures should the next enforcement drive target?"
          height={280}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={violations}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              barSize={14}
            >
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_PROPS} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fontSize: 10, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F1F5F9' }} />
              <Bar dataKey="count" name="Detections" radius={[0, 3, 3, 0]}>
                {violations.map((v) => (
                  <Cell
                    key={v.code}
                    fill={
                      v.severity === 'HIGH'
                        ? CHART_COLORS.red
                        : v.severity === 'MEDIUM'
                          ? CHART_COLORS.amber
                          : CHART_COLORS.brand
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <ChartCard
          title="Compliance by product category"
          subtitle="Share of packages clearing screening"
          question="Which commodity categories need closer supervision?"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categories} margin={{ top: 8, right: 8, left: -20, bottom: 26 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="name"
                {...AXIS_PROPS}
                interval={0}
                angle={-22}
                textAnchor="end"
                height={54}
                tick={{ fontSize: 9, fill: '#64748B' }}
              />
              <YAxis {...AXIS_PROPS} width={44} unit="%" />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: '#F1F5F9' }} />
              <Bar dataKey="complianceRate" name="Compliance rate" radius={[3, 3, 0, 0]}>
                {categories.map((c) => (
                  <Cell
                    key={c.name}
                    fill={
                      c.complianceRate >= 70
                        ? CHART_COLORS.green
                        : c.complianceRate >= 60
                          ? CHART_COLORS.amber
                          : CHART_COLORS.red
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Inspections by region"
          subtitle="Field activity across jurisdictions"
          question="Is inspection coverage evenly distributed?"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regions} margin={{ top: 8, right: 8, left: -20, bottom: 26 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="region"
                {...AXIS_PROPS}
                interval={0}
                angle={-22}
                textAnchor="end"
                height={54}
                tick={{ fontSize: 9, fill: '#64748B' }}
              />
              <YAxis {...AXIS_PROPS} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F1F5F9' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inspections" name="Inspections" fill={CHART_COLORS.navy} radius={[3, 3, 0, 0]} />
              <Bar dataKey="violations" name="Violations" fill={CHART_COLORS.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Violations by category"
          subtitle="Detections mapped to rule category"
          question="Are failures concentrated in declarations or in print quality?"
          className="lg:col-span-2 2xl:col-span-1"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="period" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="inspections"
                name="Inspections"
                stroke={CHART_COLORS.navy}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="complianceRate"
                name="Compliance rate %"
                stroke={CHART_COLORS.accent}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Recent inspections */}
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Recent Inspections</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Latest field records captured through the AI screening workspace
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            icon={<ArrowRight size={13} />}
            onClick={() => navigate('/app/inspections')}
          >
            View all
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={inspections.slice(0, 8)}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/app/inspections/${r.id}`)}
          pageSize={8}
        />
      </section>
    </div>
  );
}
