import type {
  AppNotification,
  ComplianceRule,
  Evidence,
  EvidenceType,
  Inspection,
  Product,
  Report,
  User,
} from '@shared/types';
import { DEMO_CASES, type DemoCase } from './demoProducts';
import { synthesizeCase } from './caseFactory';
import { COMPLIANCE_RULES } from './rules';
import { INSPECTION_PLAN, NOTIFICATION_SEEDS, PRODUCT_SEEDS, USERS } from './mockData';
import { buildInspection, evaluateCase } from '@shared/pipeline';
import { checksum, uid } from '@shared/lib/utils';
import { parseMrp } from '@shared/lib/format';

/**
 * Deterministic seed corpus.
 *
 * Free of storage and browser APIs so the Node seeding script and the client can
 * both use it. Every historical inspection is produced by running the real
 * pipeline over the label corpus, which is why opening a seeded record shows the
 * same fidelity as a live scan.
 */

export interface SeedCorpus {
  users: User[];
  products: Product[];
  inspections: Inspection[];
  evidence: Evidence[];
  reports: Report[];
  notifications: AppNotification[];
  rules: ComplianceRule[];
  sequence: number;
}

const caseIndex = new Map<string, DemoCase>();
DEMO_CASES.forEach((c) => caseIndex.set(c.id, c));
PRODUCT_SEEDS.forEach((seed) => {
  const built = synthesizeCase(seed);
  caseIndex.set(built.id, built);
});

export const ALL_CASES = Array.from(caseIndex.values());

export function caseById(id: string): DemoCase | undefined {
  return caseIndex.get(id);
}

export function caseByImageId(imageId: string): DemoCase | undefined {
  return ALL_CASES.find((c) => c.label.imageId === imageId);
}

export function registerCase(demo: DemoCase) {
  caseIndex.set(demo.id, demo);
}

const EVIDENCE_PLAN: { type: EvidenceType; description: string }[] = [
  { type: 'PRODUCT_PHOTO', description: 'Front panel of the package as displayed for retail sale' },
  { type: 'LABEL_PHOTO', description: 'Principal display panel carrying the mandatory declarations' },
  { type: 'MRP_PHOTO', description: 'Close-up of the retail sale price declaration' },
  { type: 'MANUFACTURER_DETAILS', description: 'Manufacturer / packer name and address block' },
  { type: 'BARCODE', description: 'Barcode and batch identification area' },
];

function isoFromPlan(daysAgo: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, (daysAgo * 7) % 60, 0, 0);
  return d.toISOString();
}

