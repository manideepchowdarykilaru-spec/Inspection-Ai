import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCheck,
  ClipboardCheck,
  FileBarChart,
  Images,
  ListChecks,
  Lock,
  Ruler,
  Save,
  ScanText,
  ShieldAlert,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDatabase } from '@/hooks/useDatabase';
import { Button } from '@/components/ui/Button';
import { Badge, StageBadge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/EmptyState';
import { ComplianceScoreCard } from '@/components/compliance/ComplianceScore';
import { DeclarationPanel } from '@/components/compliance/DeclarationPanel';
import { ImageAnnotator, annotationsFromRules } from '@/components/compliance/ImageAnnotator';
import { RuleValidationTable } from '@/components/compliance/RuleValidationTable';
import { ReadabilityPanel } from '@/components/compliance/ReadabilityPanel';
import { ViolationCard } from '@/components/compliance/ViolationCard';
import { InspectionTimeline } from '@/components/compliance/InspectionTimeline';
import { EvidenceGrid } from '@/components/inspection/EvidenceGrid';
import {
  addViolationNote,
  getInspection,
  listEvidence,
  saveRemarks,
  setInspectionStage,
  setViolationState,
} from '@/services/inspectionService';
import { generateReport, reportForInspection } from '@/services/reportService';
import { resolveImage } from '@/services/imageService';
import { formatDateTime } from '@shared/lib/format';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'results', label: 'Compliance Results', icon: ClipboardCheck },
  { id: 'rules', label: 'Rule Validation', icon: ListChecks },
  { id: 'findings', label: 'Findings', icon: ShieldAlert },
  { id: 'readability', label: 'Readability', icon: Ruler },
  { id: 'evidence', label: 'Evidence', icon: Images },
  { id: 'ocr', label: 'OCR Output', icon: ScanText },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function InspectionDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const toast = useToast();

  const inspection = useDatabase(() => getInspection(id), [id]);
  const evidence = useDatabase(() => listEvidence(id), [id]);
  const report = useDatabase(() => reportForInspection(id), [id]);

  const [tab, setTab] = useState<TabId>('results');
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [shownImageId, setShownImageId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState(inspection?.remarks ?? '');
  const [dirty, setDirty] = useState(false);

  const focusFinding = params.get('finding');

  useEffect(() => {
    if (!focusFinding || !inspection) return;
    setTab('findings');
    const target = inspection.violations.find((v) => v.id === focusFinding);
    if (target?.evidenceRegion) {
      setActiveRegion(target.evidenceRegion.id);
      setShownImageId(target.evidenceRegion.imageId);
    }
  }, [focusFinding, inspection]);

  useEffect(() => {
    setRemarks(inspection?.remarks ?? '');
  }, [inspection?.id]);

  /**
   * The images this inspection was read from, primary first. A package is
   * usually several panels, and each region knows which one it came from.
   */
  const scanImageIds = useMemo(() => {
    if (!inspection) return [] as string[];
    const ids = [
      inspection.ocr?.imageId,
      ...inspection.declarations.map((d) => d.region?.imageId),
      ...inspection.evidenceIds.map((id) => evidence.find((e) => e.id === id)?.imageId),
    ].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }, [inspection, evidence]);

  const currentImageId =
    shownImageId && scanImageIds.includes(shownImageId) ? shownImageId : scanImageIds[0];

  const annotations = useMemo(
    () =>
      inspection
        ? annotationsFromRules(inspection.ruleResults).filter((a) => a.imageId === currentImageId)
        : [],
    [inspection, currentImageId],
  );

  /** Selecting a declaration or finding jumps to the image it was read from. */
  const locate = (regionId: string | null) => {
    setActiveRegion(regionId);
    if (!regionId || !inspection) return;
    const region = inspection.declarations.find((d) => d.region?.id === regionId)?.region;
    if (region?.imageId && scanImageIds.includes(region.imageId)) setShownImageId(region.imageId);
  };

  const imageLabel = (id: string, index: number) =>
    evidence.find((e) => e.imageId === id)?.description ?? `Image ${index + 1}`;

  const switcher =
    scanImageIds.length > 1 ? (
      <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Scanned images">
        {scanImageIds.map((id, i) => {
          const count = inspection?.declarations.filter((d) => d.region?.imageId === id && d.detectedValue).length ?? 0;
          const active = id === currentImageId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setShownImageId(id);
                setActiveRegion(null);
              }}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded border p-1 pr-2 text-left transition-colors',
                active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300',
              )}
            >
              <img src={resolveImage(id)} alt="" className="h-9 w-9 rounded-sm object-cover" />
              <span className="min-w-0">
                <span className="block max-w-[9rem] truncate text-2xs font-semibold text-slate-800">
                  {imageLabel(id, i)}
                </span>
                <span className="block text-[10px] text-slate-500">{count} declaration{count === 1 ? '' : 's'}</span>
              </span>
            </button>
          );
        })}
      </div>
    ) : null;

  const openFindings = inspection?.violations.filter((v) => v.state === 'OPEN').length ?? 0;

  usePageChrome(
    {
      title: inspection ? `Inspection ${inspection.id}` : 'Inspection',
      subtitle: inspection
        ? `${inspection.productName} · ${inspection.brand} · ${inspection.location}`
        : undefined,
      actions: inspection ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<Save size={13} />}
            onClick={() => {
              saveRemarks(inspection.id, remarks, user?.name ?? 'Officer');
              setDirty(false);
              toast.success('Inspection saved', 'Remarks recorded on the inspection file.');
            }}
          >
            <span className="hidden sm:inline">Save</span>
            {dirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </Button>
          <Button
            size="sm"
            icon={<FileBarChart size={13} />}
            onClick={() => {
              if (!user) return;
              const r = generateReport(inspection, user);
              toast.success('Report generated', `${r.id} is ready for download and export.`);
              navigate(`/app/reports/${r.id}`);
            }}
          >
            <span className="hidden sm:inline">Generate Report</span>
            <span className="sm:hidden">Report</span>
          </Button>
        </div>
      ) : undefined,
      contextBar: inspection ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-slate-600">
          <span className="font-mono font-semibold text-navy-900">{inspection.id}</span>
          <StatusBadge status={inspection.status} size="sm" />
          <StageBadge stage={inspection.stage} />
          <span>Score {inspection.screeningScore}/100</span>
          <span className="hidden sm:inline">{openFindings} open finding(s)</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Lock size={11} /> {inspection.inspectorName} · {formatDateTime(inspection.inspectedAt)}
          </span>
        </div>
      ) : undefined,
    },
    [inspection?.id, inspection?.stage, inspection?.status, openFindings, remarks, dirty],
  );

  if (!inspection) {
    return (
      <EmptyState
        title="Inspection not found"
        description="The record may have been removed, or the identifier is incorrect."
        action={
          <Button size="sm" variant="outline" onClick={() => navigate('/app/inspections')}>
            Back to inspections
          </Button>
        }
      />
    );
  }

  const imageSrc = resolveImage(currentImageId ?? evidence[0]?.imageId);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 no-scrollbar no-print">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          const count =
            t.id === 'findings'
              ? inspection.violations.length
              : t.id === 'evidence'
                ? evidence.length
                : undefined;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (focusFinding) setParams({});
              }}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors',
                isActive
                  ? 'border-navy-900 text-navy-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={14} />
              {t.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    isActive ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'results' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <CardHeader title="Scanned package" subtitle="AI detection overlay" dense />
                <CardBody className="p-3">
                  {switcher}
                  <ImageAnnotator
                    src={imageSrc}
                    annotations={annotations}
                    activeId={activeRegion}
                    onSelect={locate}
                  />
                </CardBody>
              </Card>

              <DeclarationPanel
                declarations={inspection.declarations}
                activeRegionId={activeRegion}
                onSelect={locate}
                className="max-h-[560px]"
              />
            </div>

            <Card>
              <CardHeader
                title="Inspector remarks"
                subtitle="Recorded on the inspection report against your official identity"
                icon={<ClipboardCheck size={16} />}
              />
              <CardBody className="space-y-3">
                <Textarea
                  rows={4}
                  value={remarks}
                  onChange={(e) => {
                    setRemarks(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Record observations from physical verification, the packer's response and the action proposed…"
                  aria-label="Inspector remarks"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Save size={13} />}
                    onClick={() => {
                      saveRemarks(inspection.id, remarks, user?.name ?? 'Officer');
                      setDirty(false);
                      toast.success('Remarks saved');
                    }}
                    disabled={!dirty}
                  >
                    Save remarks
                  </Button>
                  {can('inspection:close') && inspection.stage !== 'CLOSED' && (
                    <Button
                      size="sm"
                      variant="success"
                      icon={<CheckCheck size={13} />}
                      onClick={() => {
                        setInspectionStage(inspection.id, 'CLOSED', user?.name ?? 'Officer');
                        toast.success('Inspection closed', 'The record is now read-only for field users.');
                      }}
                    >
                      Close inspection
                    </Button>
                  )}
                  {inspection.stage === 'CLOSED' && (
                    <Badge tone="slate" size="sm">
                      Closed by supervisory officer
                    </Badge>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <ComplianceScoreCard
              score={inspection.screeningScore}
              status={inspection.status}
              breakdown={inspection.scoreBreakdown}
            />

            <Card>
              <CardHeader title="Inspection particulars" dense />
              <CardBody className="space-y-2.5 p-4 text-xs">
                {[
                  ['Inspecting officer', inspection.inspectorName],
                  ['Region', inspection.region],
                  ['Place of inspection', inspection.location],
                  ['Date & time', formatDateTime(inspection.inspectedAt)],
                  ['Source', inspection.source.replace(/_/g, ' ').toLowerCase()],
                  ['Category', inspection.category],
                  ['OCR engine', inspection.ocr?.engine ?? '—'],
                  [
                    'Mean OCR confidence',
                    inspection.ocr ? `${(inspection.ocr.averageConfidence * 100).toFixed(1)}%` : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
                    <dd className="min-w-0 flex-1 font-medium capitalize text-slate-800">{value}</dd>
                  </div>
                ))}
                <div className="flex gap-3 pt-1">
                  <dt className="w-32 shrink-0 text-slate-500">Product record</dt>
                  <dd>
                    <Link
                      to={`/app/products/${inspection.productId}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      View product history
                    </Link>
                  </dd>
                </div>
                {report && (
                  <div className="flex gap-3">
                    <dt className="w-32 shrink-0 text-slate-500">Report</dt>
                    <dd>
                      <Link to={`/app/reports/${report.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                        {report.id}
                      </Link>
                    </dd>
                  </div>
                )}
              </CardBody>
            </Card>

            <InspectionTimeline entries={inspection.auditLog} />
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <RuleValidationTable
            results={inspection.ruleResults}
            onLocate={locate}
            activeRegionId={activeRegion}
          />
          <Card className="h-fit overflow-hidden xl:sticky xl:top-32">
            <CardHeader title="Evidence view" subtitle="Regions referenced by the rule engine" dense />
            <CardBody className="p-3">
              {switcher}
              <ImageAnnotator
                src={imageSrc}
                annotations={annotations}
                activeId={activeRegion}
                onSelect={locate}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'findings' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-4 py-3">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-slate-900">
                  {inspection.violations.length} potential finding
                  {inspection.violations.length === 1 ? '' : 's'} detected
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Each finding states the rule, the detected value and why it was flagged. Verification is
                  recorded against your official identity.
                </p>
              </div>
              <div className="flex items-center gap-2 text-2xs">
                <Badge tone="amber" size="sm">
                  {openFindings} open
                </Badge>
                <Badge tone="red" size="sm">
                  {inspection.violations.filter((v) => v.state === 'VERIFIED').length} verified
                </Badge>
                <Badge tone="slate" size="sm">
                  {inspection.violations.filter((v) => v.state === 'DISMISSED').length} dismissed
                </Badge>
              </div>
            </div>

            {inspection.violations.length === 0 ? (
              <EmptyState
                title="No findings raised"
                description="Every active rule passed screening for this package. Physical verification remains at the officer's discretion."
              />
            ) : (
              inspection.violations.map((v, i) => (
                <ViolationCard
                  key={v.id}
                  violation={v}
                  index={i + 1}
                  active={activeRegion !== null && v.evidenceRegion?.id === activeRegion}
                  onLocate={locate}
                  canAct={can('inspection:verify') || can('inspection:create')}
                  onVerify={() => {
                    setViolationState(inspection.id, v.id, 'VERIFIED', user?.name ?? 'Officer');
                    toast.success('Finding marked verified', v.title);
                  }}
                  onDismiss={() => {
                    setViolationState(inspection.id, v.id, 'DISMISSED', user?.name ?? 'Officer');
                    toast.info('Finding dismissed', v.title);
                  }}
                  onNote={(note) => {
                    addViolationNote(inspection.id, v.id, note, user?.name ?? 'Officer');
                    toast.success('Note recorded');
                  }}
                />
              ))
            )}
          </div>

          <Card className="h-fit overflow-hidden xl:sticky xl:top-32">
            <CardHeader title="Evidence view" subtitle="Click a finding to jump to its region" dense />
            <CardBody className="p-3">
              {switcher}
              <ImageAnnotator
                src={imageSrc}
                annotations={annotations}
                activeId={activeRegion}
                onSelect={locate}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'readability' && (
        <ReadabilityPanel declarations={inspection.declarations} ocr={inspection.ocr} />
      )}

      {tab === 'evidence' && (
        <EvidenceGrid evidence={evidence} inspectionId={inspection.id} allowUpload />
      )}

      {tab === 'ocr' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Raw OCR output"
              subtitle={`${inspection.ocr?.engine ?? 'OCR engine'} · ${inspection.ocr?.tokens.length ?? 0} recognised blocks`}
              icon={<ScanText size={16} />}
            />
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200">
              {inspection.ocr?.rawText}
            </pre>
          </Card>
          <DeclarationPanel
            declarations={inspection.declarations}
            activeRegionId={activeRegion}
            onSelect={locate}
            className="max-h-[600px]"
          />
        </div>
      )}
    </div>
  );
}
