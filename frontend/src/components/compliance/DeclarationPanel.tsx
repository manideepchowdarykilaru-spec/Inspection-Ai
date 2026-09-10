import { useState } from 'react';
import { ChevronRight, Crosshair, FileText, ScanText } from 'lucide-react';
import type { Declaration } from '@shared/types';
import { cn } from '@/lib/utils';
import { ConfidencePill } from '@/components/ui/Badge';

/**
 * Structured OCR output. Every detected declaration is clickable and drives the
 * image annotation overlay, which is what makes the extraction auditable.
 */
export function DeclarationPanel({
  declarations,
  activeRegionId,
  onSelect,
  rawText,
  className,
}: {
  declarations: Declaration[];
  activeRegionId?: string | null;
  onSelect?: (regionId: string | null) => void;
  rawText?: string;
  className?: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const detected = declarations.filter((d) => d.detectedValue);
  const notApplicable = declarations.filter((d) => !d.detectedValue && d.notApplicable);
  const missing = declarations.filter((d) => !d.detectedValue && !d.notApplicable);
  const applicable = declarations.length - notApplicable.length;

  return (
    <div className={cn('surface flex flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <ScanText size={15} className="text-brand-700" />
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Detected Declarations</h2>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-semibold text-slate-600">
          {detected.length} / {applicable}{notApplicable.length > 0 ? ' applicable' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {detected.map((d) => {
          const isActive = activeRegionId && d.region?.id === activeRegionId;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelect?.(isActive ? null : d.region?.id ?? null)}
              className={cn(
                'group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors',
                isActive ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="label-text">{d.label}</p>
                <p className="mt-0.5 break-words text-sm font-medium leading-snug text-slate-900">
                  {d.detectedValue}
                </p>
                {d.readability && (
                  <p className="mt-1 font-mono text-2xs text-slate-400">
                    {d.readability.scaleKnown
                      ? `~${d.readability.estimatedMm} mm · ${d.readability.estimatedFontPt} pt`
                      : `${d.readability.textHeightPx} px tall · no scale reference`}
                    {' · contrast '}
                    {d.readability.contrastRatio.toFixed(1)}:1
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <ConfidencePill value={d.confidence} />
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 text-2xs font-medium',
                    isActive ? 'text-brand-700' : 'text-slate-400 group-hover:text-brand-700',
                  )}
                >
                  <Crosshair size={10} />
                  {isActive ? 'Shown' : 'Locate'}
                </span>
              </div>
            </button>
          );
        })}

        {notApplicable.length > 0 && (
          <div className="border-b border-slate-100 bg-emerald-50/40 px-4 py-3">
            <p className="label-text mb-2">Not applicable to this package</p>
            {notApplicable.map((d) => (
              <p key={d.key} className="text-xs text-slate-700">
                <span className="font-semibold">{d.label}</span>
                <span className="text-slate-500"> — {d.notApplicable}</span>
              </p>
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <div className="bg-slate-50/70 px-4 py-3">
            <p className="label-text mb-2">Not detected on scanned panel</p>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((d) => (
                <span
                  key={d.key}
                  className="inline-flex items-center rounded border border-dashed border-slate-300 bg-white px-2 py-1 text-2xs font-medium text-slate-500"
                >
                  {d.label}
                </span>
              ))}
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-slate-400">
              Absence on this panel is not conclusive — capture the remaining panels before recording a
              determination.
            </p>
          </div>
        )}
      </div>

      {rawText && (
        <div className="border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowRaw((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <span className="inline-flex items-center gap-1.5">
              <FileText size={13} /> Raw OCR text
            </span>
            <ChevronRight size={14} className={cn('transition-transform', showRaw && 'rotate-90')} />
          </button>
          {showRaw && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-900 px-4 py-3 font-mono text-2xs leading-relaxed text-slate-200">
              {rawText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
