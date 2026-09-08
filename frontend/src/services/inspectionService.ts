import type {
  AppNotification,
  AuditLogEntry,
  ComplianceStatus,
  Evidence,
  EvidenceType,
  Inspection,
  Product,
  Severity,
  User,
  Violation,
  ViolationState,
} from '@shared/types';
import type { DemoCase } from '@shared/data/demoProducts';
import { checksum, uid } from '@/lib/utils';
import { parseMrp } from '@shared/lib/format';
import { getDb, mutate, nextSequence, registerCase } from './storage';
import * as api from './api';
import type { PipelineResult } from './complianceService';
import { buildInspection } from './complianceService';

/** Query surface used by History, Dashboard and the global search. */
export interface InspectionQuery {
  search?: string;
  status?: ComplianceStatus | 'ALL';
  category?: string | 'ALL';
  inspectorId?: string | 'ALL';
  region?: string | 'ALL';
  severity?: Severity | 'ALL';
  from?: string;
  to?: string;
  brand?: string | 'ALL';
}

export function listInspections(query: InspectionQuery = {}): Inspection[] {
  const { inspections } = getDb();
  const search = query.search?.trim().toLowerCase();

  return inspections
    .filter((i) => {
      if (query.status && query.status !== 'ALL' && i.status !== query.status) return false;
      if (query.category && query.category !== 'ALL' && i.category !== query.category) return false;
      if (query.brand && query.brand !== 'ALL' && i.brand !== query.brand) return false;
      if (query.inspectorId && query.inspectorId !== 'ALL' && i.inspectorId !== query.inspectorId)
        return false;
      if (query.region && query.region !== 'ALL' && i.region !== query.region) return false;
      if (query.severity && query.severity !== 'ALL') {
        if (!i.violations.some((v) => v.severity === query.severity)) return false;
      }
      if (query.from && new Date(i.inspectedAt) < new Date(query.from)) return false;
      if (query.to && new Date(i.inspectedAt) > new Date(`${query.to}T23:59:59`)) return false;
      if (search) {
        const haystack = [i.id, i.productName, i.brand, i.category, i.inspectorName, i.location]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt));
}

export function getInspection(id: string) {
  return getDb().inspections.find((i) => i.id === id);
}

export function listEvidence(inspectionId?: string): Evidence[] {
  const { evidence } = getDb();
  const rows = inspectionId ? evidence.filter((e) => e.inspectionId === inspectionId) : evidence;
  return [...rows].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt));
}

/* --------------------------------------------------------- Scan creation */

export interface CapturedImage {
  id: string;
  name: string;
  dataUrl: string;
  type: EvidenceType;
  size: number;
}

export interface CreateInspectionInput {
  demo: DemoCase;
  result: PipelineResult;
  inspector: User;
  location: string;
  images: CapturedImage[];
  source?: Inspection['source'];
}

