import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Move, Plus, RotateCcw } from 'lucide-react';
import type { RuleResult } from '@shared/types';
import { cn, clamp } from '@/lib/utils';

export type AnnotationTone = 'valid' | 'review' | 'violation';

export interface Annotation {
  id: string;
  /** Image the region was read from — a package is usually several panels. */
  imageId: string;
  label: string;
  tone: AnnotationTone;
  box: { x: number; y: number; w: number; h: number };
  detail?: string;
}

const TONE_CLASS: Record<AnnotationTone, { border: string; bg: string; chip: string }> = {
  valid: { border: 'border-emerald-500', bg: 'bg-emerald-500/10', chip: 'bg-emerald-600' },
  review: { border: 'border-amber-500', bg: 'bg-amber-400/15', chip: 'bg-amber-500' },
  violation: { border: 'border-red-600', bg: 'bg-red-500/15', chip: 'bg-red-600' },
};

export function annotationsFromRules(results: RuleResult[]): Annotation[] {
  const seen = new Map<string, Annotation>();
  results.forEach((r) => {
    if (!r.evidenceRegion) return;
    const tone: AnnotationTone =
      r.status === 'FAIL' ? 'violation' : r.status === 'REVIEW' ? 'review' : 'valid';
    const existing = seen.get(r.evidenceRegion.id);
    // A region shows the most serious verdict recorded against it.
    const rank = { valid: 0, review: 1, violation: 2 };
    if (!existing || rank[tone] > rank[existing.tone]) {
      seen.set(r.evidenceRegion.id, {
        id: r.evidenceRegion.id,
        imageId: r.evidenceRegion.imageId,
        label: r.evidenceRegion.label,
        tone,
        box: r.evidenceRegion.box,
        detail: r.ruleName,
      });
    }
  });
  return Array.from(seen.values());
}

