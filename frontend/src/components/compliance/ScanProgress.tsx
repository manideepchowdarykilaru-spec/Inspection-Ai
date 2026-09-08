import { Check, Loader2 } from 'lucide-react';
import type { StageId } from '@/services/complianceService';
import { PIPELINE_STAGES } from '@/services/complianceService';
import { cn } from '@/lib/utils';

export function ScanProgress({
  completed,
  current,
  className,
  compact,
}: {
  completed: StageId[];
  current: StageId | null;
  className?: string;
  compact?: boolean;
}) {
  const done = new Set(completed);
  const percent = Math.round((done.size / PIPELINE_STAGES.length) * 100);

  return (
    <div className={cn('surface overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Compliance Analysis Pipeline</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {current ? 'Processing on-device inference stages…' : 'All stages completed'}
          </p>
        </div>
        <span className="font-mono text-lg font-bold tabular-nums text-navy-900">{percent}%</span>
      </div>

      <div className="h-1 w-full bg-slate-100">
        <div
          className="h-full bg-gradient-to-r from-brand-600 to-accent-500 transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className={cn('divide-y divide-slate-100', compact && 'text-xs')}>
        {PIPELINE_STAGES.map((stage) => {
          const isDone = done.has(stage.id);
          const isCurrent = current === stage.id;
          return (
            <li
              key={stage.id}
              className={cn(
                'flex items-center gap-3 px-4 transition-colors',
                compact ? 'py-2' : 'py-2.5',
                isCurrent && 'bg-brand-50/60',
              )}
            >
              <span
                className={cn(
                  'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  isDone
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : isCurrent
                      ? 'border-brand-600 bg-white text-brand-700'
                      : 'border-slate-300 bg-white text-slate-300',
                )}
              >
                {isDone ? (
                  <Check size={12} strokeWidth={3} />
                ) : isCurrent ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                )}
                {isCurrent && (
                  <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brand-500" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate font-medium',
                    compact ? 'text-xs' : 'text-sm',
                    isDone ? 'text-slate-800' : isCurrent ? 'text-brand-900' : 'text-slate-400',
                  )}
                >
                  {stage.label}
                </p>
                {!compact && (
                  <p className={cn('truncate text-2xs', isCurrent ? 'text-brand-700' : 'text-slate-400')}>
                    {stage.detail}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 font-mono text-2xs',
                  isDone ? 'text-emerald-700' : isCurrent ? 'text-brand-700' : 'text-slate-300',
                )}
              >
                {isDone ? 'done' : isCurrent ? 'running' : 'queued'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
