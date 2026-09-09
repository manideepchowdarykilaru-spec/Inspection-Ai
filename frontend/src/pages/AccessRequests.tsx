import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Mail, MapPin, Phone, RefreshCcw, UserCheck, UserX, XCircle } from 'lucide-react';
import type { User, UserRole } from '@shared/types';
import { REGIONS } from '@shared/data/mockData';
import { ROLE_LABEL, formatDateTime, relativeTime } from '@shared/lib/format';
import { usePageChrome } from '@/layouts/AppLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDatabase } from '@/hooks/useDatabase';
import { listUsers, reviewAccess } from '@/services/authService';
import { hydrate } from '@/services/storage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

/**
 * Access requests — the administrator's approval queue.
 *
 * Officers request access from the sign-in screen; their accounts wait here
 * as PENDING. Approving activates the account (with any correction to role,
 * region or designation); rejecting records a reason. Every decision stores
 * who took it and when, and the page refreshes itself so new requests appear
 * without a reload.
 */

type Tab = 'PENDING' | 'ACTIVE' | 'REJECTED';

const TABS: { id: Tab; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'ACTIVE', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
];

const REFRESH_MS = 15_000;

interface ApproveForm {
  role: UserRole;
  region: string;
  designation: string;
  note: string;
}

export default function AccessRequests() {
  const { user: admin } = useAuth();
  const toast = useToast();
  const users = useDatabase(() => listUsers(), []);
  const [tab, setTab] = useState<Tab>('PENDING');
  const [approving, setApproving] = useState<User | null>(null);
  const [rejecting, setRejecting] = useState<User | null>(null);
  const [form, setForm] = useState<ApproveForm>({ role: 'INSPECTOR', region: '', designation: '', note: '' });
  const [reason, setReason] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await hydrate();
      setRefreshedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  };

  // Live queue: poll while the page is open and whenever the tab regains focus.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const pending = useMemo(
    () => users.filter((u) => u.status === 'PENDING').sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [users],
  );
  const decided = useMemo(
    () =>
      users
        .filter((u) => u.reviewedAt && (u.status === 'ACTIVE' || u.status === 'REJECTED'))
        .sort((a, b) => +new Date(b.reviewedAt!) - +new Date(a.reviewedAt!)),
    [users],
  );
  const approved = decided.filter((u) => u.status === 'ACTIVE');
  const rejected = decided.filter((u) => u.status === 'REJECTED');

  usePageChrome(
    {
      title: 'Access Requests',
      subtitle: 'Officers who have asked for access to the inspection workspace',
      actions: (
        <Button size="sm" variant="outline" icon={<RefreshCcw size={14} className={cn(refreshing && 'animate-spin')} />} onClick={() => void refresh()}>
          Refresh
        </Button>
      ),
    },
    [refreshing],
  );

  const openApprove = (u: User) => {
    setForm({ role: u.role, region: u.region, designation: u.designation, note: '' });
    setApproving(u);
  };

  const confirmApprove = () => {
    if (!approving) return;
    reviewAccess(
      approving.id,
      { decision: 'APPROVE', role: form.role, region: form.region, designation: form.designation, note: form.note },
      admin?.name ?? 'Administrator',
    );
    toast.success('Access approved', `${approving.name} can now sign in as ${ROLE_LABEL[form.role].toLowerCase()}.`);
    setApproving(null);
  };

  const confirmReject = () => {
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      toast.error('Reason required', 'Give the applicant a reason for the rejection.');
      return;
    }
    reviewAccess(rejecting.id, { decision: 'REJECT', note: reason }, admin?.name ?? 'Administrator');
    toast.warning('Access request rejected', rejecting.name);
    setRejecting(null);
    setReason('');
  };

  const list = tab === 'PENDING' ? pending : tab === 'ACTIVE' ? approved : rejected;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Pending" value={pending.length} tone="amber" icon={<Clock3 size={17} />} sublabel="awaiting your decision" />
        <KpiCard label="Approved" value={approved.length} tone="green" icon={<UserCheck size={17} />} sublabel="accounts activated from requests" />
        <KpiCard label="Rejected" value={rejected.length} tone="red" icon={<UserX size={17} />} sublabel="with a recorded reason" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white" role="tablist">
          {TABS.map((t) => {
            const count = t.id === 'PENDING' ? pending.length : t.id === 'ACTIVE' ? approved.length : rejected.length;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold transition-colors',
                  tab === t.id ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {t.label} <span className={cn('ml-1 tabular-nums', tab === t.id ? 'text-navy-200' : 'text-slate-400')}>{count}</span>
              </button>
            );
          })}
        </div>
        <p className="text-2xs text-slate-500">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
          Live · refreshed {relativeTime(refreshedAt.toISOString())} · every {REFRESH_MS / 1000}s
        </p>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={tab === 'PENDING' ? 'No pending requests' : tab === 'ACTIVE' ? 'No approved requests yet' : 'No rejected requests'}
          description={
            tab === 'PENDING'
              ? 'New requests from the sign-in screen appear here automatically.'
              : 'Decisions are listed here with the reviewer, time and any note.'
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.map((u) => (
            <li key={u.id} className="surface p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                  {u.avatarInitials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{u.name}</h3>
                    <Badge tone={u.status === 'PENDING' ? 'amber' : u.status === 'ACTIVE' ? 'green' : 'red'} size="sm">
                      {u.status === 'PENDING' ? 'Pending' : u.status === 'ACTIVE' ? 'Approved' : 'Rejected'}
                    </Badge>
                    <Badge tone="blue" size="sm">{ROLE_LABEL[u.role]}</Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-slate-600">{u.officialId}</p>
                  <dl className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                    <div className="flex items-center gap-1.5 truncate"><Mail size={12} className="shrink-0 text-slate-400" /><span className="truncate">{u.email}</span></div>
                    <div className="flex items-center gap-1.5"><Phone size={12} className="shrink-0 text-slate-400" />{u.phone || '—'}</div>
                    <div className="flex items-center gap-1.5"><MapPin size={12} className="shrink-0 text-slate-400" />{u.region}</div>
                    <div className="flex items-center gap-1.5"><Clock3 size={12} className="shrink-0 text-slate-400" />Requested {relativeTime(u.createdAt)}</div>
                  </dl>
                  <p className="mt-1 text-xs text-slate-500">{u.designation}</p>

                  {u.reviewedAt && (
                    <div className={cn('mt-3 rounded-md border px-3 py-2 text-xs', u.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900')}>
                      <p className="flex items-center gap-1.5 font-semibold">
                        {u.status === 'ACTIVE' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {u.status === 'ACTIVE' ? 'Approved' : 'Rejected'} by {u.reviewedBy ?? 'Administrator'} · {formatDateTime(u.reviewedAt)}
                      </p>
                      {u.reviewNote && <p className="mt-1 leading-relaxed opacity-90">{u.reviewNote}</p>}
                    </div>
                  )}
                </div>
              </div>

              {(u.status === 'PENDING' || u.status === 'REJECTED') && (
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                  {u.status === 'PENDING' && (
                    <Button size="sm" variant="outline" className="text-red-700" icon={<UserX size={14} />} onClick={() => { setReason(''); setRejecting(u); }}>
                      Reject
                    </Button>
                  )}
                  <Button size="sm" icon={<UserCheck size={14} />} onClick={() => openApprove(u)}>
                    {u.status === 'REJECTED' ? 'Approve after all' : 'Approve'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!approving}
        onClose={() => setApproving(null)}
        title="Approve access request"
        description={approving ? `${approving.name} · ${approving.officialId}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button icon={<UserCheck size={14} />} onClick={confirmApprove}>Approve and activate</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" hint="Correct it if the request asked for more than the post allows">
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
              <option value="INSPECTOR">Inspector</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          <Field label="Region / jurisdiction">
            <Select value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
              {[...REGIONS, 'State Headquarters'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              {!REGIONS.includes(form.region) && form.region !== 'State Headquarters' && <option value={form.region}>{form.region}</option>}
            </Select>
          </Field>
          <Field label="Designation" className="sm:col-span-2">
            <Input value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
          </Field>
          <Field label="Note (optional)" className="sm:col-span-2" hint="Recorded with the decision">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Verified against HRMS record" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject access request"
        description={rejecting ? `${rejecting.name} · ${rejecting.officialId}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" icon={<UserX size={14} />} onClick={confirmReject}>Reject request</Button>
          </>
        }
      >
        <Field label="Reason" required hint="The applicant is told the request was not approved; the reason is kept on the record">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Official ID not found in departmental records" />
        </Field>
      </Modal>
    </div>
  );
}
