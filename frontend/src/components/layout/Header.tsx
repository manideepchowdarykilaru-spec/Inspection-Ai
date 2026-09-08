import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CircleHelp, LogOut, Menu, ShieldCheck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ROLE_LABEL, relativeTime } from '@shared/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useDatabase } from '@/hooks/useDatabase';
import { listNotifications, markAllRead, markRead } from '@/services/notificationService';
import { GlobalSearch } from './GlobalSearch';

const PRIORITY_DOT = {
  HIGH: 'bg-red-600',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-slate-300',
};

export function Header({
  title,
  subtitle,
  actions,
  onMenuClick,
  contextBar,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onMenuClick: () => void;
  contextBar?: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<'none' | 'notifications' | 'profile'>('none');
  const ref = useRef<HTMLDivElement>(null);
  const notifications = useDatabase(() => listNotifications(), []);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPanel('none');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
      <div className="flex items-center gap-3 px-4 py-2.5 lg:px-6">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md border border-slate-300 p-1.5 text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">{title}</h1>
          {subtitle && <p className="hidden truncate text-xs text-slate-500 sm:block">{subtitle}</p>}
        </div>

        <GlobalSearch className="hidden w-72 shrink-0 xl:block" />

        <div ref={ref} className="flex shrink-0 items-center gap-1">
          {actions}

          <a
            href="https://consumeraffairs.nic.in/acts-and-rules/legal-metrology"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:block"
            aria-label="Legal Metrology rules reference"
            title="Legal Metrology rules reference"
          >
            <CircleHelp size={18} />
          </a>

          <div className="relative">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === 'notifications' ? 'none' : 'notifications'))}
              className="relative rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>

            {panel === 'notifications' && (
              <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white shadow-elevated">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Notifications</p>
                  <button
                    type="button"
                    onClick={() => markAllRead()}
                    className="text-2xs font-semibold text-brand-700 hover:underline"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.slice(0, 8).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        markRead(n.id);
                        setPanel('none');
                        if (n.link) navigate(n.link);
                      }}
                      className={cn(
                        'flex w-full gap-2.5 border-b border-slate-100 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-slate-50',
                        !n.read && 'bg-brand-50/50',
                      )}
                    >
                      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_DOT[n.priority])} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-xs', n.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900')}>
                          {n.title}
                        </span>
                        <span className="mt-0.5 block text-2xs leading-relaxed text-slate-500">{n.body}</span>
                        <span className="mt-1 block text-2xs text-slate-400">{relativeTime(n.createdAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <Link
                  to="/app/notifications"
                  onClick={() => setPanel('none')}
                  className="block border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-2xs font-semibold text-brand-700 hover:bg-slate-100"
                >
                  View notification centre
                </Link>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === 'profile' ? 'none' : 'profile'))}
              className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-slate-100"
              aria-label="Account menu"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-2xs font-bold text-white">
                {user?.avatarInitials}
              </span>
              <span className="hidden text-left lg:block">
                <span className="block max-w-[9rem] truncate text-xs font-semibold text-slate-800">{user?.name}</span>
                <span className="block text-2xs text-slate-500">{user ? ROLE_LABEL[user.role] : ''}</span>
              </span>
            </button>

            {panel === 'profile' && (
              <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-elevated">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-sm font-bold text-slate-900">{user?.name}</p>
                  <p className="mt-0.5 text-2xs text-slate-500">{user?.designation}</p>
                  <p className="mt-1 font-mono text-2xs text-slate-400">{user?.officialId}</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-800">
                    <ShieldCheck size={11} /> Secure session · {user?.region}
                  </p>
                </div>
                <Link
                  to="/app/settings"
                  onClick={() => setPanel('none')}
                  className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <UserRound size={14} /> Profile &amp; settings
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    signOut();
                    navigate('/login');
                  }}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-1.5 lg:px-6 xl:hidden">
        <GlobalSearch className="flex-1" />
      </div>

      {contextBar ? (
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2 lg:px-6">{contextBar}</div>
      ) : (
        <div className="hidden items-center justify-between border-t border-slate-100 px-6 py-1.5 text-2xs text-slate-400 xl:flex">
          <span>
            {user?.department} · {user?.region}
          </span>
          <span className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck size={11} /> Session secured · role-based access enforced
            </span>
            <span>{today}</span>
          </span>
        </div>
      )}
    </header>
  );
}
