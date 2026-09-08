import { getDb, mutate } from './storage';
import * as api from './api';

export function listNotifications() {
  return [...getDb().notifications].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
}

export function unreadCount() {
  return getDb().notifications.filter((n) => !n.read).length;
}

export function markRead(id: string) {
  mutate(
    (draft) => {
      const n = draft.notifications.find((x) => x.id === id);
      if (n) n.read = true;
    },
    () => api.markNotifications([id], true),
  );
}

export function markAllRead() {
  mutate(
    (draft) => draft.notifications.forEach((n) => (n.read = true)),
    () => api.markNotifications('ALL', true),
  );
}

export function dismissNotification(id: string) {
  mutate(
    (draft) => {
      draft.notifications = draft.notifications.filter((n) => n.id !== id);
    },
    () => api.deleteNotification(id),
  );
}
