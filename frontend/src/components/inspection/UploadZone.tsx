import { useCallback, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import type { EvidenceType } from '@shared/types';
import { cn, uid } from '@/lib/utils';
import { prepareUpload } from '@/services/imageService';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { CameraCapture, type CapturedShot } from './CameraCapture';
import type { CapturedImage } from '@/services/inspectionService';

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  PRODUCT_PHOTO: 'Front package',
  LABEL_PHOTO: 'Principal display panel',
  MRP_PHOTO: 'MRP area',
  MANUFACTURER_DETAILS: 'Manufacturer details',
  BARCODE: 'Barcode / QR area',
  ADDITIONAL: 'Additional evidence',
};

const TYPE_SEQUENCE: EvidenceType[] = [
  'PRODUCT_PHOTO',
  'LABEL_PHOTO',
  'MRP_PHOTO',
  'MANUFACTURER_DETAILS',
  'BARCODE',
  'ADDITIONAL',
];

export function UploadZone({
  images,
  onChange,
  max = 8,
  className,
}: {
  images: CapturedImage[];
  onChange: (next: CapturedImage[]) => void;
  max?: number;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      // Some Android share sheets hand over files with no MIME type; let the
      // decoder decide rather than dropping them silently.
      const accepted = Array.from(files)
        .filter((f) => !f.type || f.type.startsWith('image/'))
        .slice(0, max - images.length);
      if (accepted.length < files.length) {
        toast.error(
          'Some files were skipped',
          `Only image files are accepted, up to ${max} per inspection.`,
        );
      }
      setPreparing(accepted.length);
      const next: CapturedImage[] = [];
      for (const file of accepted) {
        try {
          const prepared = await prepareUpload(file);
          next.push({
            id: uid('img'),
            name: file.name,
            dataUrl: prepared.dataUrl,
            type: TYPE_SEQUENCE[Math.min(images.length + next.length, TYPE_SEQUENCE.length - 1)],
            size: prepared.size,
          });
        } catch {
          toast.error(
            `Could not read ${file.name}`,
            'Use a JPG or PNG photograph. iPhone HEIC images are not supported — set Settings → Camera → Formats to "Most Compatible", or share the photo as a JPEG.',
          );
        } finally {
          setPreparing((n) => Math.max(0, n - 1));
        }
      }
      if (next.length) onChange([...images, ...next]);
    },
    [images, max, onChange, toast],
  );

  const ingestShots = useCallback(
    (shots: CapturedShot[]) => {
      const accepted = shots.slice(0, max - images.length);
      onChange([
        ...images,
        ...accepted.map((shot, i) => ({
          id: shot.id,
          name: shot.name,
          dataUrl: shot.dataUrl,
          type: TYPE_SEQUENCE[Math.min(images.length + i, TYPE_SEQUENCE.length - 1)],
          size: shot.size,
        })),
      ]);
    },
    [images, max, onChange],
  );

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest(e.dataTransfer.files);
        }}
        className={cn(
          'relative rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-8',
          dragging ? 'border-brand-500 bg-brand-50/70' : 'border-slate-300 bg-slate-50/60 hover:border-slate-400',
        )}
      >
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm ring-1 ring-slate-200">
          <UploadCloud size={20} />
        </span>
        <p className="text-sm font-semibold text-slate-800">
          Drag package images here, or select files to upload
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
          Capture the front panel, the principal display panel carrying the mandatory declarations, the MRP
          area, manufacturer details and the barcode. JPG or PNG, up to {max} images.
        </p>
        {preparing > 0 && (
          <p className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-brand-700" role="status">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            Preparing {preparing} {preparing === 1 ? 'image' : 'images'}…
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="secondary" icon={<ImagePlus size={14} />} onClick={() => inputRef.current?.click()}>
            Upload images
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<Camera size={14} />}
            onClick={() => setCameraOpen(true)}
            disabled={images.length >= max}
          >
            Capture with camera
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Upload package images"
          onChange={(e) => {
            void ingest(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onConfirm={ingestShots}
      />

      {images.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <figure key={img.id} className="surface group relative overflow-hidden">
              <img src={img.dataUrl} alt={img.name} className="aspect-[4/3] w-full object-cover" />
              <figcaption className="space-y-1.5 p-2">
                <select
                  value={img.type}
                  aria-label={`Evidence type for ${img.name}`}
                  onChange={(e) =>
                    onChange(
                      images.map((i) =>
                        i.id === img.id ? { ...i, type: e.target.value as EvidenceType } : i,
                      ),
                    )
                  }
                  className="w-full rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-2xs font-semibold text-slate-700 focus:border-brand-600 focus:outline-none"
                >
                  {TYPE_SEQUENCE.map((t) => (
                    <option key={t} value={t}>
                      {EVIDENCE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <p className="truncate text-2xs text-slate-400" title={img.name}>
                  {img.name}
                </p>
              </figcaption>
              <button
                type="button"
                onClick={() => onChange(images.filter((i) => i.id !== img.id))}
                aria-label={`Remove ${img.name}`}
                className="absolute right-1.5 top-1.5 rounded bg-navy-950/70 p-1.5 text-white transition-opacity hover:bg-red-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
