import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Search, ShieldCheck, UserPlus } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { listUsers, setUserStatus, upsertUser } from '@/services/authService';
import { DEPARTMENT, REGIONS } from '@shared/data/mockData';
import { ROLE_LABEL, relativeTime } from '@shared/lib/format';
import { uid } from '@/lib/utils';
import type { User, UserRole, UserStatus } from '@shared/types';

const ROLE_TONE: Record<UserRole, 'violet' | 'blue' | 'slate'> = {
  ADMIN: 'violet',
  SUPERVISOR: 'blue',
  INSPECTOR: 'slate',
};

const STATUS_TONE: Record<UserStatus, 'green' | 'slate' | 'red' | 'amber'> = {
  ACTIVE: 'green',
  INACTIVE: 'slate',
  SUSPENDED: 'red',
  PENDING: 'amber',
  REJECTED: 'red',
};

interface UserForm {
  name: string;
  officialId: string;
  email: string;
  role: UserRole;
  designation: string;
  region: string;
  phone: string;
}

export default function UserManagement() {
  const navigate = useNavigate();
  const toast = useToast();
  const users = useDatabase(() => listUsers(), []);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState<User | null>(null);

  const { register, handleSubmit, reset, formState } = useForm<UserForm>();

  usePageChrome(
    {
      title: 'User Management',
      subtitle: 'Departmental accounts, roles and jurisdiction assignment',
      actions: (
        <Button
          size="sm"
          icon={<UserPlus size={14} />}
          onClick={() => {
            setEditing(null);
            reset({
              name: '',
              officialId: '',
              email: '',
              role: 'INSPECTOR',
              designation: 'Inspector of Legal Metrology',
              region: REGIONS[0],
              phone: '',
            });
            setOpen(true);
          }}
        >
          <span className="hidden sm:inline">Add user</span>
        </Button>
      ),
    },
    [],
  );

  const rows = users.filter((u) =>
    `${u.name} ${u.officialId} ${u.email} ${u.region}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const onSubmit = handleSubmit((values) => {
    const initials = values.name
      .split(/\s+/)
      .filter((p) => /[A-Za-z]/.test(p))
      .slice(-2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
    const user: User = {
      id: editing?.id ?? uid('usr'),
      officialId: values.officialId,
      name: values.name,
      email: values.email,
      role: values.role,
      designation: values.designation,
      department: DEPARTMENT,
      region: values.region,
      phone: values.phone,
      avatarInitials: initials || 'LM',
      status: editing?.status ?? 'ACTIVE',
      lastActiveAt: editing?.lastActiveAt ?? new Date().toISOString(),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    upsertUser(user);
    toast.success(editing ? 'User updated' : 'User created', `${user.name} · ${ROLE_LABEL[user.role]}`);
    setOpen(false);
  });

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (u) => u.name,
      render: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-2xs font-bold text-white">
            {u.avatarInitials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{u.name}</p>
            <p className="truncate font-mono text-2xs text-slate-500">{u.officialId}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (u) => u.role,
      render: (u) => (
        <div className="space-y-1">
          <Badge tone={ROLE_TONE[u.role]} size="sm">
            {ROLE_LABEL[u.role]}
          </Badge>
          <p className="text-2xs text-slate-500">{u.designation}</p>
        </div>
      ),
    },
    {
      key: 'region',
      header: 'Region',
      sortValue: (u) => u.region,
      render: (u) => <span className="text-xs text-slate-600">{u.region}</span>,
    },
    {
      key: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate text-2xs text-slate-600">{u.email}</p>
          <p className="text-2xs text-slate-400">{u.phone}</p>
        </div>
      ),
    },
    {
      key: 'active',
      header: 'Last active',
      sortValue: (u) => u.lastActiveAt,
      render: (u) => <span className="whitespace-nowrap text-xs text-slate-600">{relativeTime(u.lastActiveAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (u) => u.status,
      render: (u) => (
        <Badge tone={STATUS_TONE[u.status]} size="sm">
          {u.status.charAt(0) + u.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (u) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(u);
              reset({
                name: u.name,
                officialId: u.officialId,
                email: u.email,
                role: u.role,
                designation: u.designation,
                region: u.region,
                phone: u.phone,
              });
              setOpen(true);
            }}
          >
            Edit
          </Button>
          {u.status === 'PENDING' || u.status === 'REJECTED' ? (
            <Button size="sm" variant="ghost" className="text-amber-800" onClick={() => navigate('/app/access-requests')}>
              Review request
            </Button>
          ) : u.status === 'ACTIVE' ? (
            <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setPendingDeactivate(u)}>
              Deactivate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-emerald-700"
              onClick={() => {
                setUserStatus(u.id, 'ACTIVE');
                toast.success('User reactivated', u.name);
              }}
            >
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total accounts" value={users.length} tone="navy" icon={<ShieldCheck size={17} />} />
        <KpiCard label="Inspectors" value={users.filter((u) => u.role === 'INSPECTOR').length} tone="blue" />
        <KpiCard label="Supervisors" value={users.filter((u) => u.role === 'SUPERVISOR').length} tone="slate" />
        <KpiCard
          label="Pending approval"
          value={users.filter((u) => u.status === 'PENDING').length}
          tone="amber"
          sublabel="access requests awaiting review"
        />
      </div>

      <section className="surface overflow-hidden">
        <div className="border-b border-slate-200 p-3">
          <div className="relative max-w-md">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, official ID, email or region…"
              className="pl-9"
              aria-label="Search users"
            />
          </div>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} pageSize={10} />
      </section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add departmental user'}
        description="Role determines which parts of the system the account can access."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSubmit} loading={formState.isSubmitting}>
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={formState.errors.name?.message}>
            <Input {...register('name', { required: 'Name is required' })} placeholder="K. Ramesh Kumar" />
          </Field>
          <Field label="Official ID" required error={formState.errors.officialId?.message}>
            <Input {...register('officialId', { required: 'Official ID is required' })} placeholder="LM-TS-INS-1100" />
          </Field>
          <Field label="Email" required error={formState.errors.email?.message}>
            <Input type="email" {...register('email', { required: 'Email is required' })} placeholder="name@lm.telangana.example" />
          </Field>
          <Field label="Phone">
            <Input {...register('phone')} placeholder="+91 40 2345 0000" />
          </Field>
          <Field label="Role" required>
            <Select {...register('role')}>
              <option value="INSPECTOR">Inspector</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          <Field label="Region / jurisdiction" required>
            <Select {...register('region')}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="State Headquarters">State Headquarters</option>
            </Select>
          </Field>
          <Field label="Designation" className="sm:col-span-2">
            <Input {...register('designation')} placeholder="Inspector of Legal Metrology" />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!pendingDeactivate}
        onClose={() => setPendingDeactivate(null)}
        onConfirm={() => {
          if (pendingDeactivate) {
            setUserStatus(pendingDeactivate.id, 'INACTIVE');
            toast.warning('Account deactivated', `${pendingDeactivate.name} can no longer sign in.`);
          }
        }}
        title="Deactivate this account?"
        message="The officer will lose access immediately. Existing inspections and reports remain attributed to them."
        confirmLabel="Deactivate"
        variant="danger"
      />
    </div>
  );
}
