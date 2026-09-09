import type { AccessReviewRequest, RegisterRequest, User, UserRole } from '@shared/types';
import { getDb, mutate } from './storage';
import * as api from './api';

/**
 * Authentication service.
 *
 * Credentials are verified by the API against salted password hashes in
 * PostgreSQL; the signed token it returns accompanies every subsequent call.
 * A production deployment would exchange a department single sign-on assertion
 * here instead — the shape of `signIn` stays the same.
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
  let response;
  try {
    response = await api.login({ identifier: officialId.trim(), password, remember });
  } catch (error) {
    if (error instanceof api.ApiError) throw new AuthError(error.message);
    throw new AuthError('Cannot reach the server. Check your connection and try again.');
  }

  const session: Session = {
    user: response.user,
    issuedAt: response.issuedAt,
    expiresAt: response.expiresAt,
    token: response.token,
  };
  api.setAuthToken(session.token);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (remember) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/** Access request for a new officer; the account stays pending until an administrator approves it. */
export function requestAccess(body: RegisterRequest) {
  return api.registerOfficer(body).catch((error: unknown) => {
    if (error instanceof api.ApiError) throw new AuthError(error.message);
    throw new AuthError('Cannot reach the server. Check your connection and try again.');
  });
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
    api.setAuthToken(session.token);
    return session;
  } catch {
    return null;
  }
}

export function signOut() {
  api.setAuthToken(null);
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

/** Open access requests, newest first. */
export function pendingAccessRequests() {
  return getDb()
    .users.filter((u) => u.status === 'PENDING')
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function pendingAccessCount() {
  return getDb().users.filter((u) => u.status === 'PENDING').length;
}

/**
 * Decides an access request. The cache is updated at once so the queue moves
 * immediately; the API records the decision with the reviewer and time, and a
 * failed write re-hydrates from the server.
 */
export function reviewAccess(userId: string, review: AccessReviewRequest, reviewerName: string) {
  mutate(
    (draft) => {
      const user = draft.users.find((u) => u.id === userId);
      if (!user) return;
      user.status = review.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      if (review.role) user.role = review.role;
      if (review.region) user.region = review.region;
      if (review.designation) user.designation = review.designation;
      user.reviewedBy = reviewerName;
      user.reviewedAt = new Date().toISOString();
      user.reviewNote = review.note?.trim() || undefined;
    },
    () => api.reviewAccessRequest(userId, review),
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
