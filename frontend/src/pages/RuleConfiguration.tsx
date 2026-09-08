import { useState } from 'react';
import { BookOpen, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDatabase } from '@/hooks/useDatabase';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Toggle } from '@/components/ui/Form';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { KpiCard } from '@/components/ui/KpiCard';
import { listRules, toggleRule, updateRule, updateRuleParam } from '@/services/ruleService';
import { formatDateTime } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { ComplianceRule, Severity } from '@shared/types';

export default function RuleConfiguration() {
  const { user } = useAuth();
  const toast = useToast();
  const rules = useDatabase(() => listRules(), []);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [editing, setEditing] = useState<ComplianceRule | null>(null);

  usePageChrome(
    {
      title: 'Compliance Rule Configuration',
      subtitle: 'The rule catalogue evaluated by the screening engine — versioned and auditable',
    },
    [],
  );

  const categories = Array.from(new Set(rules.map((r) => r.category)));
  const rows = rules.filter((r) => {
    if (category !== 'ALL' && r.category !== category) return false;
    if (!search.trim()) return true;
    return `${r.id} ${r.name} ${r.legalReference} ${r.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  });

  const actor = user?.name ?? 'Administrator';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Configured rules" value={rules.length} icon={<SlidersHorizontal size={17} />} tone="navy" />
        <KpiCard label="Active" value={rules.filter((r) => r.active).length} tone="green" />
        <KpiCard label="Mandatory" value={rules.filter((r) => r.mandatory).length} tone="blue" />
        <KpiCard label="High severity" value={rules.filter((r) => r.severity === 'HIGH').length} tone="red" />
      </div>

      <div className="flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 px-4 py-3">
        <BookOpen size={15} className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-xs leading-relaxed text-brand-900">
          Compliance logic lives entirely in this catalogue — no rule is hard-coded into the interface. When
          the Rules are amended, an administrator updates the entry here and every subsequent screening uses
          the new definition. Existing inspections retain the rule version they were evaluated against.
        </p>
      </div>

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by rule ID, name or legal reference…"
              className="pl-9"
              aria-label="Search rules"
            />
          </div>
          <Select
            className="w-auto min-w-[12rem]"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by rule category"
          >
            <option value="ALL">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-2xs font-bold uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-4 py-2 text-left">Rule ID</th>
                <th scope="col" className="px-4 py-2 text-left">Rule name</th>
                <th scope="col" className="px-4 py-2 text-left">Category</th>
                <th scope="col" className="px-4 py-2 text-center">Mandatory</th>
                <th scope="col" className="px-4 py-2 text-left">Validation</th>
                <th scope="col" className="px-4 py-2 text-left">Severity</th>
                <th scope="col" className="px-4 py-2 text-center">Weight</th>
                <th scope="col" className="px-4 py-2 text-left">Last updated</th>
                <th scope="col" className="px-4 py-2 text-center">Active</th>
                <th scope="col" className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => (
                <tr key={rule.id} className={cn('data-grid-row', !rule.active && 'opacity-60')}>
                  <td className="px-4 py-2.5 font-mono text-2xs font-semibold text-navy-800">{rule.id}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{rule.name}</p>
                    <p className="mt-0.5 text-2xs text-slate-400">{rule.legalReference}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{rule.category}</td>
                  <td className="px-4 py-2.5 text-center">
                    {rule.mandatory ? (
                      <Badge tone="blue" size="sm">
                        Yes
                      </Badge>
                    ) : (
                      <span className="text-2xs text-slate-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-2xs text-slate-600">
                      {rule.validationType}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <SeverityBadge severity={rule.severity} />
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-700">{rule.weight}</td>
                  <td className="px-4 py-2.5">
                    <p className="whitespace-nowrap text-2xs text-slate-600">{formatDateTime(rule.updatedAt)}</p>
                    <p className="text-2xs text-slate-400">{rule.updatedBy}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.active}
                        aria-label={`${rule.active ? 'Deactivate' : 'Activate'} ${rule.name}`}
                        onClick={() => {
                          toggleRule(rule.id, !rule.active, actor);
                          toast.info(
                            rule.active ? 'Rule deactivated' : 'Rule activated',
                            `${rule.id} will ${rule.active ? 'no longer be' : 'now be'} evaluated on new scans.`,
                          );
                        }}
                        className={cn(
                          'relative h-5 w-9 rounded-full transition-colors',
                          rule.active ? 'bg-emerald-600' : 'bg-slate-300',
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                            rule.active ? 'translate-x-[18px]' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                      Configure
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.id} · ${editing.name}` : ''}
        description={editing?.legalReference}
        size="lg"
        footer={
          <Button size="sm" onClick={() => setEditing(null)}>
            Done
          </Button>
        }
      >
        {editing && (
          <div className="space-y-5">
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
              {editing.description}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Severity" hint="Determines how the finding is prioritised for verification">
                <Select
                  value={editing.severity}
                  onChange={(e) => {
                    updateRule(editing.id, { severity: e.target.value as Severity }, actor);
                    setEditing({ ...editing, severity: e.target.value as Severity });
                    toast.success('Severity updated');
                  }}
                >
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </Select>
              </Field>
              <Field label="Score weight" hint="Contribution to the screening score within its category">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={editing.weight}
                  onChange={(e) => {
                    const weight = Number(e.target.value);
                    updateRule(editing.id, { weight }, actor);
                    setEditing({ ...editing, weight });
                  }}
                />
              </Field>
            </div>

            {editing.params && Object.keys(editing.params).length > 0 && (
              <div>
                <p className="label-text mb-2">Validation parameters</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(editing.params).map(([key, value]) => (
                    <Field key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()}>
                      <Input
                        type={typeof value === 'number' ? 'number' : 'text'}
                        step="0.1"
                        value={String(value)}
                        onChange={(e) => {
                          const next = typeof value === 'number' ? Number(e.target.value) : e.target.value;
                          updateRuleParam(editing.id, key, next, actor);
                          setEditing({ ...editing, params: { ...editing.params, [key]: next } });
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                  Parameters are read by the validator at evaluation time. Changing the minimum print height,
                  for example, immediately alters how the readability rule classifies future scans.
                </p>
              </div>
            )}

            <div className="rounded-md border border-slate-200 px-3">
              <Toggle
                checked={editing.active}
                onChange={(next) => {
                  toggleRule(editing.id, next, actor);
                  setEditing({ ...editing, active: next });
                }}
                label="Rule active"
                description="Inactive rules are skipped by the engine and excluded from the screening score."
              />
              <Toggle
                checked={editing.mandatory}
                onChange={(next) => {
                  updateRule(editing.id, { mandatory: next }, actor);
                  setEditing({ ...editing, mandatory: next });
                }}
                label="Mandatory declaration"
                description="Mandatory rules can drive a non-compliant screening outcome on their own."
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
              <p className="text-2xs text-slate-500">
                Last updated {formatDateTime(editing.updatedAt)} by {editing.updatedBy}
              </p>
              <Button
                size="sm"
                variant="outline"
                icon={<RotateCcw size={13} />}
                onClick={() => {
                  toast.info('Revert requested', 'Rule version history is maintained by the backend service.');
                }}
              >
                Revert to previous version
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
