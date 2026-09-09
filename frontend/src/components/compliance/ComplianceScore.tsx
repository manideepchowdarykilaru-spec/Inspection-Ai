import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ComplianceStatus, ScoreBreakdown } from '@shared/types';
import { cn } from '@/lib/utils';
import { STATUS_LABEL } from '@shared/lib/format';

const TONE: Record<ComplianceStatus, { ring: string; text: string; chip: string; track: string }> = {
  COMPLIANT: { ring: 'stroke-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', track: 'bg-emerald-500' },
  NEEDS_REVIEW: { ring: 'stroke-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-900 border-amber-200', track: 'bg-amber-500' },
  NON_COMPLIANT: { ring: 'stroke-red-600', text: 'text-red-700', chip: 'bg-red-50 text-red-800 border-red-200', track: 'bg-red-600' },
  NOT_DETECTED: { ring: 'stroke-slate-400', text: 'text-slate-600', chip: 'bg-slate-100 text-slate-700 border-slate-200', track: 'bg-slate-400' },
};

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const frame = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // ease-out cubic
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    // Animation frames do not run in a background tab; the number must still land.
    const settle = window.setTimeout(() => setValue(target), duration + 100);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.clearTimeout(settle);
    };
  }, [target, duration]);

  return value;
}

export function ComplianceScoreCard({
  score,
  status,
  breakdown,
  compact,
  className,
}: {
  score: number;
  status: ComplianceStatus;
  breakdown: ScoreBreakdown;
  compact?: boolean;
  className?: string;
}) {
  const animated = useCountUp(score);
  const tone = TONE[status];
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animated / 100) * circumference;

  const rows = [
    { label: 'Mandatory declarations', ...breakdown.mandatoryDeclarations },
    { label: 'Formatting', ...breakdown.formatting },
    { label: 'Readability', ...breakdown.readability },
    { label: 'Packaging information', ...breakdown.packagingInformation },
  ];

  return (
    <div className={cn('surface overflow-hidden', className)}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-navy-900 px-4 py-2.5 text-white">
        <ShieldCheck size={15} className="text-accent-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider">AI Screening Score</h2>
      </div>

      <div className={cn('flex items-center gap-5 p-5', compact && 'p-4')}>
        <div className="relative shrink-0">
          <svg width="124" height="124" viewBox="0 0 124 124" className="-rotate-90">
            <circle cx="62" cy="62" r={radius} fill="none" strokeWidth="9" className="stroke-slate-100" />
            <circle
              cx="62"
              cy="62"
              r={radius}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={cn('transition-[stroke-dashoffset] duration-300 ease-out', tone.ring)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn('text-3xl font-extrabold tabular-nums leading-none', tone.text)}>{animated}</span>
            <span className="mt-0.5 text-2xs font-semibold uppercase tracking-wider text-slate-400">/ 100</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="label-text">Final screening status</p>
          <p className={cn('mt-1 inline-flex rounded-md border px-2.5 py-1 text-sm font-bold', tone.chip)}>
            {STATUS_LABEL[status]}
          </p>
          <div className="mt-4 space-y-2.5">
            {rows.map((row) => (
              <div key={row.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-mono font-semibold text-slate-800 tabular-nums">
                    {row.score}/{row.max}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700 ease-out', tone.track)}
                    style={{ width: `${(row.score / row.max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-2xs leading-relaxed text-slate-500">
        The screening score is an AI-generated indicator to prioritise verification. It is not an official
        legal determination.
      </p>
    </div>
  );
}