export function buildSeedCorpus(): SeedCorpus {
  const inspections: Inspection[] = [];
  const evidence: Evidence[] = [];
  const reports: Report[] = [];
  let sequence = 1000;

  INSPECTION_PLAN.forEach((entry, index) => {
    const demo = caseById(entry.caseId);
    const inspector = USERS.find((u) => u.id === entry.inspectorId) ?? USERS[0];
    if (!demo) return;

    sequence += 1;
    const id = `LM-2026-${sequence}`;
    const at = isoFromPlan(entry.daysAgo, entry.hour);
    const result = evaluateCase(demo, id);

    const evidenceCount = 3 + (index % 3);
    const evidenceIds: string[] = [];
    for (let i = 0; i < evidenceCount; i++) {
      const plan = EVIDENCE_PLAN[i % EVIDENCE_PLAN.length];
      const evId = `${id}-E${String(i + 1).padStart(2, '0')}`;
      evidenceIds.push(evId);
      evidence.push({
        id: evId,
        inspectionId: id,
        evidenceNumber: `EV-${String(i + 1).padStart(2, '0')}`,
        type: plan.type,
        imageId: demo.label.imageId,
        description: plan.description,
        capturedAt: new Date(new Date(at).getTime() + i * 47_000).toISOString(),
        uploadedBy: inspector.name,
        checksum: checksum(`${evId}-${demo.label.imageId}`),
      });
    }

    const inspection = buildInspection({
      id,
      demo,
      result,
      productId: `PRD-${demo.id}`,
      inspector,
      location: entry.location,
      inspectedAt: at,
      evidenceIds,
      stage: entry.stage ?? 'AI_COMPLETE',
    });

    if (entry.stage === 'CLOSED' || entry.stage === 'UNDER_REVIEW') {
      inspection.auditLog.push({
        id: uid('log'),
        at: new Date(new Date(at).getTime() + 240_000).toISOString(),
        actor: inspector.name,
        action: 'AI findings reviewed by inspector',
        detail: `${inspection.violations.length} finding(s) examined`,
      });
    }

    if (entry.stage === 'CLOSED') {
      const reportId = `RPT-2026-${sequence}`;
      inspection.reportId = reportId;
      inspection.remarks =
        inspection.status === 'COMPLIANT'
          ? 'Package examined physically. Declarations found consistent with the AI screening result. No further action proposed.'
          : 'Findings verified on the physical package. Notice proposed to the packer under the applicable provisions.';
      inspection.auditLog.push({
        id: uid('log'),
        at: new Date(new Date(at).getTime() + 480_000).toISOString(),
        actor: inspector.name,
        action: 'Inspection report generated',
        detail: reportId,
      });
      reports.push({
        id: reportId,
        inspectionId: id,
        productName: demo.productName,
        brand: demo.brand,
        generatedAt: new Date(new Date(at).getTime() + 480_000).toISOString(),
        generatedBy: inspector.name,
        status: 'FINALISED',
        format: 'PDF',
        screeningScore: inspection.screeningScore,
        complianceStatus: inspection.status,
        violationCount: inspection.violations.length,
      });
      inspection.violations = inspection.violations.map((v) => ({
        ...v,
        state: v.severity === 'LOW' ? 'DISMISSED' : 'VERIFIED',
        verifiedBy: inspector.name,
        verifiedAt: new Date(new Date(at).getTime() + 300_000).toISOString(),
      }));
    }

    inspections.push(inspection);
  });

  const products: Product[] = ALL_CASES.map((demo) => {
    const own = inspections
      .filter((i) => i.productId === `PRD-${demo.id}`)
      .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt));
    const latest = own[0];
    const openViolations = own.reduce(
      (sum, i) => sum + i.violations.filter((v) => v.state === 'OPEN').length,
      0,
    );
    // "Repeat offender" means the same commodity failed screening on more than
    // one occasion — not merely that it accumulated advisory findings.
    const failedScreenings = own.filter((i) => i.status === 'NON_COMPLIANT').length;
    const ex = demo.extraction;

    return {
      id: `PRD-${demo.id}`,
      name: demo.productName,
      brand: demo.brand,
      category: demo.category,
      manufacturer: ex.MANUFACTURER_NAME?.value ?? 'Not declared',
      manufacturerAddress: ex.MANUFACTURER_ADDRESS?.value ?? 'Not declared',
      importer: ex.IMPORTER_DETAILS?.value ?? undefined,
      countryOfOrigin: ex.COUNTRY_OF_ORIGIN?.value ?? 'Not declared',
      netQuantity: ex.NET_QUANTITY?.value ?? 'Not declared',
      mrp: parseMrp(ex.MRP?.value),
      packedOn: ex.DATE_OF_PACKING?.value ?? undefined,
      bestBefore: ex.BEST_BEFORE?.value ?? undefined,
      consumerCare: ex.CONSUMER_CARE?.value ?? undefined,
      fssaiLicense: ex.FSSAI_LICENSE?.value ?? undefined,
      barcode: demo.label.barcode ?? '—',
      batchNumber: ex.BATCH_NUMBER?.value ?? undefined,
      imageId: demo.label.imageId,
      createdAt: own[own.length - 1]?.inspectedAt ?? new Date().toISOString(),
      lastInspectedAt: latest?.inspectedAt,
      inspectionCount: own.length,
      latestScore: latest?.screeningScore,
      latestStatus: latest?.status,
      openViolations,
      repeatOffender: failedScreenings >= 2,
    } satisfies Product;
  });

  const notifications: AppNotification[] = NOTIFICATION_SEEDS.map((seed, i) => ({
    ...seed,
    id: `ntf-${i + 1}`,
    createdAt: new Date(Date.now() - (i + 1) * 5_400_000).toISOString(),
  }));

  return {
    users: USERS,
    products,
    inspections,
    evidence,
    reports,
    notifications,
    rules: COMPLIANCE_RULES,
    sequence,
  };
}