export function ImageAnnotator({
  src,
  annotations,
  activeId,
  onSelect,
  className,
  showLegend = true,
  caption,
  scanning,
}: {
  src: string;
  annotations: Annotation[];
  activeId?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  showLegend?: boolean;
  caption?: string;
  scanning?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  // Where the photograph actually sits inside the viewport. The image is
  // letter-boxed (object-contain), so a wide banner fills a band across the
  // middle and a tall pouch a column down the centre; region boxes are
  // fractions of the photograph and must be placed inside that band, never
  // stretched over the dark surround.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState({ x: 0, y: 0, w: 1, h: 1 });

  const measure = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect();
    const img = imageRef.current;
    if (!box || !img || !img.naturalWidth || !img.naturalHeight || !box.width || !box.height) return;
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const w = (img.naturalWidth * scale) / box.width;
    const h = (img.naturalHeight * scale) / box.height;
    setFrame({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }, []);

  useEffect(() => {
    measure();
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, src, fullscreen]);

  const place = (box: Annotation['box']) => ({
    left: `${(frame.x + box.x * frame.w) * 100}%`,
    top: `${(frame.y + box.y * frame.h) * 100}%`,
    width: `${box.w * frame.w * 100}%`,
    height: `${box.h * frame.h * 100}%`,
  });

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Centre the selected region in the viewport when a finding is clicked.
  useEffect(() => {
    if (!activeId) return;
    const annotation = annotations.find((a) => a.id === activeId);
    if (!annotation) return;
    const nextZoom = 1.85;
    const cx = frame.x + (annotation.box.x + annotation.box.w / 2) * frame.w;
    const cy = frame.y + (annotation.box.y + annotation.box.h / 2) * frame.h;
    setZoom(nextZoom);
    setOffset({
      x: (0.5 - cx) * 100 * nextZoom,
      y: (0.5 - cy) * 100 * nextZoom,
    });
  }, [activeId, annotations, frame]);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = ((e.clientX - dragStart.current.x) / 4) * 1;
    const dy = ((e.clientY - dragStart.current.y) / 4) * 1;
    setOffset({
      x: clamp(dragStart.current.ox + dx, -60 * zoom, 60 * zoom),
      y: clamp(dragStart.current.oy + dy, -60 * zoom, 60 * zoom),
    });
  };

  const viewer = (
    <div
      ref={viewportRef}
      className={cn(
        'relative overflow-hidden rounded-md border border-slate-300 bg-slate-900',
        fullscreen ? 'h-full w-full' : 'aspect-[4/5] w-full',
      )}
    >
      <div
        className={cn('absolute inset-0 origin-center transition-transform duration-300 ease-out', dragging && 'transition-none')}
        style={{ transform: `scale(${zoom}) translate(${offset.x / zoom}%, ${offset.y / zoom}%)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <img
          ref={imageRef}
          src={src}
          alt="Scanned package label with AI detection overlay"
          className="h-full w-full select-none object-contain"
          draggable={false}
          onLoad={measure}
        />
        {annotations.map((a) => {
          const tone = TONE_CLASS[a.tone];
          const isActive = activeId === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(isActive ? null : a.id);
              }}
              aria-label={`${a.label} — ${a.tone}`}
              className={cn(
                'absolute rounded-[3px] border-2 transition-all duration-200',
                tone.border,
                tone.bg,
                isActive ? 'z-20 ring-2 ring-white/80 ring-offset-1 ring-offset-slate-900' : 'z-10 hover:brightness-125',
                !isActive && activeId ? 'opacity-45' : 'opacity-100',
              )}
              style={place(a.box)}
            >
              {/* Labels are shown for findings and for the selected region only —
                  a chip on every valid declaration makes the overlay unreadable. */}
              {a.tone !== 'valid' || isActive ? (
                <span
                  className={cn(
                    'absolute -top-[1px] left-0 -translate-y-full whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow',
                    tone.chip,
                  )}
                >
                  {a.label}
                </span>
              ) : (
                <span
                  className={cn('absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full', tone.chip)}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {scanning && (
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
          <div className="absolute inset-x-0 h-24 animate-scan-sweep bg-gradient-to-b from-transparent via-accent-400/30 to-transparent" />
          <div className="absolute inset-0 border-2 border-accent-400/40" />
        </div>
      )}

      <div className="absolute bottom-2 right-2 z-30 flex items-center gap-1 rounded-md border border-white/15 bg-navy-950/85 p-1 backdrop-blur">
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(Number((z - 0.25).toFixed(2)), 1, 4))}
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Zoom out"
        >
          <Minus size={13} />
        </button>
        <span className="min-w-[2.6rem] text-center font-mono text-2xs text-white/80">{zoom.toFixed(2)}×</span>
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(Number((z + 0.25).toFixed(2)), 1, 4))}
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Zoom in"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            onSelect?.(null);
          }}
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Reset view"
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          onClick={() => setFullscreen((f) => !f)}
          className="rounded p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={fullscreen ? 'Exit full screen' : 'View full screen'}
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {zoom > 1 && (
        <span className="pointer-events-none absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded bg-navy-950/80 px-1.5 py-0.5 text-2xs text-white/75">
          <Move size={10} /> Drag to pan
        </span>
      )}
    </div>
  );

  return (
    <div className={className}>
      {viewer}

      {showLegend && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-slate-600">
          <LegendItem className="bg-emerald-500" label="Valid declaration" />
          <LegendItem className="bg-amber-500" label="Needs review" />
          <LegendItem className="bg-red-600" label="Potential violation" />
          {caption && <span className="ml-auto text-slate-400">{caption}</span>}
        </div>
      )}

      {fullscreen && (
        <div className="fixed inset-0 z-[95] flex flex-col bg-navy-950/95 p-4 no-print">
          <div className="mb-3 flex items-center justify-between text-white">
            <p className="text-sm font-semibold">Evidence viewer</p>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="rounded border border-white/20 px-3 py-1 text-xs transition-colors hover:bg-white/10"
            >
              Close (Esc)
            </button>
          </div>
          <div className="min-h-0 flex-1">{viewer}</div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-sm', className)} />
      {label}
    </span>
  );
}
