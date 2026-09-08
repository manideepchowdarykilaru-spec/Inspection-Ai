import type { AnalyticsInsight, DashboardMetrics, TrendPoint } from '@shared/types';
import {
  ANALYTICS_INSIGHTS,
  CATEGORY_COMPLIANCE,
  MONTHLY_TREND,
  REGION_STATS,
  REPEAT_OFFENDERS,
  VIOLATION_STATS,
} from '@shared/data/mockData';
import { getDb } from './storage';

export type DateRange = '1D' | '7D' | '30D' | '3M' | '6M' | '12M';

export const RANGE_LABEL: Record<DateRange, string> = {
  '1D': 'Today',
  '7D': '7 days',
  '30D': '30 days',
  '3M': '3 months',
  '6M': '6 months',
  '12M': '12 months',
};

const RANGE_MONTHS: Record<DateRange, number> = {
  '1D': 1,
  '7D': 1,
  '30D': 2,
  '3M': 3,
  '6M': 6,
  '12M': 12,
};

/**
 * Department-wide metrics.
 *
 * The seeded live corpus (28 inspections) is layered on top of the historical
 * aggregate so the dashboard reflects both the demo activity and a plausible
 * departmental baseline.
 */
const HISTORICAL_BASELINE = {
  totalInspections: 1220,
  compliant: 824,
  nonCompliant: 285,
  needsReview: 111,
  violationsDetected: 512,
};

export function dashboardMetrics(): DashboardMetrics {
  const { inspections } = getDb();
  const live = {
    total: inspections.length,
    compliant: inspections.filter((i) => i.status === 'COMPLIANT').length,
    nonCompliant: inspections.filter((i) => i.status === 'NON_COMPLIANT').length,
    needsReview: inspections.filter((i) => i.status === 'NEEDS_REVIEW').length,
    violations: inspections.reduce((sum, i) => sum + i.violations.length, 0),
  };

  const totalInspections = HISTORICAL_BASELINE.totalInspections + live.total;
  const compliant = HISTORICAL_BASELINE.compliant + live.compliant;
  const nonCompliant = HISTORICAL_BASELINE.nonCompliant + live.nonCompliant;
  const needsReview = HISTORICAL_BASELINE.needsReview + live.needsReview;
  const violationsDetected = HISTORICAL_BASELINE.violationsDetected + live.violations;

  return {
    totalInspections,
    compliant,
    nonCompliant,
    needsReview,
    complianceRate: Number(((compliant / totalInspections) * 100).toFixed(1)),
    violationsDetected,
    deltas: {
      totalInspections: 8.4,
      compliant: 6.1,
      nonCompliant: -3.2,
      needsReview: 4.7,
      complianceRate: 1.9,
      violationsDetected: 5.3,
    },
  };
}

export function trend(range: DateRange = '12M'): TrendPoint[] {
  const months = RANGE_MONTHS[range];
  return MONTHLY_TREND.slice(-months);
}

export function violationStats(range: DateRange = '12M') {
  const factor = RANGE_MONTHS[range] / 12;
  return VIOLATION_STATS.map((v) => ({
    ...v,
    count: Math.max(1, Math.round(v.count * factor)),
    previousCount: Math.max(1, Math.round(v.previousCount * factor)),
  })).sort((a, b) => b.count - a.count);
}

export function categoryStats() {
  return CATEGORY_COMPLIANCE;
}

export function regionStats() {
  return REGION_STATS;
}

export function repeatOffenders() {
  return REPEAT_OFFENDERS;
}

export function severityDistribution() {
  const { inspections } = getDb();
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  inspections.forEach((i) => i.violations.forEach((v) => (counts[v.severity] += 1)));
  const scale = 12; // project the live sample onto the departmental caseload
  return [
    { name: 'High', value: counts.HIGH * scale + 96, key: 'HIGH' },
    { name: 'Medium', value: counts.MEDIUM * scale + 148, key: 'MEDIUM' },
    { name: 'Low', value: counts.LOW * scale + 82, key: 'LOW' },
  ];
}

export function insights(range: DateRange = '12M'): AnalyticsInsight[] {
  const stats = violationStats(range);
  const top = stats[0];
  const generated: AnalyticsInsight[] = [];
  if (top) {
    const change = ((top.count - top.previousCount) / top.previousCount) * 100;
    generated.push({
      id: 'ins-live',
      tone: change > 0 ? 'negative' : 'positive',
      headline: `${top.name} is the most frequently detected finding`,
      detail: `${top.count} detections in the selected period against ${top.previousCount} in the preceding one — a ${Math.abs(change).toFixed(1)}% ${change > 0 ? 'increase' : 'decrease'}. Rule ${top.code} applies.`,
    });
  }
  return [...generated, ...ANALYTICS_INSIGHTS];
}

/** Compliance rate by month for the live corpus, used on the dashboard sparkline. */
export function complianceByCategoryLive() {
  const { inspections } = getDb();
  const map = new Map<string, { total: number; compliant: number }>();
  inspections.forEach((i) => {
    const entry = map.get(i.category) ?? { total: 0, compliant: 0 };
    entry.total += 1;
    if (i.status === 'COMPLIANT') entry.compliant += 1;
    map.set(i.category, entry);
  });
  return Array.from(map.entries())
    .map(([name, v]) => ({
      name,
      inspections: v.total,
      compliant: v.compliant,
      complianceRate: Number(((v.compliant / v.total) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.inspections - a.inspections);
}