export async function createInspection(input: CreateInspectionInput): Promise<Inspection> {
  const sequence = await nextSequence();
  const id = `LM-2026-${sequence}`;
  const now = new Date().toISOString();

  // Keep the case available for image + region resolution during this session.
  registerCase(input.demo);

  const evidenceRows: Evidence[] = input.images.map((img, index) => ({
    id: `${id}-E${String(index + 1).padStart(2, '0')}`,
    inspectionId: id,
    evidenceNumber: `EV-${String(index + 1).padStart(2, '0')}`,
    type: img.type,
    imageId: index === 0 ? input.demo.label.imageId : `${input.demo.label.imageId}-${index}`,
    dataUrl: img.dataUrl,
    description: img.name,
    capturedAt: new Date(Date.now() + index * 1000).toISOString(),
    uploadedBy: input.inspector.name,
    checksum: checksum(`${id}-${img.name}-${img.size}`),
  }));

  const inspection = buildInspection({
    id,
    demo: input.demo,
    result: input.result,
    productId: `PRD-${input.demo.id}`,
    inspector: input.inspector,
    location: input.location,
    inspectedAt: now,
    evidenceIds: evidenceRows.map((e) => e.id),
    source: input.source ?? 'PACKAGE_SCAN',
    stage: 'AI_COMPLETE',
  });

  let productRow: Product | undefined;
  const notification: AppNotification = {
    id: uid('ntf'),
    title: `Inspection ${id} completed`,
    body: `${input.demo.productName} · ${inspection.violations.length} finding(s) · screening score ${inspection.screeningScore}/100`,
    priority: inspection.status === 'NON_COMPLIANT' ? 'HIGH' : 'MEDIUM',
    category: 'INSPECTION',
    createdAt: now,
    read: false,
    link: `/app/inspections/${id}`,
  };

  mutate((draft) => {
    draft.inspections.unshift(inspection);
    draft.evidence.push(...evidenceRows);

    const productId = `PRD-${input.demo.id}`;
    const existing = draft.products.find((p) => p.id === productId);
    const openViolations = inspection.violations.filter((v) => v.state === 'OPEN').length;
    if (existing) {
      existing.inspectionCount += 1;
      existing.lastInspectedAt = now;
      existing.latestScore = inspection.screeningScore;
      existing.latestStatus = inspection.status;
      existing.openViolations += openViolations;
      existing.repeatOffender =
        draft.inspections.filter(
          (i) => i.productId === productId && i.status === 'NON_COMPLIANT',
        ).length >= 2;
      productRow = existing;
    } else {
      const ex = input.demo.extraction;
      const created: Product = {
        id: productId,
        name: input.demo.productName,
        brand: input.demo.brand,
        category: input.demo.category,
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
        barcode: input.demo.label.barcode ?? '—',
        batchNumber: ex.BATCH_NUMBER?.value ?? undefined,
        imageId: input.demo.label.imageId,
        createdAt: now,
        lastInspectedAt: now,
        inspectionCount: 1,
        latestScore: inspection.screeningScore,
        latestStatus: inspection.status,
        openViolations,
        repeatOffender: false,
      };
      draft.products.unshift(created);
      productRow = created;
    }

    draft.notifications.unshift(notification);
  });

  await api.createInspection({
    inspection,
    evidence: evidenceRows,
    product: productRow!,
    notification,
  });

  return inspection;
}

/* --------------------------------------------------------- Mutation APIs */

function appendAudit(inspection: Inspection, entry: Omit<AuditLogEntry, 'id' | 'at'>): AuditLogEntry {
  const row: AuditLogEntry = { id: uid('log'), at: new Date().toISOString(), ...entry };
  inspection.auditLog.push(row);
  return row;
}

export function setViolationState(
  inspectionId: string,
  violationId: string,
  state: ViolationState,
  actor: string,
) {
  let audit: AuditLogEntry | undefined;
  let product: Product | undefined;
  let stage: Inspection['stage'] | undefined;
  const verifiedAt = new Date().toISOString();

  mutate(
    (draft) => {
      const inspection = draft.inspections.find((i) => i.id === inspectionId);
      const violation = inspection?.violations.find((v) => v.id === violationId);
      if (!inspection || !violation) return;
      violation.state = state;
      violation.verifiedBy = actor;
      violation.verifiedAt = verifiedAt;
      audit = appendAudit(inspection, {
        actor,
        action: state === 'VERIFIED' ? 'Finding marked as verified' : 'Finding dismissed',
        detail: `${violation.id} · ${violation.title}`,
      });
      if (inspection.stage === 'AI_COMPLETE') {
        inspection.stage = 'UNDER_REVIEW';
        stage = 'UNDER_REVIEW';
      }

      product = draft.products.find((p) => p.id === inspection.productId);
      if (product) {
        product.openViolations = draft.inspections
          .filter((i) => i.productId === product!.id)
          .reduce((sum, i) => sum + i.violations.filter((v) => v.state === 'OPEN').length, 0);
      }
    },
    async () => {
      await api.patchViolation(violationId, {
        patch: { state, verifiedBy: actor, verifiedAt },
        audit,
        inspectionId,
        product,
      });
      if (stage) await api.patchInspection(inspectionId, { stage });
    },
  );
}

