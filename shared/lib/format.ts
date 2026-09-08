import type { ComplianceStatus, RuleStatus, Severity, UserRole } from '@shared/types';

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

/**
 * Pulls the numeric price out of a declared MRP string.
 * Handles "MRP Rs. 650.00 (incl. of all taxes)", "Rs 185/-", "₹1,250".
 */
export function parseMrp(declared?: string | null): number {
  if (!declared) return 0;
  const match = declared.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export const STATUS_LABEL: Record<ComplianceStatus, string> = {
  COMPLIANT: 'Compliant',
  NON_COMPLIANT: 'Potential Non-Compliance',
  NEEDS_REVIEW: 'Needs Manual Review',
  NOT_DETECTED: 'Not Detected',
};

export const STATUS_SHORT: Record<ComplianceStatus, string> = {
  COMPLIANT: 'Compliant',
  NON_COMPLIANT: 'Non-Compliant',
  NEEDS_REVIEW: 'Needs Review',
  NOT_DETECTED: 'Not Detected',
};

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  PASS: 'Compliant',
  FAIL: 'Non-Compliant',
  REVIEW: 'Needs Review',
  NOT_APPLICABLE: 'Not Applicable',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  SUPERVISOR: 'Supervisor',
  INSPECTOR: 'Inspector',
};

export function scoreBand(score: number): ComplianceStatus {
  if (score >= 90) return 'COMPLIANT';
  if (score >= 70) return 'NEEDS_REVIEW';
  return 'NON_COMPLIANT';
}

export function scoreTone(score: number) {
  if (score >= 90) return 'emerald';
  if (score >= 70) return 'amber';
  return 'red';
}
