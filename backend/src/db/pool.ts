import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Connection pool.
 *
 * DATABASE_URL is read from .env — see .env.example. The default targets a local
 * PostgreSQL instance with the `lm_inspect` database created by `npm run db:setup`.
 */

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/lm_inspect';

/** Same server, but pointed at the maintenance database so `lm_inspect` can be created. */
export function adminConnectionString() {
  const url = new URL(DATABASE_URL);
  const database = url.pathname.replace(/^\//, '') || 'lm_inspect';
  url.pathname = '/postgres';
  return { adminUrl: url.toString(), database };
}

/**
 * A hosted database (Neon, Render, Supabase) sits hundreds of milliseconds away
 * and each new TLS connection costs seconds, so connections are kept open and
 * reused rather than dropped after ten idle seconds — the `pg` default.
 */
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10 * 60_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
});

export async function assertConnection() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach PostgreSQL at ${DATABASE_URL.replace(/:[^:@/]*@/, ':****@')}\n` +
        `  ${message}\n\n` +
        `  Fix: copy .env.example to .env, set DATABASE_URL with your PostgreSQL\n` +
        `  password, then run:  npm run db:setup`,
    );
  }
}