export function addViolationNote(
  inspectionId: string,
  violationId: string,
  note: string,
  actor: string,
) {
  let audit: AuditLogEntry | undefined;
  mutate(
    (draft) => {
      const inspection = draft.inspections.find((i) => i.id === inspectionId);
      const violation = inspection?.violations.find((v) => v.id === violationId);
      if (!inspection || !violation) return;
      violation.officerNote = note;
      audit = appendAudit(inspection, {
        actor,
        action: 'Officer note recorded on finding',
        detail: `${violation.id} · ${note.slice(0, 80)}`,
      });
    },
    () => api.patchViolation(violationId, { patch: { officerNote: note }, audit, inspectionId }),
  );
}

export function saveRemarks(inspectionId: string, remarks: string, actor: string) {
  let audit: AuditLogEntry | undefined;
  mutate(
    (draft) => {
      const inspection = draft.inspections.find((i) => i.id === inspectionId);
      if (!inspection) return;
      inspection.remarks = remarks;
      audit = appendAudit(inspection, { actor, action: 'Inspector remarks saved' });
    },
    () => api.patchInspection(inspectionId, { remarks }, audit),
  );
}

export function setInspectionStage(inspectionId: string, stage: Inspection['stage'], actor: string) {
  let audit: AuditLogEntry | undefined;
  mutate(
    (draft) => {
      const inspection = draft.inspections.find((i) => i.id === inspectionId);
      if (!inspection) return;
      inspection.stage = stage;
      audit = appendAudit(inspection, {
        actor,
        action: stage === 'CLOSED' ? 'Inspection closed by officer' : `Stage changed to ${stage}`,
      });
    },
    () => api.patchInspection(inspectionId, { stage }, audit),
  );
}

export function addEvidence(
  inspectionId: string,
  input: { name: string; dataUrl: string; type: EvidenceType; description: string; size: number },
  actor: string,
) {
  let row: Evidence | undefined;
  let audit: AuditLogEntry | undefined;
  mutate(
    (draft) => {
      const inspection = draft.inspections.find((i) => i.id === inspectionId);
      if (!inspection) return;
      const index = draft.evidence.filter((e) => e.inspectionId === inspectionId).length;
      const id = `${inspectionId}-E${String(index + 1).padStart(2, '0')}`;
      row = {
        id,
        inspectionId,
        evidenceNumber: `EV-${String(index + 1).padStart(2, '0')}`,
        type: input.type,
        imageId: `img-${id}`,
        dataUrl: input.dataUrl,
        description: input.description || input.name,
        capturedAt: new Date().toISOString(),
        uploadedBy: actor,
        checksum: checksum(`${id}-${input.name}-${input.size}`),
      };
      draft.evidence.push(row);
      inspection.evidenceIds.push(id);
      audit = appendAudit(inspection, {
        actor,
        action: 'Evidence added',
        detail: input.description || input.name,
      });
    },
    () => api.addEvidence({ evidence: row!, audit, inspectionId }),
  );
}

export function removeEvidence(evidenceId: string, actor: string) {
  let audit: AuditLogEntry | undefined;
  let inspectionId: string | undefined;
  mutate(
    (draft) => {
      const row = draft.evidence.find((e) => e.id === evidenceId);
      if (!row) return;
      inspectionId = row.inspectionId;
      draft.evidence = draft.evidence.filter((e) => e.id !== evidenceId);
      const inspection = draft.inspections.find((i) => i.id === row.inspectionId);
      if (inspection) {
        inspection.evidenceIds = inspection.evidenceIds.filter((id) => id !== evidenceId);
        audit = appendAudit(inspection, {
          actor,
          action: 'Evidence removed',
          detail: row.evidenceNumber,
        });
      }
    },
    () => api.removeEvidence(evidenceId, { audit, inspectionId }),
  );
}

/* ------------------------------------------------------------ Aggregates */

export function listViolations(): (Violation & { inspection: Inspection })[] {
  return getDb()
    .inspections.flatMap((inspection) =>
      inspection.violations.map((v) => ({ ...v, inspection })),
    )
    .sort((a, b) => +new Date(b.inspection.inspectedAt) - +new Date(a.inspection.inspectedAt));
}
