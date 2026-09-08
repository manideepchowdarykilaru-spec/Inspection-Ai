import type { User, UserRole } from '@shared/types';
import { DEMO_CREDENTIALS, USERS } from '@shared/data/mockData';
import { delay } from '@/lib/utils';
import { getDb, mutate } from './storage';
import * as api from './api';

/**
 * Authentication service (mock).
 *
 * The real implementation exchanges credentials for a short-lived JWT and keeps
 * the refresh token in an httpOnly cookie; the shape of `signIn` stays the same.
 */

const SESSION_KEY = 'lm-inspect.session';

export interface Session {
  user: User;
  issuedAt: string;
  expiresAt: string;
  token: string;
}

export interface Credentials {
  officialId: string;
  password: string;
  remember?: boolean;
}

export class AuthError extends Error {}

export async function signIn({ officialId, password, remember }: Credentials): Promise<Session> {
  await delay(650);
  const id = officialId.trim().toLowerCase();
  const credential = DEMO_CREDENTIALS.find((c) => {
    const account = USERS.find((u) => u.officialId === c.officialId);
    const identifierMatches =
      c.officialId.toLowerCase() === id || account?.email.toLowerCase() === id;
    return identifierMatches && c.password === password;
  });

  if (!credential) {
    throw new AuthError('Invalid official ID or password. Use the demo credentials shown below.');
  }

  const user = USERS.find((u) => u.officialId === credential.officialId)!;
  if (user.status !== 'ACTIVE') {
    throw new AuthError('This account is not active. Contact the department administrator.');
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (remember ? 12 : 4) * 3600_000);
  const session: Session = {
    user,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    token: `mock.${btoa(user.officialId)}.${issuedAt.getTime()}`,
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (remember) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function restoreSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      signOut();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

/* ------------------------------------------------------ Role capabilities */

export type Capability =
  | 'inspection:create'
  | 'inspection:verify'
  | 'inspection:close'
  | 'report:generate'
  | 'rules:manage'
  | 'users:manage'
  | 'analytics:region'
  | 'analytics:state';

const CAPABILITIES: Record<UserRole, Capability[]> = {
  INSPECTOR: ['inspection:create', 'report:generate', 'analytics:region'],
  SUPERVISOR: [
    'inspection:create',
    'inspection:verify',
    'inspection:close',
    'report:generate',
    'analytics:region',
    'analytics:state',
  ],
  ADMIN: [
    'inspection:create',
    'inspection:verify',
    'inspection:close',
    'report:generate',
    'rules:manage',
    'users:manage',
    'analytics:region',
    'analytics:state',
  ],
};

export function can(role: UserRole | undefined, capability: Capability) {
  if (!role) return false;
  return CAPABILITIES[role].includes(capability);
}

/* ------------------------------------------------------------ User admin */

export function listUsers() {
  return getDb().users;
}

export function upsertUser(user: User) {
  mutate(
    (draft) => {
      const index = draft.users.findIndex((u) => u.id === user.id);
      if (index >= 0) draft.users[index] = user;
      else draft.users.unshift(user);
    },
    () => api.saveUser(user),
  );
}

export function setUserStatus(userId: string, status: User['status']) {
  mutate(
    (draft) => {
      const user = draft.users.find((u) => u.id === userId);
      if (user) user.status = status;
    },
    () => api.patchUserStatus(userId, status),
  );
}
