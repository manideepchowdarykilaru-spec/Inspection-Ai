import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Download, Fingerprint, Maximize2, Plus, Trash2 } from 'lucide-react';
import type { Evidence } from '@shared/types';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@shared/lib/format';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { EVIDENCE_TYPE_LABEL } from './UploadZone';
import { CameraCapture, type CapturedShot } from './CameraCapture';
import { resolveImage, prepareUpload } from '@/services/imageService';
import { addEvidence, removeEvidence } from '@/services/inspectionService';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export function EvidenceGrid({
  evidence,
  inspectionId,
  allowUpload,
  showInspectionLink,
  className,
}: {
  evidence: Evidence[];
  inspectionId?: string;
  allowUpload?: boolean;
  showInspectionLink?: boolean;
  className?: string;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [preview, setPreview] = useState<Evidence | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Evidence | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !inspectionId) return;
    let added = 0;
    for (const file of Array.from(files)) {
      if (file.type && !file.type.startsWith('image/')) continue;
      try {
        const prepared = await prepareUpload(file);
        addEvidence(
          inspectionId,
          {
            name: file.name,
            dataUrl: prepared.dataUrl,
            type: 'ADDITIONAL',
            description: file.name,
            size: prepared.size,
          },
          user?.name ?? 'Officer',
        );
        added += 1;
      } catch {
        toast.error(`Could not read ${file.name}`, 'Use a JPG or PNG photograph; HEIC images are not supported.');
      }
    }
    if (added) toast.success('Evidence added', 'The item is linked to this inspection with an integrity digest.');
  };

  const addShots = (shots: CapturedShot[]) => {
    if (!inspectionId) return;
    shots.forEach((shot) =>
      addEvidence(
        inspectionId,
        {
          name: shot.name,
          dataUrl: shot.dataUrl,
          type: 'ADDITIONAL',
          description: 'Captured on device during inspection',
          size: shot.size,
        },
        user?.name ?? 'Officer',
      ),
    );
    toast.success(
      `${shots.length} image(s) captured`,
      'Each capture is linked to this inspection with a timestamp and integrity digest.',
    );
  };

  if (evidence.length === 0 && !allowUpload) {
    return <EmptyState title="No evidence recorded" description="Evidence images captured during inspection appear here." />;
  }

  return (
    <div className={className}>
      {allowUpload && inspectionId && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-4 py-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Evidence chain of custody</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {evidence.length} item(s) · each carries a capture timestamp, the uploading officer and an
              integrity digest
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" icon={<Camera size={13} />} onClick={() => setCameraOpen(true)}>
              Capture
            </Button>
            <Button size="sm" variant="outline" icon={<Plus size={13} />} onClick={() => inputRef.current?.click()}>
              Add evidence
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Add evidence images"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {evidence.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="Add photographs of the package, the declarations panel and the barcode area."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {evidence.map((item) => {
            const src = item.dataUrl ?? resolveImage(item.imageId);
            return (
              <figure key={item.id} className="surface group flex flex-col overflow-hidden">
                <div className="relative">
                  <img src={src} alt={item.description} className="aspect-[4/3] w-full bg-slate-100 object-cover object-top" />
                  <span className="absolute left-2 top-2 rounded bg-navy-950/80 px-1.5 py-0.5 font-mono text-2xs font-semibold text-white">
                    {item.evidenceNumber}
                  </span>
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      className="rounded bg-navy-950/80 p-1.5 text-white hover:bg-navy-900"
                      aria-label="View full screen"
                    >
                      <Maximize2 size={13} />
                    </button>
                    <a
                      href={src}
                      download={`${item.id}.png`}
                      className="rounded bg-navy-950/80 p-1.5 text-white hover:bg-navy-900"
                      aria-label="Download evidence"
                    >
                      <Download size={13} />
                    </a>
                    {allowUpload && (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(item)}
                        className="rounded bg-navy-950/80 p-1.5 text-white hover:bg-red-700"
                        aria-label="Delete evidence"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <figcaption className="flex flex-1 flex-col gap-1.5 p-3">
                  <span className="inline-flex w-fit rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-2xs font-semibold text-slate-600">
                    {EVIDENCE_TYPE_LABEL[item.type]}
                  </span>
                  <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{item.description}</p>
                  <p className="mt-auto text-2xs text-slate-400">
                    {formatDateTime(item.capturedAt)} · {item.uploadedBy}
                  </p>
                  {showInspectionLink && (
                    <Link
                      to={`/app/inspections/${item.inspectionId}`}
                      className="font-mono text-2xs font-semibold text-brand-700 hover:underline"
                    >
                      {item.inspectionId}
                    </Link>
                  )}
                  <p
                    className="truncate font-mono text-[10px] text-slate-300"
                    title={`SHA-256 ${item.checksum}`}
                  >
                    <Fingerprint size={9} className="mr-1 inline" />
                    {item.checksum.slice(0, 24)}…
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? `${preview.evidenceNumber} · ${EVIDENCE_TYPE_LABEL[preview.type]}` : ''}
        description={preview?.description}
        size="xl"
      >
        {preview && (
          <div className="space-y-3">
            <img
              src={preview.dataUrl ?? resolveImage(preview.imageId)}
              alt={preview.description}
              className="max-h-[60vh] w-full rounded border border-slate-200 object-contain"
            />
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                ['Evidence ID', preview.id],
                ['Inspection', preview.inspectionId],
                ['Captured', formatDateTime(preview.capturedAt)],
                ['Uploaded by', preview.uploadedBy],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
                  <dd className="min-w-0 flex-1 font-medium text-slate-800">{v}</dd>
                </div>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <dt className="w-24 shrink-0 text-slate-500">Digest</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-2xs text-slate-500">{preview.checksum}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onConfirm={addShots}
        title="Capture evidence"
        description="Photograph the package panel, the price declaration or any other supporting evidence."
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            removeEvidence(pendingDelete.id, user?.name ?? 'Officer');
            toast.warning('Evidence removed', `${pendingDelete.evidenceNumber} was removed and the action logged.`);
          }
        }}
        title="Remove evidence item?"
        message="The item will be detached from this inspection. The removal is recorded in the audit trail."
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}
