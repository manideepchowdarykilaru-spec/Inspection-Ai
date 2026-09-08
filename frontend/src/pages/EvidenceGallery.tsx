import { useState } from 'react';
import { Images, Search } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { Input, Select } from '@/components/ui/Form';
import { KpiCard } from '@/components/ui/KpiCard';
import { EvidenceGrid } from '@/components/inspection/EvidenceGrid';
import { EVIDENCE_TYPE_LABEL } from '@/components/inspection/UploadZone';
import { listEvidence } from '@/services/inspectionService';
import type { EvidenceType } from '@shared/types';

export default function EvidenceGallery() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'ALL' | EvidenceType>('ALL');

  const all = useDatabase(() => listEvidence(), []);
  const rows = all.filter((e) => {
    if (type !== 'ALL' && e.type !== type) return false;
    if (!search.trim()) return true;
    return `${e.id} ${e.inspectionId} ${e.description} ${e.uploadedBy}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  });

  usePageChrome(
    {
      title: 'Evidence Gallery',
      subtitle: 'Every image captured during inspection, with its chain-of-custody metadata',
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Evidence items" value={all.length} icon={<Images size={17} />} tone="navy" />
        <KpiCard
          label="Label panels"
          value={all.filter((e) => e.type === 'LABEL_PHOTO').length}
          tone="blue"
        />
        <KpiCard label="MRP close-ups" value={all.filter((e) => e.type === 'MRP_PHOTO').length} tone="amber" />
        <KpiCard
          label="Linked inspections"
          value={new Set(all.map((e) => e.inspectionId)).size}
          tone="slate"
        />
      </div>

      <div className="surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by evidence ID, inspection ID, description or officer…"
              className="pl-9"
              aria-label="Search evidence"
            />
          </div>
          <Select
            className="w-auto min-w-[12rem]"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            aria-label="Filter by evidence type"
          >
            <option value="ALL">All evidence types</option>
            {(Object.keys(EVIDENCE_TYPE_LABEL) as EvidenceType[]).map((t) => (
              <option key={t} value={t}>
                {EVIDENCE_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <EvidenceGrid evidence={rows} showInspectionLink />
    </div>
  );
}
