import { Info, Ruler } from 'lucide-react';
import type { Declaration, OcrResult } from '@shared/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE = {
  GOOD: { label: 'Good', className: 'bg-emerald-50 text-emerald-800 border-emerald-200', bar: 'bg-emerald-500' },
  REVIEW: { label: 'Needs Review', className: 'bg-amber-50 text-amber-900 border-amber-200', bar: 'bg-amber-500' },
  POOR: { label: 'Below Threshold', className: 'bg-red-50 text-red-800 border-red-200', bar: 'bg-red-600' },
} as const;

export function ReadabilityPanel({
  declarations,
  ocr,
  className,
}: {
  declarations: Declaration[];
  ocr?: OcrResult;
  className?: string;
}) {
  const rows = declarations.filter((d) => d.detectedValue && d.readability);
  if (rows.length === 0) return null;

  const minMm = rows[0].readability!.requiredMinMm;
  const scaleEstablished = rows.some((d) => d.readability!.scaleKnown);

  return (
    <div className={cn('surface overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Ruler size={15} className="text-brand-700" />
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Readability Analysis</h2>
        </div>
        {ocr && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-slate-500">
            <span>
              {ocr.imageWidth}×{ocr.imageHeight} px
            </span>
            <span>{ocr.estimatedDpi > 0 ? `${ocr.estimatedDpi} dpi` : 'dpi unknown'}</span>
            <span>threshold {minMm} mm</span>
            {!scaleEstablished && <span className="text-amber-700">scale not established</span>}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-2xs font-bold uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-2 text-left">Declaration</th>
              <th scope="col" className="px-4 py-2 text-right">Text height</th>
              <th scope="col" className="px-4 py-2 text-right">Est. size</th>
              <th scope="col" className="px-4 py-2 text-right">Contrast</th>
              <th scope="col" className="px-4 py-2 text-right">OCR conf.</th>
              <th scope="col" className="px-4 py-2 text-left">Readability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const r = d.readability!;
              const style = STATUS_STYLE[r.status];
              const ratio = Math.min(1.6, r.estimatedMm / r.requiredMinMm);
              return (
                <tr key={d.key} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{d.label}</p>
                    {r.scaleKnown && (
                      <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn('h-full rounded-full', style.bar)}
                          style={{ width: `${(ratio / 1.6) * 100}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{r.textHeightPx} px</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {r.scaleKnown ? (
                      <>
                        <span className={cn(r.status === 'POOR' ? 'font-semibold text-red-700' : 'text-slate-700')}>
                          {r.estimatedMm} mm
                        </span>
                        <span className="ml-1 text-slate-400">/ {r.estimatedFontPt} pt</span>
                      </>
                    ) : (
                      <span className="text-slate-400" title="No scale reference was recorded for this image">
                        no scale
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                    {r.contrastRatio.toFixed(1)}:1
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                    {(r.ocrConfidence * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-2xs font-semibold', style.className)}>
                      {style.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 border-t border-slate-200 bg-amber-50/60 px-4 py-3">
        <Info size={14} className="mt-0.5 shrink-0 text-amber-700" />
        <p className="text-2xs leading-relaxed text-amber-900">
          {scaleEstablished ? (
            <>
              Print height is derived from the detected text box and the panel width recorded for this
              inspection. The estimate carries a tolerance of roughly ±15% and varies with camera angle and
              lens distortion. Any finding based on print height must be confirmed by physical measurement of
              the package before a determination is recorded.
            </>
          ) : (
            <>
              No scale reference was recorded for this image, so print height is reported in pixels only — a
              photograph carries no inherent physical scale. Contrast, legibility and OCR confidence are
              still measured from the image. To obtain millimetres, record the panel width when creating the
              inspection, or measure the declaration on the package directly.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
