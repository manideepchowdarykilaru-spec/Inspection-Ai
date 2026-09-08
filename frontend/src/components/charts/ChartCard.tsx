import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Palette shared by every chart so the analytics surface reads as one system. */
export const CHART_COLORS = {
  navy: '#0B2545',
  brand: '#2563EB',
  accent: '#0EA5E9',
  green: '#059669',
  amber: '#D97706',
  red: '#B91C1C',
  slate: '#94A3B8',
  violet: '#7C3AED',
};

export const SERIES = [
  CHART_COLORS.brand,
  CHART_COLORS.green,
  CHART_COLORS.amber,
  CHART_COLORS.red,
  CHART_COLORS.violet,
  CHART_COLORS.accent,
];

export function ChartCard({
  title,
  subtitle,
  question,
  actions,
  children,
  className,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  /** The enforcement question the chart answers — shown as a caption. */
  question?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <section className={cn('surface flex flex-col overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="min-w-0 p-3 pr-4" style={{ height, minHeight: height }}>
        {children}
      </div>
      {question && (
        <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-2xs text-slate-500">{question}</p>
      )}
    </section>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey?: string }[];
  label?: string;
  formatter?: (value: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-elevated">
      {label && <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-slate-500">{label}</p>}
      <div className="space-y-0.5">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-sm" style={{ background: entry.color }} />
            <span className="text-slate-600">{entry.name}</span>
            <span className="ml-auto font-mono font-semibold text-slate-900">
              {formatter ? formatter(entry.value, entry.name) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: '#64748B' },
  tickLine: false,
  axisLine: { stroke: '#E2E8F0' },
};

export const GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: '#E2E8F0',
  vertical: false,
};
