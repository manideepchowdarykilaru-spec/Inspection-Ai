import { NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  FileBarChart,
  FileCheck2,
  Gauge,
  Images,
  LogOut,
  ScanLine,
  ScanText,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_LABEL } from '@shared/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useDatabase } from '@/hooks/useDatabase';
import { unreadCount } from '@/services/notificationService';
import type { Capability } from '@/services/authService';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  capability?: Capability;
  badge?: 'notifications';
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/app/new-inspection', label: 'New Inspection', icon: ScanLine, capability: 'inspection:create' },
  { to: '/app/extract', label: 'Text Extraction', icon: ScanText },
  { to: '/app/inspections', label: 'Inspections', icon: FileCheck2 },
  { to: '/app/products', label: 'Products', icon: Boxes },
  { to: '/app/violations', label: 'Violations', icon: ShieldAlert },
  { to: '/app/reports', label: 'Reports', icon: FileBarChart },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/evidence', label: 'Evidence', icon: Images },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/app/users', label: 'Users', icon: Users, capability: 'users:manage' },
  { to: '/app/rules', label: 'Compliance Rules', icon: SlidersHorizontal, capability: 'rules:manage' },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const unread = useDatabase(() => unreadCount(), []);

  const renderItem = (item: NavItem) => {
    if (item.capability && !can(item.capability)) return null;
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onClose}
        className={({ isActive }) =>
          cn(
            'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'bg-white/10 text-white'
              : 'text-navy-200 hover:bg-white/5 hover:text-white',
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent-400 transition-opacity',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Icon size={17} className={cn('shrink-0', isActive ? 'text-accent-400' : 'text-navy-300')} />
            <span className="truncate">{item.label}</span>
            {item.badge === 'notifications' && unread > 0 && (
              <span className="ml-auto rounded-full bg-red-600 px-1.5 py-0.5 text-2xs font-bold text-white">
                {unread}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-navy-950/50 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-navy-900 transition-transform duration-200 ease-out lg:translate-x-0 no-print',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        <div className="gov-stripe flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
            <ScanLine size={18} className="text-accent-400" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold tracking-tight text-white">LM-Inspect AI</p>
            <p className="truncate text-2xs text-navy-300">Legal Metrology Compliance</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-navy-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-1.5 text-2xs font-bold uppercase tracking-wider text-navy-400">Operations</p>
          {PRIMARY_NAV.map(renderItem)}

          {(can('users:manage') || can('rules:manage')) && (
            <p className="px-3 pb-1.5 pt-5 text-2xs font-bold uppercase tracking-wider text-navy-400">
              Administration
            </p>
          )}
          {ADMIN_NAV.map(renderItem)}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-md bg-white/5 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-2xs font-bold text-accent-400 ring-1 ring-accent-400/30">
              {user?.avatarInitials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{user?.name}</p>
              <p className="truncate text-2xs text-navy-300">
                {user ? ROLE_LABEL[user.role] : ''} · {user?.region}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                signOut();
                navigate('/login');
              }}
              className="rounded p-1.5 text-navy-300 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
          <p className="mt-2 px-1 text-center text-[10px] leading-relaxed text-navy-400">
            AI-assisted screening · decisions rest with authorised officials
          </p>
        </div>
      </aside>
    </>
  );
}
