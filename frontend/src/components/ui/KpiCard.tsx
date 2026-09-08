import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'navy' | 'green' | 'red' | 'amber' | 'blue' | 'slate';

const TONE_STYLE: Record<Tone, { icon: string; value: string; bar: string }> = {
  navy: { icon: 'bg-navy-50 text-navy-800', value: 'text-navy-900', bar: 'bg-navy-800' },
  green: { icon: 'bg-emerald-50 text-emerald-700', value: 'text-emerald-800', bar: 'bg-emerald-600' },
  red: { icon: 'bg-red-50 text-red-700', value: 'text-red-800', bar: 'bg-red-600' },
  amber: { icon: 'bg-amber-50 text-amber-700', value: 'text-amber-800', bar: 'bg-amber-500' },
  blue: { icon: 'bg-brand-50 text-brand-700', value: 'text-brand-800', bar: 'bg-brand-600' },
  slate: { icon: 'bg-slate-100 text-slate-600', value: 'text-slate-800', bar: 'bg-slate-400' },
};

export function KpiCard({
  label,
  value,
  sublabel,
  icon,
  tone = 'navy',
  delta,
  progress,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string;
  icon?: ReactNode;
  tone?: Tone;
  delta?: number;
  progress?: number;
  onClick?: () => void;
}) {
  const style = TONE_STYLE[tone];
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'surface group relative overflow-hidden p-4 text-left transition-all',
        onClick && 'cursor-pointer hover:border-slate-300 hover:shadow-elevated',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-text truncate">{label}</p>
          <p className={cn('mt-2 text-2xl font-extrabold tracking-tight tabular-nums', style.value)}>{value}</p>
        </div>
        {icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', style.icon)}>
            {icon}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        {typeof delta === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-bold',
              delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
            )}
          >
            {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        )}
        {sublabel && <span className="truncate text-2xs text-slate-500">{sublabel}</span>}
      </div>

      {typeof progress === 'number' && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all duration-1000 ease-out', style.bar)}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </Wrapper>
  );
}
