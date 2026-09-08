import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Check,
  RefreshCcw,
  SwitchCamera,
  Trash2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { cn, uid } from '@/lib/utils';

/**
 * Live camera capture for field inspection.
 *
 * Uses getUserMedia so an officer can photograph the package directly from the
 * workstation or a tablet, rather than relying on the mobile-only
 * `<input capture>` attribute. The stream is stopped on every exit path so the
 * device indicator never stays lit after the dialog closes.
 *
 * getUserMedia requires a secure context: it works on https:// and on
 * http://localhost, but not on a plain-http LAN address.
 */

export interface CapturedShot {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
  /** Variance of the Laplacian on a downscaled grey copy — low means blurred. */
  sharpness: number;
  blurry: boolean;
}

/**
 * Sharpness estimate: variance of a 3×3 Laplacian over a ~480 px grey copy.
 * Camera shake and missed focus are the commonest reasons a capture cannot be
 * read, and they are invisible on a small preview — so the shot is measured
 * the moment it is taken and flagged before it reaches the recogniser.
 */
function measureSharpness(source: HTMLCanvasElement): number {
  const scale = Math.min(1, 480 / Math.max(source.width, source.height));
  const w = Math.max(8, Math.round(source.width * scale));
  const h = Math.max(8, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Number.POSITIVE_INFINITY;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) {
    grey[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - w] - grey[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Below this the print is too soft for OCR; tuned on hand-held phone captures. */
const BLUR_THRESHOLD = 45;

type Phase = 'starting' | 'ready' | 'error';

/**
 * Longest edge of a captured frame.
 *
 * OCR needs roughly 20–30 px of cap height per word. On a package photographed
 * at arm's length the body text is a small fraction of the frame, so throwing
 * away resolution here is what makes a scan unreadable later. 2600 px keeps a
 * 4–5 MP capture intact while staying inside the JSON upload limit.
 */
const MAX_EDGE = 2600;
const JPEG_QUALITY = 0.94;

/** Below this the camera cannot resolve label text well enough to OCR. */
const LOW_RESOLUTION_WIDTH = 1280;

function describeError(error: unknown): { title: string; detail: string } {
  if (!window.isSecureContext) {
    return {
      title: 'Camera blocked by the browser',
      detail:
        'Camera access requires a secure context. Open the application over https:// or on http://localhost. Uploading a photograph from the device works on any address.',
    };
  }
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera permission denied',
        detail:
          'Permission was refused for this site. Allow camera access from the browser address bar (the camera icon), then press Retry.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'No camera found',
        detail:
          'No camera device is available on this machine. Connect a camera, or upload a photograph from the device instead.',
      };
    case 'NotReadableError':
      return {
        title: 'Camera is in use',
        detail:
          'Another application is holding the camera. Close it — video calls are the usual cause — and press Retry.',
      };
    default:
      return {
        title: 'Camera could not be started',
        detail:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred while starting the camera.',
      };
  }
}

export function CameraCapture({
  open,
  onClose,
  onConfirm,
  title = 'Capture package image',
  description = 'Get close enough that the printed declarations are clearly legible on screen — if you cannot read them here, neither can the OCR engine.',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (shots: CapturedShot[]) => void;
  title?: string;
  description?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [flash, setFlash] = useState(false);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    stop();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError({
        title: 'Camera not supported',
        detail:
          'This browser does not expose a camera API. Upload a photograph from the device instead.',
      });
      setPhase('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          // Ask for the sensor's full resolution; the browser clamps to what the
          // device can actually deliver.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          /* autoplay rejection is recovered by the muted+playsInline attributes */
        });
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      if (settings?.width && settings?.height) {
        setResolution({ w: settings.width, h: settings.height });
      }
      setPhase('ready');

      // Only offer the switch control when there is something to switch to.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (err) {
      stop();
      setError(describeError(err));
      setPhase('error');
    }
  }, [facing, stop]);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    void start();
    return stop;
  }, [open, start, stop]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || phase !== 'ready' || !video.videoWidth) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const sharpness = measureSharpness(canvas);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    setShots((prev) => [
      ...prev,
      {
        id: uid('shot'),
        name: `capture-${stamp}-${prev.length + 1}.jpg`,
        dataUrl,
        // Approximate byte size of the base64 payload.
        size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
        sharpness: Number(sharpness.toFixed(1)),
        blurry: sharpness < BLUR_THRESHOLD,
      },
    ]);

    setFlash(true);
    setTimeout(() => setFlash(false), 160);
  };

  const finish = () => {
    if (shots.length === 0) return;
    onConfirm(shots);
    setShots([]);
    onClose();
  };

  const dismiss = () => {
    setShots([]);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex flex-col bg-navy-950/95 backdrop-blur-sm no-print">
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-white">
            <Camera size={16} className="text-accent-400" />
            {title}
          </h2>
          <p className="mt-0.5 text-2xs leading-relaxed text-navy-200">{description}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-1.5 text-navy-200 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close camera"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        <div className="relative flex h-full w-full max-w-4xl items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview"
            className={cn(
              'h-full w-full object-contain transition-opacity',
              phase === 'ready' ? 'opacity-100' : 'opacity-0',
              facing === 'user' && '-scale-x-100',
            )}
          />

          {/* Framing guide */}
          {phase === 'ready' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[78%] w-[62%] max-w-md rounded-md border-2 border-dashed border-accent-400/50">
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-navy-950/80 px-2 py-0.5 text-2xs font-medium text-accent-400">
                  Fill the guide with the declarations panel — get close, keep the label flat
                </span>
              </div>
            </div>
          )}

          {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

          {phase === 'ready' && resolution && (
            <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
              <span className="rounded bg-navy-950/80 px-1.5 py-0.5 font-mono text-2xs text-white/80">
                {resolution.w}×{resolution.h}
              </span>
              {resolution.w < LOW_RESOLUTION_WIDTH && (
                <span className="max-w-[15rem] rounded bg-amber-500/90 px-1.5 py-1 text-2xs font-medium leading-snug text-navy-950">
                  Low-resolution camera. Move in close so the declarations panel fills the frame, or
                  upload a photograph taken on a phone instead.
                </span>
              )}
            </div>
          )}

          {phase === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-accent-400" />
              <p className="text-xs text-navy-200">Requesting camera access…</p>
              <p className="max-w-xs text-2xs text-navy-300">
                Allow the browser prompt to start the live preview.
              </p>
            </div>
          )}

          {phase === 'error' && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                <CameraOff size={22} />
              </span>
              <p className="text-sm font-semibold text-white">{error.title}</p>
              <p className="max-w-sm text-xs leading-relaxed text-navy-200">{error.detail}</p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" icon={<RefreshCcw size={13} />} onClick={() => void start()}>
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  onClick={dismiss}
                >
                  Upload a file instead
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Captured strip */}
      {shots.length > 0 && (
        <div className="border-t border-white/10 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-navy-300">
              Captured ({shots.length})
            </span>
            {shots.map((shot) => (
              <div key={shot.id} className="group relative shrink-0">
                <img
                  src={shot.dataUrl}
                  alt={shot.name}
                  className={cn(
                    'h-14 w-20 rounded border object-cover',
                    shot.blurry ? 'border-amber-400' : 'border-white/20',
                  )}
                />
                {shot.blurry && (
                  <span
                    className="absolute bottom-0.5 left-0.5 rounded bg-amber-500 px-1 text-[9px] font-bold uppercase text-navy-950"
                    title={`Sharpness ${shot.sharpness} — below ${BLUR_THRESHOLD}. Hold steady and refocus.`}
                  >
                    blurry
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShots((prev) => prev.filter((s) => s.id !== shot.id))}
                  className="absolute right-0.5 top-0.5 rounded bg-navy-950/80 p-0.5 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Discard ${shot.name}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          {hasMultipleCameras && (
            <Button
              size="sm"
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              icon={<SwitchCamera size={14} />}
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              disabled={phase !== 'ready'}
            >
              <span className="hidden sm:inline">Switch camera</span>
            </Button>
          )}
          <span className="hidden items-center gap-1.5 text-2xs text-navy-300 sm:inline-flex">
            <AlertTriangle size={11} />
            {shots.some((s) => s.blurry)
              ? 'A capture is flagged blurry — retake it before using it for OCR.'
              : 'Captures are stored as inspection evidence with a timestamp and integrity digest.'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
            onClick={dismiss}
          >
            Cancel
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon={<Camera size={16} />}
            onClick={capture}
            disabled={phase !== 'ready'}
          >
            Capture
          </Button>
          <Button size="sm" variant="success" icon={<Check size={14} />} onClick={finish} disabled={shots.length === 0}>
            {shots.length === 0
              ? 'Use photos'
              : `Use ${shots.length} photo${shots.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
