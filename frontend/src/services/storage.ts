import type {
  AppNotification,
  ComplianceRule,
  Evidence,
  Inspection,
  Product,
  Report,
  User,
} from '@shared/types';
import * as api from './api';

/**
 * Client-side data layer.
 *
 * The PostgreSQL database is authoritative. The whole working set is hydrated in
 * one request at start-up and held in memory so selectors stay synchronous —
 * which is what lets every table, chart and counter read `getDb()` directly.
 * Each mutation updates the cache, notifies subscribers, and persists to the API
 * in the background; a failed write is rolled back by re-hydrating from the
 * server so the screen can never disagree with the database for long.
 */

export interface Database {
  users: User[];
  products: Product[];
  inspections: Inspection[];
  evidence: Evidence[];
  reports: Report[];
  notifications: AppNotification[];
  rules: ComplianceRule[];
}

const EMPTY: Database = {
  users: [],
  products: [],
  inspections: [],
  evidence: [],
  reports: [],
  notifications: [],
  rules: [],
};

let db: Database = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();
const errorListeners = new Set<(message: string) => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getDb(): Database {
  return db;
}

export function isHydrated() {
  return hydrated;
}

/** Writes still being persisted; a refresh must not overwrite their optimistic state. */
let inflightWrites = 0;

export async function hydrate(): Promise<void> {
  // A background refresh that lands between an optimistic update and the
  // server acknowledging it would briefly show the old state. Skip it; the
  // next refresh, or the write's own completion, brings the server truth.
  if (hydrated && inflightWrites > 0) return;
  const payload = await api.bootstrap();
  db = payload;
  hydrated = true;
  notify();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Surfaces background persistence failures so the UI can warn the officer. */
export function onSyncError(listener: (message: string) => void) {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

/**
 * Applies a change locally, then persists it.
 *
 * `sync` is what actually writes to PostgreSQL. If it rejects, the cache is
 * re-hydrated from the server rather than left holding an unsaved edit.
 */
export function mutate(updater: (draft: Database) => void, sync?: () => Promise<unknown>) {
  updater(db);
  notify();

  if (!sync) return;
  inflightWrites += 1;
  void sync().then(
    () => {
      inflightWrites -= 1;
    },
    async (error: unknown) => {
      inflightWrites -= 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[storage] persistence failed:', message);
      errorListeners.forEach((fn) => fn(message));
      await hydrate().catch(() => undefined);
    },
  );
}

/** Restores the seeded demonstration corpus in the database. */
export async function resetDatabase() {
  await api.resetDemoData();
  await hydrate();
}

export async function nextSequence(): Promise<number> {
  return api.nextSequence();
}

/* Re-exported so existing imports keep working. */
export { ALL_CASES, caseById, caseByImageId, registerCase } from '@shared/data/seedCorpus';
