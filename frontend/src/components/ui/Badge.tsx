import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  HelpCircle,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import type { ComplianceStatus, InspectionStage, RuleStatus, Severity, ViolationState } from '@shared/types';
import { cn } from '@/lib/utils';
import { RULE_STATUS_LABEL, SEVERITY_LABEL, STATUS_SHORT } from '@shared/lib/format';

type Tone = 'green' | 'red' | 'amber' | 'slate' | 'blue' | 'violet';

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-brand-50 text-brand-800 border-brand-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
};

export function Badge({
  children,
  tone = 'slate',
  icon,
  className,
  size = 'md',
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<ComplianceStatus, Tone> = {
  COMPLIANT: 'green',
  NON_COMPLIANT: 'red',
  NEEDS_REVIEW: 'amber',
  NOT_DETECTED: 'slate',
};

const STATUS_ICON: Record<ComplianceStatus, typeof CheckCircle2> = {
  COMPLIANT: CheckCircle2,
  NON_COMPLIANT: XCircle,
  NEEDS_REVIEW: AlertTriangle,
  NOT_DETECTED: HelpCircle,
};

export function StatusBadge({
  status,
  size = 'md',
  showIcon = true,
}: {
  status: ComplianceStatus;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge tone={STATUS_TONE[status]} size={size} icon={showIcon ? <Icon size={size === 'sm' ? 11 : 13} /> : undefined}>
      {STATUS_SHORT[status]}
    </Badge>
  );
}

const RULE_TONE: Record<RuleStatus, Tone> = {
  PASS: 'green',
  FAIL: 'red',
  REVIEW: 'amber',
  NOT_APPLICABLE: 'slate',
};

const RULE_ICON: Record<RuleStatus, typeof CheckCircle2> = {
  PASS: CheckCircle2,
  FAIL: XCircle,
  REVIEW: AlertTriangle,
  NOT_APPLICABLE: MinusCircle,
};

export function RuleStatusBadge({ status, size = 'sm' }: { status: RuleStatus; size?: 'sm' | 'md' }) {
  const Icon = RULE_ICON[status];
  return (
    <Badge tone={RULE_TONE[status]} size={size} icon={<Icon size={size === 'sm' ? 11 : 13} />}>
      {RULE_STATUS_LABEL[status]}
    </Badge>
  );
}

const SEVERITY_TONE: Record<Severity, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'blue' };

export function SeverityBadge({ severity, size = 'sm' }: { severity: Severity; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} size={size}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          severity === 'HIGH' ? 'bg-red-600' : severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-brand-600',
        )}
      />
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

const STAGE_LABEL: Record<InspectionStage, string> = {
  DRAFT: 'Draft',
  SCANNING: 'Scanning',
  AI_COMPLETE: 'AI Screening Complete',
  UNDER_REVIEW: 'Under Officer Review',
  CLOSED: 'Closed',
};

const STAGE_TONE: Record<InspectionStage, Tone> = {
  DRAFT: 'slate',
  SCANNING: 'blue',
  AI_COMPLETE: 'blue',
  UNDER_REVIEW: 'violet',
  CLOSED: 'slate',
};

export function StageBadge({ stage }: { stage: InspectionStage }) {
  return (
    <Badge tone={STAGE_TONE[stage]} size="sm">
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

const VIOLATION_STATE_TONE: Record<ViolationState, Tone> = {
  OPEN: 'amber',
  VERIFIED: 'red',
  DISMISSED: 'slate',
};

const VIOLATION_STATE_LABEL: Record<ViolationState, string> = {
  OPEN: 'Open',
  VERIFIED: 'Verified by officer',
  DISMISSED: 'Dismissed',
};

export function ViolationStateBadge({ state }: { state: ViolationState }) {
  return (
    <Badge tone={VIOLATION_STATE_TONE[state]} size="sm" icon={state === 'DISMISSED' ? <CircleSlash size={11} /> : undefined}>
      {VIOLATION_STATE_LABEL[state]}
    </Badge>
  );
}

export function ConfidencePill({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 90 ? 'green' : pct >= 75 ? 'amber' : 'red';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-2xs font-semibold',
        TONES[tone as Tone],
        className,
      )}
      title={`Model confidence: ${pct}%`}
    >
      <span className="h-1 w-6 overflow-hidden rounded-full bg-white/70">
        <span
          className={cn(
            'block h-full rounded-full',
            pct >= 90 ? 'bg-emerald-600' : pct >= 75 ? 'bg-amber-500' : 'bg-red-600',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      {pct}%
    </span>
  );
}
