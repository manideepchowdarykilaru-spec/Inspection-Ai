import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Cpu,
  FileImage,
  Gauge,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import { ScanProgress } from '@/components/compliance/ScanProgress';
import { DeclarationPanel } from '@/components/compliance/DeclarationPanel';
import { ComplianceScoreCard } from '@/components/compliance/ComplianceScore';
import { ImageAnnotator, annotationsFromRules } from '@/components/compliance/ImageAnnotator';
import { getDemoCase } from '@shared/data/demoProducts';
import type { DemoCase } from '@shared/data/demoProducts';
import { runCompliancePipeline, type PipelineResult, type StageId } from '@/services/complianceService';
import { createInspection, type CapturedImage } from '@/services/inspectionService';
import { cn, uid } from '@/lib/utils';
import { CameraOff, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { caseFromScan } from '@/services/scanIdentity';
import type { ProductCategory } from '@shared/types';

interface ScanState {
  caseId: string;
  images: CapturedImage[];
  location: string;
  region: string;
  source: 'PACKAGE_SCAN' | 'E_COMMERCE_LISTING' | 'MANUAL_ENTRY';
  synthetic?: boolean;
  panelWidthMm?: number;
  category?: ProductCategory;
  notes?: string;
}

export default function AnalysisWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const state = location.state as ScanState | null;

  const [completed, setCompleted] = useState<StageId[]>([]);
  const [current, setCurrent] = useState<StageId | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showProcessed, setShowProcessed] = useState(false);
  const started = useRef(false);

  const baseCase = state ? getDemoCase(state.caseId) : undefined;
  const hasUploads = Boolean(state && !state.synthetic && state.images.length > 0);

  /**
   * Image identifiers must match what createInspection assigns to evidence rows,
   * so a region read from the third photograph resolves to that photograph
   * later on the inspection record.
   */
  const imageIdFor = (index: number) =>
    index === 0 ? workingCase!.label.imageId : `${workingCase!.label.imageId}-${index}`;

  /** Uploaded photographs get their own imageId so evidence resolves to them. */
  const workingCase = useMemo<DemoCase | undefined>(() => {
    if (!baseCase) return undefined;
    const isSynthetic = !hasUploads;
    if (isSynthetic) return baseCase;
    const imageId = `img-upload-${uid('u')}`;
    return { ...baseCase, id: `case-${imageId}`, label: { ...baseCase.label, imageId } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCase?.id]);

  /**
   * For an uploaded photograph the commodity is whatever OCR read — inheriting
   * the demonstration sample's name would file the inspection against the wrong
   * product entirely.
   */
  const resolvedCase = useMemo(() => {
    if (!workingCase) return undefined;
    if (!hasUploads || !result) return workingCase;
    return caseFromScan(workingCase, result.declarations, state?.category ?? workingCase.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingCase, result, hasUploads]);

  usePageChrome(
    {
      title: 'Image Analysis Workspace',
      subtitle: resolvedCase
        ? `${resolvedCase.productName} · ${resolvedCase.brand} · ${state?.location ?? ''}`
        : undefined,
      contextBar: (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <Cpu size={12} /> Pipeline: preprocess → OCR → detection → classification → rules → score
          </span>
          <span className="hidden sm:inline">Engine: Tesseract LSTM · Rule engine v1.3</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Gauge size={12} />
            {result ? 'Screening complete' : 'Screening in progress'}
          </span>
        </div>
      ),
    },
    [resolvedCase?.id, resolvedCase?.productName, result],
  );

  useEffect(() => {
    if (!workingCase || started.current) return;
    started.current = true;
    void runCompliancePipeline(workingCase, {
      inspectionId: 'PENDING',
      // Every panel is read; the merged result keeps the best reading of each
      // declaration and each evidence box remembers its own image.
      images: hasUploads
        ? state!.images.map((img, i) => ({ imageId: imageIdFor(i), name: img.name, dataUrl: img.dataUrl }))
        : undefined,
      panelWidthMm: state?.panelWidthMm,
      onStage: (stage) => setCurrent(stage),
      onComplete: (stage) => {
        setCompleted((prev) => [...prev, stage]);
        setCurrent(null);
      },
    })
      .then((res) => {
        setResult(res);
        setCurrent(null);
      })
      .catch((error: unknown) => {
        setCurrent(null);
        setScanError(
          error instanceof Error ? error.message : 'The analysis service did not respond.',
        );
      });
  }, [workingCase]);

  if (!state || !workingCase) return <Navigate to="/app/new-inspection" replace />;

  const images = state.images.length ? state.images : [];
  const mainImage = images[activeImage]?.dataUrl ?? '';
  const activeImageId = imageIdFor(activeImage);
  const declarationsReady = completed.includes('classify');
  // Only the regions read from the image on screen are drawn on it.
  const annotations = result
    ? annotationsFromRules(result.ruleResults).filter((a) => a.imageId === activeImageId)
    : [];
  const activeSummary = result?.perImage?.find((p) => p.imageId === activeImageId);
  const activePreprocessing = activeSummary?.preprocessing ?? result?.preprocessing;

  /** Selecting a declaration switches to the photograph it was read from. */
  const locate = (regionId: string | null) => {
    setActiveRegion(regionId);
    if (!regionId || !result) return;
    const region = result.declarations.find((d) => d.region?.id === regionId)?.region;
    if (!region) return;
    const index = images.findIndex((_, i) => imageIdFor(i) === region.imageId);
    if (index >= 0) setActiveImage(index);
  };

  const rerun = () => {
    started.current = false;
    setScanError(null);
    setCompleted([]);
    setResult(null);
    setActiveRegion(null);
    setCurrent(null);
    // Re-triggers the pipeline effect on the next render.
    setTimeout(() => {
      started.current = true;
      void runCompliancePipeline(workingCase, {
        inspectionId: 'PENDING',
        images: hasUploads
          ? state!.images.map((img, i) => ({ imageId: imageIdFor(i), name: img.name, dataUrl: img.dataUrl }))
          : undefined,
        panelWidthMm: state?.panelWidthMm,
        speed: 1.6,
        onStage: (stage) => setCurrent(stage),
        onComplete: (stage) => {
          setCompleted((prev) => [...prev, stage]);
          setCurrent(null);
        },
      })
        .then((res) => {
          setResult(res);
          setCurrent(null);
        })
        .catch((error: unknown) => {
          setCurrent(null);
          setScanError(
            error instanceof Error ? error.message : 'The analysis service did not respond.',
          );
        });
    }, 60);
  };

  const save = async () => {
    if (!result || !user || !resolvedCase) return;
    setSaving(true);
    try {
      const inspection = await createInspection({
        demo: resolvedCase,
        result,
        inspector: { ...user, region: state.region ?? user.region },
        location: state.location,
        images,
        source: state.source,
      });
      toast.success(
        `Inspection ${inspection.id} saved`,
        `${inspection.violations.length} finding(s) recorded in the database`,
      );
      navigate(`/app/inspections/${inspection.id}`, { replace: true });
    } catch (error) {
      setSaving(false);
      toast.error(
        'Could not save the inspection',
        error instanceof Error ? error.message : 'The API did not accept the record.',
      );
    }
  };

  const highSeverity = result?.violations.filter((v) => v.severity === 'HIGH').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)_minmax(0,380px)]">
        {/* Captured evidence rail */}
        <aside className="surface flex flex-col overflow-hidden xl:max-h-[calc(100vh-13rem)]">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <FileImage size={14} className="text-brand-700" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">Captured</h2>
            <span className="ml-auto text-2xs text-slate-400">{images.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto p-2 xl:flex-col xl:overflow-y-auto">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveImage(i)}
                className={cn(
                  'group relative w-28 shrink-0 overflow-hidden rounded border-2 text-left transition-all xl:w-full',
                  i === activeImage ? 'border-brand-600 ring-1 ring-brand-500/30' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <img src={img.dataUrl} alt={img.name} className="aspect-[4/3] w-full object-cover" />
                <span className="block truncate bg-white px-1.5 py-1 text-2xs text-slate-600">{img.name}</span>
                {(() => {
                  const summary = result?.perImage?.find((p) => p.imageId === imageIdFor(i));
                  if (!result) {
                    return (
                      <span className="absolute left-1 top-1 rounded bg-brand-700 px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                        Reading
                      </span>
                    );
                  }
                  if (!summary) return null;
                  const tone =
                    summary.quality.level === 'GOOD'
                      ? 'bg-emerald-600'
                      : summary.quality.level === 'MARGINAL'
                        ? 'bg-amber-500'
                        : 'bg-red-600';
                  return (
                    <span className={cn('absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase text-white', tone)}>
                      {summary.declarationsFound.length} read · {summary.quality.level}
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>
        </aside>

        {/* Annotated image */}
        <section className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-bold tracking-tight text-slate-900">AI Detection Overlay</h2>
              <p className="mt-0.5 text-2xs text-slate-500">
                {result
                  ? `${annotations.length} declaration region${annotations.length === 1 ? '' : 's'} on this image${
                      images.length > 1 ? ` · ${result.declarations.filter((d) => d.detectedValue).length} declarations across ${images.length} images` : ''
                    }`
                  : images.length > 1
                    ? `Reading ${images.length} images…`
                    : 'Detecting declaration regions…'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activePreprocessing && (
                <Button
                  size="sm"
                  variant={showProcessed ? 'secondary' : 'outline'}
                  icon={showProcessed ? <Eye size={13} /> : <EyeOff size={13} />}
                  onClick={() => setShowProcessed((v) => !v)}
                  aria-pressed={showProcessed}
                >
                  {showProcessed ? 'Show photograph' : 'What the OCR saw'}
                </Button>
              )}
              {result && (
                <Button size="sm" variant="outline" icon={<RefreshCcw size={13} />} onClick={rerun}>
                  Re-scan
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {showProcessed && activePreprocessing ? (
              <div>
                <img
                  src={activePreprocessing.previewDataUrl}
                  alt="Preprocessed image as read by the OCR engine"
                  className="w-full rounded-md border border-slate-300 bg-slate-900 object-contain"
                />
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="label-text mb-1.5">
                    Preprocessing · {activePreprocessing.variantUsed} variant
                    {(activeSummary?.quality ?? result?.quality)?.refocused ? ' · refocused on the label' : ''}
                  </p>
                  <ol className="flex flex-wrap gap-1.5">
                    {activePreprocessing.stages.map((stage, i) => (
                      <li key={i} className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-2xs text-slate-600">
                        {stage}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : (
              <ImageAnnotator
                src={mainImage}
                annotations={annotations}
                activeId={activeRegion}
                onSelect={locate}
                scanning={!result}
                caption={
                  hasUploads
                    ? `Image ${activeImage + 1} of ${images.length} · ${images[activeImage]?.name ?? ''}`
                    : `Source: ${workingCase.label.imageId}`
                }
              />
            )}
          </div>
        </section>

        {/* Declarations */}
        {declarationsReady && result ? (
          <DeclarationPanel
            declarations={result.declarations}
            activeRegionId={activeRegion}
            onSelect={locate}
            rawText={result.ocr.rawText}
            className="xl:max-h-[calc(100vh-13rem)]"
          />
        ) : (
          <div className="surface flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-brand-700" />
              <h2 className="text-sm font-bold tracking-tight text-slate-900">Detected Declarations</h2>
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="skeleton h-2 w-24" />
                <div className="skeleton h-3.5 w-full" />
              </div>
            ))}
            <p className="mt-1 text-2xs leading-relaxed text-slate-400">
              Text blocks are being recognised and classified into mandatory declarations.
            </p>
          </div>
        )}
      </div>

      {/* Pipeline + outcome */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <ScanProgress completed={completed} current={current} />

        {result && result.quality && result.quality.labelDetected === false ? (
          <div className="surface border-l-4 border-l-red-600 bg-red-50/50 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                <CameraOff size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900">No packaged-commodity label detected</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">{result.quality.advice}</p>
                <p className="mt-2 font-mono text-2xs text-slate-500">
                  {result.quality.wordsRead} fragments read · confidence {(result.quality.meanConfidence * 100).toFixed(0)}% · no
                  declaration located
                </p>
                <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                  Nothing here can be scored, so no inspection record is created from this photograph. Re-capture with
                  the printed panel filling the frame, then scan again.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  icon={<RefreshCcw size={13} />}
                  onClick={() => navigate('/app/new-inspection', { state: { prefillImages: images } })}
                >
                  Capture again
                </Button>
              </div>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {result.quality && result.quality.level !== 'GOOD' && (
              <div
                className={cn(
                  'surface border-l-4 p-4',
                  result.quality.level === 'POOR'
                    ? 'border-l-red-600 bg-red-50/50'
                    : 'border-l-amber-500 bg-amber-50/50',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <CameraOff
                    size={16}
                    className={cn(
                      'mt-0.5 shrink-0',
                      result.quality.level === 'POOR' ? 'text-red-700' : 'text-amber-700',
                    )}
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-900">
                      {result.quality.level === 'POOR'
                        ? 'Image quality too low to rely on'
                        : 'Image quality is marginal'}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">
                      {result.quality.advice}
                    </p>
                    <p className="mt-2 font-mono text-2xs text-slate-500">
                      text ≈{result.quality.medianCapHeightPx}px · confidence{' '}
                      {(result.quality.meanConfidence * 100).toFixed(0)}% ·{' '}
                      {result.quality.declarationsFound}/12 declarations · upscaled{' '}
                      {result.quality.upscaleApplied}× · {result.quality.passUsed}
                    </p>
                    <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                      Saving is still permitted — a poor scan is itself a record — but the findings
                      below reflect what could be read, not what the package declares.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  icon={<RefreshCcw size={13} />}
                  onClick={() => navigate('/app/new-inspection')}
                >
                  Capture again
                </Button>
              </div>
            )}
            {result.quality && result.quality.level === 'GOOD' && (
              <div className="surface border-l-4 border-l-emerald-500 bg-emerald-50/40 px-4 py-2.5">
                <p className="flex items-center gap-2 text-xs font-medium text-emerald-900">
                  <CheckCircle2 size={14} className="shrink-0 text-emerald-700" />
                  Read from your photograph — {result.quality.declarationsFound}/12 declarations at{' '}
                  {(result.quality.meanConfidence * 100).toFixed(0)}% confidence
                </p>
              </div>
            )}
            <ComplianceScoreCard
              score={result.score}
              status={result.status}
              breakdown={result.breakdown}
              compact
            />

            <div className="surface p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} className="text-amber-600" />
                <h2 className="text-sm font-bold tracking-tight text-slate-900">
                  {result.violations.length} potential finding{result.violations.length === 1 ? '' : 's'}
                </h2>
                {highSeverity > 0 && (
                  <Badge tone="red" size="sm">
                    {highSeverity} high severity
                  </Badge>
                )}
              </div>
              <ul className="mt-3 space-y-2">
                {result.violations.slice(0, 4).map((v) => (
                  <li key={v.id} className="flex items-start gap-2.5">
                    <SeverityBadge severity={v.severity} />
                    <span className="min-w-0 flex-1 text-xs leading-relaxed text-slate-700">{v.title}</span>
                  </li>
                ))}
                {result.violations.length === 0 && (
                  <li className="text-xs text-slate-500">
                    No rule failed screening. Physical verification remains at the officer&apos;s discretion.
                  </li>
                )}
              </ul>
              <Button
                className="mt-4 w-full justify-center"
                icon={<ArrowRight size={15} />}
                onClick={save}
                loading={saving}
              >
                Save inspection &amp; review findings
              </Button>
            </div>
          </div>
        ) : scanError ? (
          <div className="surface flex flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
              <ShieldAlert size={20} />
            </span>
            <p className="text-sm font-semibold text-slate-800">Analysis could not be completed</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-500">{scanError}</p>
            <p className="max-w-sm text-2xs leading-relaxed text-slate-400">
              The analysis service performs OCR and rule evaluation. Confirm the API is running
              (npm run dev starts it alongside the interface).
            </p>
            <Button size="sm" variant="outline" icon={<RefreshCcw size={13} />} onClick={rerun}>
              Retry scan
            </Button>
          </div>
        ) : (
          <div className="surface flex flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
              <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brand-400" />
              <Cpu size={20} className="text-brand-700" />
            </span>
            <p className="text-sm font-semibold text-slate-800">Running compliance analysis</p>
            <p className="max-w-xs text-xs leading-relaxed text-slate-500">
              The package image is being preprocessed, read and validated against the active Legal Metrology
              rule set. This normally completes within a few seconds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
