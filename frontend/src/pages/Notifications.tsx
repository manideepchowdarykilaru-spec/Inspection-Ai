import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { usePageChrome } from '@/layouts/AppLayout';
import { useDatabase } from '@/hooks/useDatabase';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  dismissNotification,
  listNotifications,
  markAllRead,
  markRead,
} from '@/services/notificationService';
import { relativeTime, formatDateTime } from '@shared/lib/format';
import { cn } from '@/lib/utils';
import type { NotificationPriority } from '@shared/types';

const PRIORITY_TONE: Record<NotificationPriority, 'red' | 'amber' | 'slate'> = {
  HIGH: 'red',
  MEDIUM: 'amber',
  LOW: 'slate',
};

const CATEGORY_LABEL = {
  INSPECTION: 'Inspection',
  VIOLATION: 'Violation',
  REPORT: 'Report',
  SYSTEM: 'System',
};

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const notifications = useDatabase(() => listNotifications(), []);
  const rows = filter === 'UNREAD' ? notifications.filter((n) => !n.read) : notifications;
  const unread = notifications.filter((n) => !n.read).length;

  usePageChrome(
    {
      title: 'Notification Centre',
      subtitle: `${unread} unread of ${notifications.length} notifications`,
      actions: (
        <Button size="sm" variant="outline" icon={<CheckCheck size={13} />} onClick={() => markAllRead()}>
          <span className="hidden sm:inline">Mark all read</span>
        </Button>
      ),
    },
    [unread, notifications.length],
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1">
        {(['ALL', 'UNREAD'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === f ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50',
            )}
            aria-pressed={filter === f}
          >
            {f === 'ALL' ? `All (${notifications.length})` : `Unread (${unread})`}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filter === 'UNREAD' ? 'No unread notifications' : 'No notifications'}
          description="Notifications about inspections, findings, reports and rule changes appear here."
          icon={<BellOff size={20} />}
        />
      ) : (
        rows.map((n) => (
          <article
            key={n.id}
            className={cn(
              'surface flex items-start gap-3 p-4 transition-colors',
              !n.read && 'border-l-4 border-l-brand-600 bg-brand-50/30',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                n.priority === 'HIGH'
                  ? 'bg-red-50 text-red-700'
                  : n.priority === 'MEDIUM'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-500',
              )}
            >
              <Bell size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={cn('text-sm', n.read ? 'font-semibold text-slate-700' : 'font-bold text-slate-900')}>
                  {n.title}
                </h2>
                <Badge tone={PRIORITY_TONE[n.priority]} size="sm">
                  {n.priority.toLowerCase()} priority
                </Badge>
                <Badge tone="slate" size="sm">
                  {CATEGORY_LABEL[n.category]}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{n.body}</p>
              <p className="mt-1.5 text-2xs text-slate-400" title={formatDateTime(n.createdAt)}>
                {relativeTime(n.createdAt)}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {n.link && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      markRead(n.id);
                      navigate(n.link!);
                    }}
                  >
                    Open
                  </Button>
                )}
                {!n.read && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>
                    Mark as read
                  </Button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissNotification(n.id)}
              className="rounded p-1.5 text-slate-300 transition-colors hover:bg-slate-100 hover:text-red-600"
              aria-label="Dismiss notification"
            >
              <Trash2 size={14} />
            </button>
          </article>
        ))
      )}
    </div>
  );
}
