import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, FileBarChart, Search, Share2 } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { listReports, buildReportHtml, downloadEditableReport, setReportStatus } from '@/services/reportService';
import { getInspection } from '@/services/inspectionService';
import { formatDateTime } from '@shared/lib/format';
import type { Report, ReportStatus } from '@shared/types';

const STATUS_TONE: Record<ReportStatus, 'green' | 'blue' | 'slate' | 'amber'> = {
  FINALISED: 'green',
  SHARED: 'blue',
  DRAFT: 'amber',
  ARCHIVED: 'slate',
};

export default function Reports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | ReportStatus>('ALL');

  const all = useDatabase(() => listReports(), []);
  const rows = all.filter((r) => {
    if (status !== 'ALL' && r.status !== status) return false;
    if (!search.trim()) return true;
    return `${r.id} ${r.inspectionId} ${r.productName} ${r.brand} ${r.generatedBy}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  });

  usePageChrome(
    {
      title: 'Inspection Reports',
      subtitle: 'Generated compliance reports available for download, export and sharing',
    },
    [],
  );

  const download = (report: Report) => {
    const inspection = getInspection(report.inspectionId);
    if (!inspection || !user) return;
    downloadEditableReport(buildReportHtml(inspection, user, report.id), report.id);
    toast.success('Editable report exported', `${report.id}.doc downloaded — opens in Word or LibreOffice.`);
  };

  const columns: Column<Report>[] = [
    {
      key: 'id',
      header: 'Report ID',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-xs font-semibold text-navy-900">{r.id}</span>,
    },
    {
      key: 'inspection',
      header: 'Inspection ID',
      sortValue: (r) => r.inspectionId,
      render: (r) => <span className="font-mono text-2xs text-slate-600">{r.inspectionId}</span>,
    },
    {
      key: 'product',
      header: 'Product',
      sortValue: (r) => r.productName,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{r.productName}</p>
          <p className="truncate text-2xs text-slate-500">{r.brand}</p>
        </div>
      ),
    },
    {
      key: 'generated',
      header: 'Generated',
      sortValue: (r) => r.generatedAt,
      render: (r) => (
        <div className="whitespace-nowrap">
          <p className="text-xs text-slate-700">{formatDateTime(r.generatedAt)}</p>
          <p className="text-2xs text-slate-400">{r.generatedBy}</p>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: 'Screening outcome',
      hideOnMobile: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-slate-800">{r.screeningScore}</span>
          <StatusBadge status={r.complianceStatus} size="sm" />
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]} size="sm">
          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" aria-label="View report" onClick={() => navigate(`/app/reports/${r.id}`)}>
            <Eye size={14} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Download report" onClick={() => download(r)}>
            <Download size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Share report"
            onClick={() => {
              setReportStatus(r.id, 'SHARED');
              toast.success('Report shared', `${r.id} was shared with the supervisory officer.`);
            }}
          >
            <Share2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Reports generated" value={all.length} icon={<FileBarChart size={17} />} tone="navy" />
        <KpiCard label="Finalised" value={all.filter((r) => r.status === 'FINALISED').length} tone="green" />
        <KpiCard label="Shared with supervisor" value={all.filter((r) => r.status === 'SHARED').length} tone="blue" />
        <KpiCard
          label="Non-compliant outcomes"
          value={all.filter((r) => r.complianceStatus === 'NON_COMPLIANT').length}
          tone="red"
        />
      </div>

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by report ID, inspection ID or product…"
              className="pl-9"
              aria-label="Search reports"
            />
          </div>
          <Select
            className="w-auto min-w-[9rem]"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            <option value="FINALISED">Finalised</option>
            <option value="SHARED">Shared</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/app/reports/${r.id}`)}
          pageSize={12}
          emptyTitle="No reports generated yet"
          emptyDescription="Open an inspection and use Generate Report to produce a departmental compliance report."
        />
      </section>
    </div>
  );
}
