import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Lightbulb, Minus } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { KpiCard } from '@/components/ui/KpiCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { AXIS_PROPS, ChartCard, ChartTooltip, CHART_COLORS, GRID_PROPS } from '@/components/charts/ChartCard';
import {
  categoryStats,
  dashboardMetrics,
  insights,
  RANGE_LABEL,
  regionStats,
  repeatOffenders,
  severityDistribution,
  trend,
  violationStats,
  type DateRange,
} from '@/services/analyticsService';
import { formatNumber } from '@shared/lib/format';
import { cn } from '@/lib/utils';

const RANGES: DateRange[] = ['1D', '7D', '30D', '3M', '6M', '12M'];

const TONE_ICON = {
  positive: ArrowDownRight,
  negative: ArrowUpRight,
  neutral: Minus,
};

const TONE_STYLE = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  negative: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
};

export default function Analytics() {
  const [range, setRange] = useState<DateRange>('6M');

  const metrics = useDatabase(() => dashboardMetrics(), []);
  const trendData = trend(range);
  const violations = violationStats(range);
  const categories = categoryStats();
  const regions = regionStats();
  const severity = useDatabase(() => severityDistribution(), []);
  const offenders = repeatOffenders();
  const generatedInsights = insights(range);

  const rangeSelector = (
    <div className="flex flex-wrap overflow-hidden rounded-md border border-slate-300 bg-white" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRange(r)}
          className={cn(
            'px-2.5 py-1.5 text-2xs font-semibold transition-colors',
            range === r ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50',
          )}
          aria-pressed={range === r}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );

  usePageChrome(
    {
      title: 'Enforcement Analytics',
      subtitle: 'Departmental compliance performance and violation patterns',
      actions: <div className="hidden md:block">{rangeSelector}</div>,
    },
    [range],
  );

  const severityColors = [CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.brand];

  return (
    <div className="space-y-4">
      {/* On phones the selector lives in the page so the title stays readable. */}
      <div className="flex items-center justify-between gap-3 md:hidden">
        <span className="label-text">Period</span>
        {rangeSelector}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Inspections in period"
          value={formatNumber(trendData.reduce((s, t) => s + t.inspections, 0))}
          tone="navy"
          delta={metrics.deltas.totalInspections}
          sublabel={RANGE_LABEL[range]}
        />
        <KpiCard
          label="Compliance rate"
          value={`${metrics.complianceRate}%`}
          tone="green"
          delta={metrics.deltas.complianceRate}
          progress={metrics.complianceRate}
        />
        <KpiCard
          label="Findings detected"
          value={formatNumber(violations.reduce((s, v) => s + v.count, 0))}
          tone="amber"
          delta={metrics.deltas.violationsDetected}
        />
        <KpiCard
          label="Repeat offenders"
          value={offenders.length}
          tone="red"
          sublabel="entities flagged more than once"
        />
      </div>

      {/* Insights */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb size={15} className="text-amber-600" />
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Generated insights</h2>
          <span className="text-2xs text-slate-400">derived from period-over-period comparison</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {generatedInsights.slice(0, 4).map((insight) => {
            const Icon = TONE_ICON[insight.tone];
            return (
              <article key={insight.id} className={cn('rounded-lg border p-3.5', TONE_STYLE[insight.tone])}>
                <div className="flex items-start gap-2.5">
                  <Icon size={15} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold leading-snug">{insight.headline}</h3>
                    <p className="mt-1 text-2xs leading-relaxed opacity-90">{insight.detail}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <ChartCard
          title="Monthly inspections and compliance"
          subtitle={`Activity over ${RANGE_LABEL[range].toLowerCase()}`}
          question="Is inspection throughput keeping pace with compliance improvement?"
          height={300}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="period" {...AXIS_PROPS} />
              <YAxis yAxisId="left" {...AXIS_PROPS} width={44} />
              <YAxis yAxisId="right" orientation="right" {...AXIS_PROPS} width={44} unit="%" domain={[40, 80]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar yAxisId="left" dataKey="compliant" name="Compliant" stackId="a" fill={CHART_COLORS.green} radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="needsReview" name="Needs review" stackId="a" fill={CHART_COLORS.amber} />
              <Bar yAxisId="left" dataKey="nonCompliant" name="Non-compliant" stackId="a" fill={CHART_COLORS.red} radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="complianceRate"
                name="Compliance rate %"
                stroke={CHART_COLORS.navy}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Violation severity distribution"
          subtitle="Departmental caseload"
          question="What proportion of findings demands priority action?"
          height={300}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={severity} dataKey="value" nameKey="name" innerRadius={56} outerRadius={92} paddingAngle={2} stroke="none">
                {severity.map((entry, i) => (
                  <Cell key={entry.key} fill={severityColors[i]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Violation frequency by rule"
          subtitle="Current period against the preceding one"
          question="Which labelling failures are rising fastest?"
          height={340}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={violations} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }} barSize={11}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_PROPS} />
              <YAxis
                type="category"
                dataKey="name"
                width={160}
                tick={{ fontSize: 9.5, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F1F5F9' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="previousCount" name="Previous period" fill={CHART_COLORS.slate} radius={[0, 2, 2, 0]} />
              <Bar dataKey="count" name="Current period" fill={CHART_COLORS.navy} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Top violating categories"
          subtitle="Compliance rate by commodity category"
          question="Where should the next enforcement drive be targeted?"
          height={340}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categories} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }} barSize={13}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
              <XAxis type="number" {...AXIS_PROPS} unit="%" domain={[0, 100]} />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 9.5, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: '#F1F5F9' }} />
              <Bar dataKey="complianceRate" name="Compliance rate" radius={[0, 3, 3, 0]}>
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
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <ChartCard
          title="Regional comparison"
          subtitle="Inspections, violations and compliance rate by jurisdiction"
          question="Which districts need additional enforcement capacity?"
          height={300}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={regions} margin={{ top: 8, right: 8, left: -18, bottom: 30 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="region"
                {...AXIS_PROPS}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={56}
                tick={{ fontSize: 9, fill: '#64748B' }}
              />
              <YAxis yAxisId="left" {...AXIS_PROPS} width={44} />
              <YAxis yAxisId="right" orientation="right" {...AXIS_PROPS} width={40} unit="%" domain={[50, 80]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="inspections" name="Inspections" fill={CHART_COLORS.navy} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="violations" name="Violations" fill={CHART_COLORS.amber} radius={[3, 3, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="complianceRate"
                name="Compliance %"
                stroke={CHART_COLORS.green}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="overflow-hidden">
          <CardHeader
            title="Repeat offenders"
            subtitle="Entities flagged across multiple inspections"
            dense
          />
          <CardBody className="space-y-2 p-3">
            {offenders.map((o, i) => (
              <div
                key={o.entity}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-2xs font-bold text-red-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-900">{o.entity}</p>
                  <p className="text-2xs text-slate-500">
                    {o.inspections} inspections · last flagged {o.lastFlagged}
                  </p>
                </div>
                <Badge tone="red" size="sm">
                  {o.violations} findings
                </Badge>
              </div>
            ))}
            <p className="pt-1 text-2xs leading-relaxed text-slate-500">
              Repeat detection is an indicator for prioritising verification. It does not by itself establish
              contravention.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
