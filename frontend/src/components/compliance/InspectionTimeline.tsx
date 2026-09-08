import { History } from 'lucide-react';
import type { AuditLogEntry } from '@shared/types';
import { cn } from '@/lib/utils';
import { formatTime, relativeTime } from '@shared/lib/format';

export function InspectionTimeline({
  entries,
  className,
}: {
  entries: AuditLogEntry[];
  className?: string;
}) {
  const ordered = [...entries].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  return (
    <div className={cn('surface overflow-hidden', className)}>
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <History size={15} className="text-brand-700" />
        <h2 className="text-sm font-bold tracking-tight text-slate-900">Audit Trail</h2>
        <span className="ml-auto text-2xs text-slate-400">Tamper-evident activity log</span>
      </div>
      <ol className="relative px-4 py-4">
        <span className="absolute left-[27px] top-6 bottom-6 w-px bg-slate-200" aria-hidden />
        {ordered.map((entry, i) => (
          <li key={entry.id} className={cn('relative flex gap-3', i > 0 && 'mt-4')}>
            <span
              className={cn(
                'z-10 mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 border-white ring-1',
                i === ordered.length - 1 ? 'bg-brand-600 ring-brand-300' : 'bg-slate-300 ring-slate-200',
              )}
            />
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-xs font-semibold text-slate-800">{entry.action}</p>
                <span className="font-mono text-2xs text-slate-400">{formatTime(entry.at)}</span>
                <span className="text-2xs text-slate-400">· {relativeTime(entry.at)}</span>
              </div>
              <p className="mt-0.5 text-2xs text-slate-500">
                {entry.actor}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
