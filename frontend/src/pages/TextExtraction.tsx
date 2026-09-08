import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CameraOff,
  CheckCircle2,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  RefreshCcw,
  ScanText,
  Wand2,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { UploadZone } from '@/components/inspection/UploadZone';
import type { CapturedImage } from '@/services/inspectionService';
import { extractText, type TextExtraction as Extraction } from '@/services/api';
import { cn } from '@/lib/utils';

/**
 * Text Extraction workbench.
 *
 * Shows the photograph the officer supplied next to the image the recogniser
 * actually read — after polarity correction, denoising, illumination
 * flattening, deskew and binarisation — with every line it recovered and the
 * confidence it had in each. Hovering a line highlights where on the original
 * it came from. This is the honest view of what OCR can and cannot see.
 */

const LEVEL_TONE = {
  GOOD: 'green',
  MARGINAL: 'amber',
  POOR: 'red',
} as const;

export default function TextExtraction() {
  const navigate = useNavigate();
  const toast = useToast();
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Extraction[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The screen renders whichever image's extraction is selected.
  const result: Extraction | null = results[activeIndex] ?? null;
  const [view, setView] = useState<'original' | 'processed'>('processed');
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);

  const image = images[activeIndex] ?? images[0];

  usePageChrome(
    {
      title: 'Text Extraction',
      subtitle: 'Read every printed line from a package photograph and see exactly what the recogniser saw',
      actions: result ? (
        <Button
          size="sm"
          icon={<ArrowRight size={13} />}
          onClick={() => navigate('/app/new-inspection', { state: { prefillImages: images } })}
        >
          <span className="hidden sm:inline">Use for inspection</span>
        </Button>
      ) : undefined,
    },
    [result !== null, images.length],
  );

  const run = async () => {
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    setResults([]);
    setActiveIndex(0);
    setActiveLine(null);
    setProgress({ done: 0, total: images.length });
    const collected: Extraction[] = [];
    try {
      // One image at a time: the recogniser is single-threaded on the server,
      // and reading them in order lets each result appear as it completes.
      for (const img of images) {
        const extraction = await extractText(img.dataUrl);
        collected.push(extraction);
        setResults([...collected]);
        setProgress({ done: collected.length, total: images.length });
      }
      const lines = collected.reduce((n, r) => n + r.lines.length, 0);
      const poor = collected.filter((r) => r.quality.level === 'POOR').length;
      const seconds = collected.reduce((n, r) => n + r.processingMs, 0) / 1000;
      if (poor === collected.length) {
        toast.warning('Low-quality read', 'None of the images were clear enough for reliable extraction.');
      } else {
        toast.success(
          `${lines} lines read from ${collected.length} image${collected.length === 1 ? '' : 's'}`,
          `${seconds.toFixed(1)} s total${poor ? ` · ${poor} image${poor === 1 ? '' : 's'} too poor to read` : ''}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The OCR service did not respond.');
    } finally {
      setBusy(false);
    }
  };

  const visibleLines = useMemo(
    () => (result ? result.lines.filter((l) => l.confidence * 100 >= minConfidence) : []),
    [result, minConfidence],
  );

  const copyText = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(visibleLines.map((l) => l.text).join('\n'));
    toast.success('Copied', `${visibleLines.length} lines copied to the clipboard.`);
  };

  return (
    <div className="space-y-4">
      {/* Input */}
      {results.length === 0 && !busy && (
        <Card>
          <CardHeader
            title="Package photographs"
            subtitle="Upload or capture every panel carrying printed declarations — each one is read"
            icon={<ScanText size={16} />}
          />
          <CardBody>
            <UploadZone images={images} onChange={setImages} max={8} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                onClick={() => void run()}
                disabled={images.length === 0 || busy}
              >
                {busy
                  ? `Reading image ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : images.length > 1
                    ? `Extract text from ${images.length} images`
                    : 'Extract text'}
              </Button>
              <p className="text-2xs leading-relaxed text-slate-500">
                Photograph the declarations panel from 15–20 cm, flat and parallel to the lens. If you cannot
                read the print on screen, neither can the recogniser.
              </p>
            </div>
            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                <CameraOff size={14} className="mt-0.5 shrink-0 text-red-700" />
                <p className="text-xs text-red-800">{error}</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {busy && (
        <div className="surface flex items-center gap-4 p-5">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
            <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brand-400" />
            <ScanText size={18} className="text-brand-700" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {progress.total > 1
                ? `Reading image ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                : 'Preprocessing and recognising'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Orientation → polarity → denoise → flatten illumination → deskew → binarise → upscale →
              recognise → refocus on the label if it is small in the frame. Typically 3–8 seconds per image.
            </p>
          </div>
        </div>
      )}

      {result && image && (
        <>
          {results.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Scanned images">
              {images.slice(0, results.length).map((img, i) => {
                const r = results[i];
                const active = i === activeIndex;
                return (
                  <button
                    key={img.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setActiveIndex(i);
                      setActiveLine(null);
                    }}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-md border p-1.5 pr-3 text-left transition-colors',
                      active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300',
                    )}
                  >
                    <img src={img.dataUrl} alt="" className="h-10 w-10 rounded object-cover" />
                    <span className="min-w-0">
                      <span className="block max-w-[10rem] truncate text-xs font-semibold text-slate-800">{img.name}</span>
                      <span className="block text-2xs text-slate-500">
                        {r.lines.length} lines · {(r.quality.meanConfidence * 100).toFixed(0)}% · {r.quality.level}
                      </span>
                    </span>
                  </button>
                );
              })}
              {busy && (
                <span className="flex shrink-0 items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-2xs text-slate-500">
                  <Loader2 size={12} className="animate-spin" /> reading image {progress.done + 1} of {progress.total}
                </span>
              )}
            </div>
          )}

          {/* Quality verdict */}
          <div
            className={cn(
              'surface border-l-4 px-4 py-3',
              result.quality.level === 'GOOD'
                ? 'border-l-emerald-500 bg-emerald-50/40'
                : result.quality.level === 'MARGINAL'
                  ? 'border-l-amber-500 bg-amber-50/50'
                  : 'border-l-red-600 bg-red-50/50',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                {result.quality.level === 'GOOD' ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
                ) : (
                  <CameraOff
                    size={16}
                    className={cn('mt-0.5 shrink-0', result.quality.level === 'POOR' ? 'text-red-700' : 'text-amber-700')}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">
                    {result.quality.level === 'GOOD'
                      ? `${result.lines.length} lines read at ${(result.quality.meanConfidence * 100).toFixed(0)}% confidence`
                      : result.quality.level === 'MARGINAL'
                        ? 'Readable, but with reservations'
                        : 'Image quality too low to rely on'}
                  </p>
                  {result.quality.advice && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">{result.quality.advice}</p>
                  )}
                  <p className="mt-1.5 font-mono text-2xs text-slate-500">
                    {result.imageWidth}×{result.imageHeight} · text ≈{result.quality.medianCapHeightPx}px ·{' '}
                    {result.quality.wordsRead} words · {result.quality.passUsed}
                    {result.quality.refocused ? ' · refocused on label' : ''} · {result.processingMs} ms
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={LEVEL_TONE[result.quality.level]}>{result.quality.level}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<RefreshCcw size={13} />}
                  onClick={() => {
                    setResults([]);
                    setImages([]);
                    setActiveIndex(0);
                  }}
                >
                  New images
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
            {/* Image comparison */}
            <Card className="overflow-hidden">
              <CardHeader
                title={view === 'processed' ? 'What the recogniser saw' : 'Original photograph'}
                subtitle={
                  view === 'processed'
                    ? `${result.preprocessing.variantUsed} variant · ${result.preprocessing.stages.length} stages applied`
                    : `${result.imageWidth}×${result.imageHeight} px as supplied`
                }
                dense
                actions={
                  <div className="flex overflow-hidden rounded-md border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setView('original')}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 text-2xs font-semibold transition-colors',
                        view === 'original' ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                      )}
                      aria-pressed={view === 'original'}
                    >
                      <Eye size={12} /> Original
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('processed')}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 text-2xs font-semibold transition-colors',
                        view === 'processed' ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                      )}
                      aria-pressed={view === 'processed'}
                    >
                      <EyeOff size={12} /> Processed
                    </button>
                  </div>
                }
              />
              <CardBody className="p-3">
                <div className="relative overflow-hidden rounded-md border border-slate-300 bg-slate-900">
                  <img
                    src={view === 'processed' ? result.preprocessing.previewDataUrl : image.dataUrl}
                    alt={view === 'processed' ? 'Preprocessed image read by OCR' : 'Original photograph'}
                    className="w-full object-contain"
                  />
                  {/* Line boxes are in original-image space; only drawn on the original. */}
                  {view === 'original' &&
                    visibleLines.map((line, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseEnter={() => setActiveLine(i)}
                        onMouseLeave={() => setActiveLine(null)}
                        onClick={() => setActiveLine(activeLine === i ? null : i)}
                        aria-label={line.text}
                        className={cn(
                          'absolute rounded-[2px] border transition-all',
                          activeLine === i
                            ? 'z-10 border-accent-400 bg-accent-400/25 ring-2 ring-white/70'
                            : 'border-emerald-400/70 bg-emerald-400/10 hover:bg-emerald-400/25',
                        )}
                        style={{
                          left: `${line.box.x * 100}%`,
                          top: `${line.box.y * 100}%`,
                          width: `${line.box.w * 100}%`,
                          height: `${line.box.h * 100}%`,
                        }}
                      />
                    ))}
                </div>

                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="label-text mb-1.5">Preprocessing applied</p>
                  <ol className="flex flex-wrap gap-1.5">
                    {result.preprocessing.stages.map((stage, i) => (
                      <li
                        key={i}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-2xs text-slate-600"
                      >
                        {stage}
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                    {result.preprocessing.quarterTurns
                      ? `The text was photographed sideways and the image has been turned ${result.preprocessing.quarterTurns * 90}° to read left-to-right. `
                      : ''}
                    {result.preprocessing.greyMethod === 'pca'
                      ? 'The print and panel colours were separated with a colour projection (PCA) because plain luminance left them too similar. '
                      : ''}
                    {result.preprocessing.perspectiveKeystone > 0
                      ? `The panel was photographed off-axis (${(result.preprocessing.perspectiveKeystone * 100).toFixed(1)}% keystone) and has been rectified to a flat rectangle. `
                      : ''}
                    {result.preprocessing.inverted
                      ? 'Light print on a dark surface was detected and inverted so the recogniser sees dark ink on paper. '
                      : ''}
                    {result.preprocessing.skewDeg !== 0
                      ? `The text lines were tilted ${Math.abs(result.preprocessing.skewDeg).toFixed(1)}° and have been levelled. `
                      : ''}
                    Uneven lighting is divided out, noise is removed with a median filter, and the image is
                    upscaled ×{result.preprocessing.upscale} so small print has enough pixels to recognise.
                  </p>
                </div>
              </CardBody>
            </Card>

            {/* Extracted lines */}
            <Card className="flex flex-col overflow-hidden xl:max-h-[calc(100vh-15rem)]">
              <CardHeader
                title="Extracted text"
                subtitle={`${visibleLines.length} of ${result.lines.length} lines shown`}
                dense
                actions={
                  <Button size="sm" variant="outline" icon={<Copy size={13} />} onClick={() => void copyText()}>
                    Copy
                  </Button>
                }
              />
              <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
                <label htmlFor="minConf" className="text-2xs font-semibold text-slate-600">
                  Min. confidence
                </label>
                <input
                  id="minConf"
                  type="range"
                  min={0}
                  max={95}
                  step={5}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="flex-1 accent-brand-700"
                />
                <span className="w-10 text-right font-mono text-2xs text-slate-700">{minConfidence}%</span>
              </div>

              {visibleLines.length === 0 ? (
                <EmptyState
                  title="No lines at this confidence"
                  description="Lower the threshold, or re-capture the image closer to the label."
                />
              ) : (
                <ol className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
                  {visibleLines.map((line, i) => {
                    const pct = Math.round(line.confidence * 100);
                    return (
                      <li
                        key={i}
                        onMouseEnter={() => setActiveLine(i)}
                        onMouseLeave={() => setActiveLine(null)}
                        className={cn(
                          'flex items-start gap-3 px-4 py-2 transition-colors',
                          activeLine === i ? 'bg-brand-50' : 'hover:bg-slate-50',
                        )}
                      >
                        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-2xs text-slate-400">{i + 1}</span>
                        <span className="min-w-0 flex-1 break-words font-mono text-xs leading-relaxed text-slate-900">
                          {line.text}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 font-mono text-2xs font-semibold',
                            pct >= 85
                              ? 'bg-emerald-50 text-emerald-800'
                              : pct >= 65
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-red-50 text-red-800',
                          )}
                          title="Recogniser confidence"
                        >
                          {pct}%
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setView('original');
                            setActiveLine(i);
                          }}
                          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-brand-700"
                          aria-label="Show on image"
                        >
                          <Crosshair size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5">
                <p className="label-text mb-1">Raw text</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed text-slate-700">
                  {visibleLines.map((l) => l.text).join('\n')}
                </pre>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
