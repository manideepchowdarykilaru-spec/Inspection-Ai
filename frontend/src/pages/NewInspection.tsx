import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  ScanText,
  Info,
  Layers,
  MapPin,
  PackageSearch,
  Play,
  Sparkles,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { UploadZone } from '@/components/inspection/UploadZone';
import { DEMO_CASES, demoImage } from '@shared/data/demoProducts';
import { REGIONS } from '@shared/data/mockData';
import type { ProductCategory } from '@shared/types';
import { PRODUCT_CATEGORIES } from '@shared/types';
import type { CapturedImage } from '@/services/inspectionService';
import { cn, uid } from '@/lib/utils';

const OUTCOME_TONE = {
  COMPLIANT: 'green',
  NEEDS_REVIEW: 'amber',
  NON_COMPLIANT: 'red',
} as const;

const OUTCOME_LABEL = {
  COMPLIANT: 'Expected: clears screening',
  NEEDS_REVIEW: 'Expected: manual review',
  NON_COMPLIANT: 'Expected: potential non-compliance',
} as const;

export default function NewInspection() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { user } = useAuth();
  const toast = useToast();

  const prefill = (routerLocation.state as { prefillImages?: CapturedImage[] } | null)?.prefillImages;
  const [selectedCase, setSelectedCase] = useState<string>(DEMO_CASES[0].id);
  const [images, setImages] = useState<CapturedImage[]>(prefill ?? []);
  const [location, setLocation] = useState('Retail outlet, Ameerpet, Hyderabad');
  const [region, setRegion] = useState(user?.region ?? REGIONS[0]);
  const [source, setSource] = useState<'PACKAGE_SCAN' | 'E_COMMERCE_LISTING' | 'MANUAL_ENTRY'>('PACKAGE_SCAN');
  const [listingUrl, setListingUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [panelWidthMm, setPanelWidthMm] = useState('');
  const [category, setCategory] = useState<ProductCategory>('Cereals & Grains');

  usePageChrome(
    {
      title: 'New Product Inspection',
      subtitle: 'Capture the package, run AI screening and record the findings',
    },
    [],
  );

  const activeCase = useMemo(() => DEMO_CASES.find((c) => c.id === selectedCase)!, [selectedCase]);

  const startScan = () => {
    const payload = {
      caseId: selectedCase,
      /** True when the scan runs on the seeded vector label rather than a photograph. */
      synthetic: images.length === 0,
      images:
        images.length > 0
          ? images
          : [
              {
                id: uid('img'),
                name: `${activeCase.productName} — principal display panel`,
                dataUrl: demoImage(activeCase.id),
                type: 'LABEL_PHOTO' as const,
                size: 184_320,
              },
            ],
      location,
      region,
      source,
      notes,
      listingUrl,
      // Enables absolute print-height measurement; omitted, the readability
      // rule reports that the scale is unknown instead of asserting a breach.
      panelWidthMm: images.length > 0 && panelWidthMm ? Number(panelWidthMm) : undefined,
      // OCR reads the name and manufacturer; the commodity category is the
      // officer’s call and cannot be inferred from the label text.
      category,
    };
    navigate('/app/analysis', { state: payload });
  };

  const manualInspection = () => {
    toast.info(
      'Manual inspection',
      'Manual entry lets an officer record declarations without an AI scan. Demonstrated here via the scan workspace with AI findings marked for verification.',
    );
    startScan();
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="1 · Package images"
            subtitle="Upload or capture the panels that carry the mandatory declarations"
            icon={<PackageSearch size={16} />}
            actions={
              <Badge tone="blue" size="sm">
                {images.length} uploaded
              </Badge>
            }
          />
          <CardBody>
            <UploadZone images={images} onChange={setImages} />
            {images.length > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <ScanText size={14} className="mt-0.5 shrink-0 text-emerald-700" />
                <p className="text-2xs leading-relaxed text-emerald-900">
                  The first image will be read by the OCR engine. Declarations, confidence scores and
                  evidence regions are extracted from that photograph — the demonstration samples below are
                  ignored.
                </p>
              </div>
            )}
            {images.length === 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2.5">
                <Info size={14} className="mt-0.5 shrink-0 text-brand-700" />
                <p className="text-2xs leading-relaxed text-brand-900">
                  No images uploaded yet — the scan will run against the selected demonstration sample below.
                  Upload or capture a real package photograph and the label is read by OCR instead, so the
                  declarations, evidence regions and readability metrics come from that image.
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="2 · Demonstration sample"
            subtitle={
              images.length > 0
                ? 'Not used — your uploaded photograph will be read by OCR'
                : 'Each sample carries a different labelling defect profile'
            }
            icon={<Sparkles size={16} />}
          />
          <CardBody className={cn('grid gap-3 sm:grid-cols-2', images.length > 0 && 'opacity-50')}>
            {DEMO_CASES.map((demo) => {
              const active = demo.id === selectedCase;
              return (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => setSelectedCase(demo.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex gap-3 rounded-lg border p-3 text-left transition-all',
                    active
                      ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <img
                    src={demoImage(demo.id)}
                    alt=""
                    className="h-20 w-16 shrink-0 rounded border border-slate-200 object-cover object-top"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-slate-900">{demo.title}</span>
                    <span className="mt-0.5 block truncate text-2xs text-slate-500">{demo.subtitle}</span>
                    <span className="mt-2 block">
                      <Badge tone={OUTCOME_TONE[demo.expectedOutcome]} size="sm">
                        {OUTCOME_LABEL[demo.expectedOutcome]}
                      </Badge>
                    </span>
                    <span className="mt-1.5 block text-2xs leading-relaxed text-slate-500">{demo.headline}</span>
                  </span>
                </button>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="3 · Inspection particulars"
            subtitle="Recorded on the inspection and the report"
            icon={<ClipboardList size={16} />}
          />
          <CardBody className="space-y-4">
            <Field label="Source of inspection" htmlFor="source">
              <Select id="source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="PACKAGE_SCAN">Physical package scan</option>
                <option value="E_COMMERCE_LISTING">E-commerce listing</option>
                <option value="MANUAL_ENTRY">Manual declaration entry</option>
              </Select>
            </Field>

            {source === 'E_COMMERCE_LISTING' && (
              <Field
                label="Listing URL"
                htmlFor="listing"
                hint="The listing page carrying the declared commodity information"
              >
                <Input
                  id="listing"
                  value={listingUrl}
                  onChange={(e) => setListingUrl(e.target.value)}
                  placeholder="https://…"
                />
              </Field>
            )}

            <Field label="Region / jurisdiction" htmlFor="region">
              <Select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Place of inspection" htmlFor="location" required>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Shop / godown name and locality"
              />
            </Field>

            <Field
              label="Product category"
              htmlFor="category"
              hint="Applied to inspections of uploaded photographs. The category cannot be read from the label."
            >
              <Select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductCategory)}
                disabled={images.length === 0}
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Panel width (mm)"
              htmlFor="panelWidth"
              hint="Optional. Measure the width of the photographed panel so print height can be reported in millimetres. Without it the readability rule defers to physical verification."
            >
              <Input
                id="panelWidth"
                type="number"
                min={10}
                max={2000}
                value={panelWidthMm}
                onChange={(e) => setPanelWidthMm(e.target.value)}
                placeholder="e.g. 150"
                disabled={images.length === 0}
              />
            </Field>

            <Field
              label="Field notes"
              htmlFor="notes"
              hint="Optional. Observations made at the time of capture."
            >
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Stock displayed for retail sale; three variants sampled."
              />
            </Field>

            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <MapPin size={13} className="mt-0.5 shrink-0 text-slate-500" />
              <p className="text-2xs leading-relaxed text-slate-600">
                Inspection will be recorded against <strong>{user?.name}</strong> ({user?.officialId}) with a
                timestamp and an evidence integrity digest for each image.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card className="border-navy-200 bg-navy-50/40">
          <CardBody className="space-y-3">
            <Button
              size="lg"
              className="w-full justify-center"
              icon={<Play size={16} />}
              onClick={startScan}
              disabled={!location.trim()}
            >
              Start AI Compliance Scan
            </Button>
            <Button
              size="md"
              variant="outline"
              className="w-full justify-center"
              icon={<Layers size={15} />}
              onClick={manualInspection}
            >
              Manual Inspection
            </Button>
            <p className="text-2xs leading-relaxed text-slate-500">
              The scan produces an AI screening result. It does not constitute a legal determination —
              findings must be verified by the inspecting officer before any action is proposed.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
