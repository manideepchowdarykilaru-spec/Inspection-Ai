import { useState } from 'react';
import {
  BookOpen,
  Check,
  Crosshair,
  MessageSquarePlus,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { Violation } from '@shared/types';
import { cn } from '@/lib/utils';
import { ConfidencePill, SeverityBadge, ViolationStateBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Form';

const ACCENT = {
  HIGH: 'border-l-red-600',
  MEDIUM: 'border-l-amber-500',
  LOW: 'border-l-brand-500',
} as const;

export function ViolationCard({
  violation,
  index,
  onLocate,
  onVerify,
  onDismiss,
  onNote,
  canAct = true,
  active,
}: {
  violation: Violation;
  index: number;
  onLocate?: (regionId: string) => void;
  onVerify?: () => void;
  onDismiss?: () => void;
  onNote?: (note: string) => void;
  canAct?: boolean;
  active?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(violation.officerNote ?? '');

  return (
    <article
      className={cn(
        'surface border-l-4 transition-shadow',
        ACCENT[violation.severity],
        active && 'ring-2 ring-brand-500/40',
        violation.state === 'DISMISSED' && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
            {index}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold leading-snug text-slate-900">{violation.title}</h3>
            <p className="mt-0.5 font-mono text-2xs text-slate-400">
              {violation.ruleId} · {violation.category}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={violation.severity} />
          <ViolationStateBadge state={violation.state} />
        </div>
      </div>

      <dl className="space-y-2 border-t border-slate-100 px-4 py-3 text-xs">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-slate-500">Detected</dt>
          <dd className="min-w-0 flex-1 break-words text-slate-800">{violation.detected}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-slate-500">Why flagged</dt>
          <dd className="min-w-0 flex-1 leading-relaxed text-slate-700">{violation.explanation}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-slate-500">Verification</dt>
          <dd className="min-w-0 flex-1 leading-relaxed text-slate-700">{violation.recommendedAction}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
          <span className="inline-flex items-center gap-1.5 text-2xs text-slate-500">
            <BookOpen size={12} /> {violation.legalReference}
          </span>
          <span className="inline-flex items-center gap-1.5 text-2xs text-slate-500">
            <ShieldAlert size={12} /> Model confidence
            <ConfidencePill value={violation.confidence} />
          </span>
          {violation.evidenceRegion && (
            <span className="text-2xs text-slate-500">Evidence region: {violation.evidenceRegion.label}</span>
          )}
        </div>
        {violation.officerNote && (
          <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <p className="label-text mb-0.5">Officer note</p>
            <p className="text-xs leading-relaxed text-slate-700">{violation.officerNote}</p>
            {violation.verifiedBy && (
              <p className="mt-1 text-2xs text-slate-400">Recorded by {violation.verifiedBy}</p>
            )}
          </div>
        )}
      </dl>

      {noteOpen && (
        <div className="border-t border-slate-100 px-4 py-3">
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Record what was observed on physical verification…"
            aria-label="Officer note"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onNote?.(note);
                setNoteOpen(false);
              }}
              disabled={!note.trim()}
            >
              Save note
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
        {violation.evidenceRegion && onLocate && (
          <Button
            size="sm"
            variant="outline"
            icon={<Crosshair size={13} />}
            onClick={() => onLocate(violation.evidenceRegion!.id)}
          >
            Show on label
          </Button>
        )}
        {canAct && (
          <>
            <Button
              size="sm"
              variant={violation.state === 'VERIFIED' ? 'success' : 'outline'}
              icon={<Check size={13} />}
              onClick={onVerify}
            >
              {violation.state === 'VERIFIED' ? 'Verified' : 'Mark verified'}
            </Button>
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={onDismiss}>
              Dismiss
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<MessageSquarePlus size={13} />}
              onClick={() => setNoteOpen((o) => !o)}
              className="ml-auto"
            >
              {violation.officerNote ? 'Edit note' : 'Add note'}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
