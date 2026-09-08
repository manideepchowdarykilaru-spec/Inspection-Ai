import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  Database,
  KeyRound,
  Monitor,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Toggle } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { resetDatabase } from '@/services/storage';
import { ROLE_LABEL, formatDateTime } from '@shared/lib/format';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'security', label: 'Security', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'inspection', label: 'Inspection Settings', icon: ScanLine },
  { id: 'rules', label: 'Compliance Rules', icon: SlidersHorizontal },
  { id: 'system', label: 'System Preferences', icon: Monitor },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function Settings() {
  const { user, can, session } = useAuth();
  const toast = useToast();
  const [section, setSection] = useState<SectionId>('profile');
  const [confirmReset, setConfirmReset] = useState(false);

  const [prefs, setPrefs] = useState({
    highSeverityAlerts: true,
    dailyDigest: true,
    reportReady: true,
    repeatOffender: true,
    autoSaveScans: true,
    requireEvidencePhoto: true,
    offlineQueue: false,
    confidenceThreshold: 75,
    defaultRegion: user?.region ?? '',
    scanQuality: 'balanced',
  });

  usePageChrome({ title: 'Settings', subtitle: 'Account, inspection and system preferences' }, []);

  const set = (patch: Partial<typeof prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="surface h-fit overflow-hidden lg:sticky lg:top-32" aria-label="Settings sections">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                'flex w-full items-center gap-2.5 border-l-2 px-4 py-2.5 text-left text-xs font-semibold transition-colors',
                active
                  ? 'border-navy-900 bg-slate-50 text-navy-900'
                  : 'border-transparent text-slate-600 hover:bg-slate-50',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={15} />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="space-y-4">
        {section === 'profile' && (
          <Card>
            <CardHeader title="Officer profile" subtitle="Identity recorded against every inspection action" />
            <CardBody className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-900 text-lg font-bold text-white">
                  {user?.avatarInitials}
                </span>
                <div>
                  <p className="text-base font-bold text-slate-900">{user?.name}</p>
                  <p className="text-xs text-slate-500">{user?.designation}</p>
                  <Badge tone="blue" size="sm" className="mt-1.5">
                    {user ? ROLE_LABEL[user.role] : ''}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Official ID">
                  <Input value={user?.officialId ?? ''} readOnly className="bg-slate-50" />
                </Field>
                <Field label="Email">
                  <Input value={user?.email ?? ''} readOnly className="bg-slate-50" />
                </Field>
                <Field label="Phone">
                  <Input defaultValue={user?.phone} />
                </Field>
                <Field label="Region / jurisdiction" hint="Assigned by the department administrator">
                  <Input value={user?.region ?? ''} readOnly className="bg-slate-50" />
                </Field>
                <Field label="Department" className="sm:col-span-2">
                  <Input value={user?.department ?? ''} readOnly className="bg-slate-50" />
                </Field>
              </div>
              <Button size="sm" onClick={() => toast.success('Profile updated')}>
                Save profile
              </Button>
            </CardBody>
          </Card>
        )}

        {section === 'security' && (
          <>
            <Card>
              <CardHeader title="Session and access" subtitle="Role-based access is enforced on every screen" />
              <CardBody className="space-y-3 text-xs">
                {[
                  ['Signed in as', `${user?.name} (${user?.officialId})`],
                  ['Role', user ? ROLE_LABEL[user.role] : ''],
                  ['Session issued', session ? formatDateTime(session.issuedAt) : '—'],
                  ['Session expires', session ? formatDateTime(session.expiresAt) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <dt className="w-36 shrink-0 text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="label-text mb-2">Capabilities granted to this role</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ['Create inspections', can('inspection:create')],
                      ['Verify findings', can('inspection:verify')],
                      ['Close inspections', can('inspection:close')],
                      ['Generate reports', can('report:generate')],
                      ['Manage rules', can('rules:manage')],
                      ['Manage users', can('users:manage')],
                      ['State-level analytics', can('analytics:state')],
                    ].map(([label, granted]) => (
                      <Badge key={String(label)} tone={granted ? 'green' : 'slate'} size="sm">
                        {String(label)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Password" subtitle="Departmental password policy applies" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Current password">
                  <Input type="password" placeholder="••••••••" />
                </Field>
                <div />
                <Field label="New password">
                  <Input type="password" placeholder="••••••••" />
                </Field>
                <Field label="Confirm new password">
                  <Input type="password" placeholder="••••••••" />
                </Field>
                <div className="sm:col-span-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      toast.info('Password change', 'Password changes are processed by the departmental identity service.')
                    }
                  >
                    Update password
                  </Button>
                </div>
              </CardBody>
            </Card>
          </>
        )}

        {section === 'notifications' && (
          <Card>
            <CardHeader title="Notification preferences" subtitle="Control which events reach you" />
            <CardBody className="divide-y divide-slate-100">
              <Toggle
                checked={prefs.highSeverityAlerts}
                onChange={(v) => set({ highSeverityAlerts: v })}
                label="High-severity findings"
                description="Alert immediately when a mandatory declaration is absent or unreadable."
              />
              <Toggle
                checked={prefs.repeatOffender}
                onChange={(v) => set({ repeatOffender: v })}
                label="Repeat non-compliance"
                description="Notify when a packer is flagged across multiple inspections in 30 days."
              />
              <Toggle
                checked={prefs.reportReady}
                onChange={(v) => set({ reportReady: v })}
                label="Report generation"
                description="Confirm when an inspection report has been generated and is ready to export."
              />
              <Toggle
                checked={prefs.dailyDigest}
                onChange={(v) => set({ dailyDigest: v })}
                label="Daily enforcement digest"
                description="A morning summary of the previous day's inspections and outcomes."
              />
            </CardBody>
          </Card>
        )}

        {section === 'inspection' && (
          <Card>
            <CardHeader title="Inspection settings" subtitle="Defaults applied to new scans" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Minimum confidence for auto-acceptance"
                  hint="Declarations read below this confidence are marked for manual review"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={50}
                      max={99}
                      value={prefs.confidenceThreshold}
                      onChange={(e) => set({ confidenceThreshold: Number(e.target.value) })}
                      className="flex-1 accent-brand-700"
                      aria-label="Minimum confidence threshold"
                    />
                    <span className="w-12 text-right font-mono text-sm font-bold text-navy-900">
                      {prefs.confidenceThreshold}%
                    </span>
                  </div>
                </Field>
                <Field label="Scan quality profile" hint="Higher quality increases processing time">
                  <Select value={prefs.scanQuality} onChange={(e) => set({ scanQuality: e.target.value })}>
                    <option value="fast">Fast — single pass OCR</option>
                    <option value="balanced">Balanced — detection + recognition</option>
                    <option value="thorough">Thorough — multi-scale with deskew</option>
                  </Select>
                </Field>
              </div>
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                <Toggle
                  checked={prefs.autoSaveScans}
                  onChange={(v) => set({ autoSaveScans: v })}
                  label="Auto-save completed scans"
                  description="Persist the inspection as soon as screening completes."
                />
                <Toggle
                  checked={prefs.requireEvidencePhoto}
                  onChange={(v) => set({ requireEvidencePhoto: v })}
                  label="Require a label photograph"
                  description="Block report generation unless at least one principal display panel image is attached."
                />
                <Toggle
                  checked={prefs.offlineQueue}
                  onChange={(v) => set({ offlineQueue: v })}
                  label="Offline field queue"
                  description="Queue scans captured without connectivity and sync when the device reconnects."
                />
              </div>
              <Button size="sm" onClick={() => toast.success('Inspection settings saved')}>
                Save settings
              </Button>
            </CardBody>
          </Card>
        )}

        {section === 'rules' && (
          <Card>
            <CardHeader title="Compliance rules" subtitle="The catalogue evaluated by the screening engine" />
            <CardBody className="space-y-3">
              <p className="text-xs leading-relaxed text-slate-600">
                Rules, their weights, severities and validation parameters are maintained in the rule
                configuration workspace. Amendments to the Legal Metrology (Packaged Commodities) Rules are
                absorbed by editing the catalogue — no application change is required.
              </p>
              {can('rules:manage') ? (
                <Link to="/app/rules">
                  <Button size="sm" icon={<SlidersHorizontal size={14} />}>
                    Open rule configuration
                  </Button>
                </Link>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs text-amber-900">
                    Rule configuration is restricted to administrators. Contact the Controller of Legal
                    Metrology to request a change.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {section === 'system' && (
          <>
            <Card>
              <CardHeader title="System preferences" subtitle="Locale and display" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Language">
                  <Select defaultValue="en-IN">
                    <option value="en-IN">English (India)</option>
                    <option value="hi-IN">हिन्दी</option>
                    <option value="te-IN">తెలుగు</option>
                  </Select>
                </Field>
                <Field label="Date format">
                  <Select defaultValue="dd-mmm-yyyy">
                    <option value="dd-mmm-yyyy">05 Sep 2026</option>
                    <option value="dd/mm/yyyy">05/09/2026</option>
                  </Select>
                </Field>
                <Field label="Default region for new inspections">
                  <Input value={prefs.defaultRegion} onChange={(e) => set({ defaultRegion: e.target.value })} />
                </Field>
                <Field label="Records per page">
                  <Select defaultValue="12">
                    <option>10</option>
                    <option>12</option>
                    <option>25</option>
                  </Select>
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Demonstration data"
                subtitle="Records are stored in PostgreSQL"
                icon={<Database size={16} />}
              />
              <CardBody className="space-y-3">
                <p className="text-xs leading-relaxed text-slate-600">
                  Inspections, evidence and reports are stored in PostgreSQL. Resetting truncates the
                  operational tables and re-seeds the demonstration corpus — everything recorded since setup
                  is discarded.
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={13} />}
                  onClick={() => setConfirmReset(true)}
                >
                  Reset demonstration data
                </Button>
              </CardBody>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          void resetDatabase()
            .then(() =>
              toast.success(
                'Demonstration data reset',
                'The seeded inspection corpus has been restored in PostgreSQL.',
              ),
            )
            .catch((error: unknown) =>
              toast.error(
                'Reset failed',
                error instanceof Error ? error.message : 'The API did not accept the request.',
              ),
            );
        }}
        title="Reset demonstration data?"
        message="All inspections, evidence and reports created in this session will be discarded and the seeded corpus restored."
        confirmLabel="Reset data"
        variant="danger"
      />
    </div>
  );
}
