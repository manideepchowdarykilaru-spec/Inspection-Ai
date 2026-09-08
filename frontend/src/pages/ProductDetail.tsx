import { useNavigate, useParams, Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertOctagon, ArrowLeft, Barcode, ScanLine } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { AXIS_PROPS, ChartCard, ChartTooltip, CHART_COLORS, GRID_PROPS } from '@/components/charts/ChartCard';
import { complianceHistory, getProduct, productInspections } from '@/services/productService';
import { resolveImage } from '@/services/imageService';
import { formatCurrency, formatDate } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { Inspection } from '@shared/types';

export default function ProductDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const product = useDatabase(() => getProduct(id), [id]);
  const inspections = useDatabase(() => productInspections(id), [id]);
  const history = useDatabase(() => complianceHistory(id), [id]);

  usePageChrome(
    {
      title: product?.name ?? 'Product',
      subtitle: product ? `${product.brand} · ${product.category}` : undefined,
      actions: (
        <Button size="sm" variant="outline" icon={<ArrowLeft size={13} />} onClick={() => navigate('/app/products')}>
          <span className="hidden sm:inline">Back to repository</span>
        </Button>
      ),
    },
    [product?.id],
  );

  if (!product) {
    return (
      <EmptyState
        title="Product not found"
        description="This commodity is not present in the repository."
        action={
          <Button size="sm" variant="outline" onClick={() => navigate('/app/products')}>
            Back to repository
          </Button>
        }
      />
    );
  }

  const columns: Column<Inspection>[] = [
    {
      key: 'id',
      header: 'Inspection',
      render: (r) => <span className="font-mono text-xs font-semibold text-navy-900">{r.id}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sortValue: (r) => r.inspectedAt,
      render: (r) => <span className="whitespace-nowrap text-xs text-slate-600">{formatDate(r.inspectedAt)}</span>,
    },
    {
      key: 'inspector',
      header: 'Inspector',
      hideOnMobile: true,
      render: (r) => <span className="text-xs text-slate-600">{r.inspectorName}</span>,
    },
    {
      key: 'location',
      header: 'Place',
      hideOnMobile: true,
      render: (r) => <span className="text-xs text-slate-600">{r.location}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      sortValue: (r) => r.screeningScore,
      render: (r) => <span className="font-mono text-sm font-bold text-slate-800">{r.screeningScore}</span>,
    },
    {
      key: 'findings',
      header: 'Findings',
      render: (r) => <span className="font-mono text-xs text-slate-700">{r.violations.length}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} size="sm" /> },
  ];

  const declarationRows: [string, string | undefined][] = [
    ['Manufacturer', product.manufacturer],
    ['Address', product.manufacturerAddress],
    ['Importer', product.importer],
    ['Country of origin', product.countryOfOrigin],
    ['Net quantity', product.netQuantity],
    ['Maximum retail price', product.mrp ? formatCurrency(product.mrp) : undefined],
    ['Month & year of packing', product.packedOn],
    ['Best before', product.bestBefore],
    ['Consumer care', product.consumerCare],
    ['FSSAI licence', product.fssaiLicense],
    ['Batch / lot', product.batchNumber],
    ['Barcode', product.barcode],
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <img
            src={resolveImage(product.imageId)}
            alt={product.name}
            className="w-full border-b border-slate-200 bg-slate-100 object-contain"
          />
          <CardBody className="space-y-3">
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">{product.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {product.brand} · {product.category}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {product.latestStatus && <StatusBadge status={product.latestStatus} />}
              {product.repeatOffender && (
                <Badge tone="red" icon={<AlertOctagon size={12} />}>
                  Flagged for repeat non-compliance
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
              {[
                ['Score', product.latestScore ?? '—'],
                ['Inspections', product.inspectionCount],
                ['Open findings', product.openViolations],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <p className="font-mono text-lg font-extrabold text-navy-900">{v}</p>
                  <p className="text-2xs text-slate-500">{k}</p>
                </div>
              ))}
            </div>
            <p className="flex items-center gap-1.5 border-t border-slate-100 pt-3 font-mono text-2xs text-slate-500">
              <Barcode size={13} /> {product.barcode}
            </p>
            <Button
              size="sm"
              className="w-full justify-center"
              icon={<ScanLine size={14} />}
              onClick={() => navigate('/app/new-inspection')}
            >
              Re-inspect this product
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Declared particulars" subtitle="As read from the most recent scan" dense />
          <CardBody className="space-y-2 p-4 text-xs">
            {declarationRows.map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
                <dd
                  className={cn(
                    'min-w-0 flex-1 break-words font-medium',
                    value ? 'text-slate-800' : 'italic text-slate-400',
                  )}
                >
                  {value ?? 'Not declared'}
                </dd>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        <ChartCard
          title="Compliance history"
          subtitle="Screening score across recorded inspections"
          question="Has this packer corrected the labelling defects previously flagged?"
          height={240}
        >
          {history.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} width={44} domain={[0, 100]} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="score"
                  name="Screening score"
                  stroke={CHART_COLORS.brand}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: CHART_COLORS.brand }}
                />
                <Line
                  type="monotone"
                  dataKey="violations"
                  name="Findings"
                  stroke={CHART_COLORS.amber}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              title="Only one inspection on record"
              description="A trend appears once this commodity has been inspected more than once."
            />
          )}
        </ChartCard>

        <Card className="overflow-hidden">
          <CardHeader
            title="Inspection history"
            subtitle={`${inspections.length} record(s) for this commodity`}
            dense
          />
          <DataTable
            columns={columns}
            rows={inspections}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/app/inspections/${r.id}`)}
            pageSize={6}
            dense
          />
        </Card>

        <Card>
          <CardHeader title="Previous findings" subtitle="Aggregated across all inspections of this product" dense />
          <CardBody className="space-y-2 p-4">
            {inspections.flatMap((i) =>
              i.violations.map((v) => (
                <Link
                  key={v.id}
                  to={`/app/inspections/${i.id}?finding=${v.id}`}
                  className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'mt-1 h-2 w-2 shrink-0 rounded-full',
                      v.severity === 'HIGH' ? 'bg-red-600' : v.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-brand-500',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800">{v.title}</span>
                    <span className="mt-0.5 block text-2xs text-slate-500">
                      {v.ruleId} · {i.id} · {formatDate(i.inspectedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-2xs font-medium text-slate-400">{v.state}</span>
                </Link>
              )),
            )}
            {inspections.every((i) => i.violations.length === 0) && (
              <EmptyState title="No findings recorded" description="This commodity has cleared every screening so far." />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
