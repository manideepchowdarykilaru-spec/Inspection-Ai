import { Fragment, useState } from 'react';
import { BookOpen, ChevronDown, Crosshair } from 'lucide-react';
import type { RuleCategory, RuleResult } from '@shared/types';
import { cn } from '@/lib/utils';
import { ConfidencePill, RuleStatusBadge } from '@/components/ui/Badge';

const CATEGORY_ORDER: RuleCategory[] = [
  'Mandatory Declaration',
  'Formatting',
  'Readability',
  'Packaging Information',
  'Import Compliance',
];

export function RuleValidationTable({
  results,
  onLocate,
  activeRegionId,
  className,
}: {
  results: RuleResult[];
  onLocate?: (regionId: string) => void;
  activeRegionId?: string | null;
  className?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    rows: results.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className={cn('surface overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Rule Validation</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {results.length} configured rules evaluated against the extracted declarations
          </p>
        </div>
        <div className="flex items-center gap-3 text-2xs font-medium text-slate-500">
          <span>{results.filter((r) => r.status === 'PASS').length} compliant</span>
          <span className="text-amber-700">{results.filter((r) => r.status === 'REVIEW').length} review</span>
          <span className="text-red-700">{results.filter((r) => r.status === 'FAIL').length} failed</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-2xs font-bold uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-2 text-left">Rule</th>
              <th scope="col" className="px-4 py-2 text-left">Detected value</th>
              <th scope="col" className="hidden px-4 py-2 text-left xl:table-cell">Requirement</th>
              <th scope="col" className="px-4 py-2 text-left">Status</th>
              <th scope="col" className="px-4 py-2 text-left">Confidence</th>
              <th scope="col" className="w-8 px-2 py-2" aria-label="Details" />
            </tr>
          </thead>
          {grouped.map((group) => (
            <tbody key={group.category}>
              <tr>
                <td colSpan={6} className="bg-navy-50/60 px-4 py-1.5 text-2xs font-bold uppercase tracking-wider text-navy-800">
                  {group.category}
                </td>
              </tr>
              {group.rows.map((r) => {
                const isOpen = expanded === r.ruleId;
                return (
                  <Fragment key={r.ruleId}>
                    <tr

                      className={cn(
                        'border-b border-slate-100 transition-colors',
                        isOpen ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                      )}
                    >
                      <td className="px-4 py-2.5 align-top">
                        <p className="font-medium leading-snug text-slate-900">{r.ruleName}</p>
                        <p className="mt-0.5 font-mono text-2xs text-slate-400">{r.ruleId}</p>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={cn(
                            'break-words text-xs',
                            r.status === 'FAIL' ? 'italic text-red-700' : 'text-slate-700',
                          )}
                        >
                          {r.detectedValue ?? '—'}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 align-top text-xs text-slate-500 xl:table-cell">
                        {r.expectation}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <RuleStatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <ConfidencePill value={r.confidence} />
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.ruleId)}
                          aria-expanded={isOpen}
                          aria-label={`Why was ${r.ruleName} flagged`}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                        >
                          <ChevronDown size={14} className={cn('transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.ruleId}-detail`} className="border-b border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                          <div className="rounded-md border border-slate-200 bg-white p-3">
                            <p className="label-text mb-1">Why this result</p>
                            <p className="text-xs leading-relaxed text-slate-700">{r.explanation}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-2xs text-slate-500">
                              <span className="inline-flex items-center gap-1.5">
                                <BookOpen size={12} /> {r.legalReference}
                              </span>
                              <span className="xl:hidden">
                                <strong className="font-semibold text-slate-600">Requirement:</strong> {r.expectation}
                              </span>
                              {r.evidenceRegion && onLocate && (
                                <button
                                  type="button"
                                  onClick={() => onLocate(r.evidenceRegion!.id)}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold transition-colors',
                                    activeRegionId === r.evidenceRegion.id
                                      ? 'border-brand-300 bg-brand-50 text-brand-800'
                                      : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                                  )}
                                >
                                  <Crosshair size={11} /> Show on label
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
