/**
 * Creates the lm_inspect database (if missing), applies the schema and seeds the
 * demonstration corpus.
 *
 *   npm run db:setup          create + migrate + seed if empty
 *   npm run db:setup -- --reset   drop the contents and re-seed
 */
import 'dotenv/config';
import { Client } from 'pg';
import { DATABASE_URL, adminConnectionString, pool } from '../src/db/pool';
import { applySchema, isSeeded, seed, truncate } from '../src/db/seed';

const reset = process.argv.includes('--reset');
const redacted = DATABASE_URL.replace(/:[^:@/]*@/, ':****@');

async function ensureDatabase() {
  const { adminUrl, database } = adminConnectionString();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) {
      // Identifier cannot be parameterised; the name comes from our own config.
      await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
      console.log(`  created database "${database}"`);
    } else {
      console.log(`  database "${database}" already exists`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  console.log(`\n  LM-Inspect AI — database setup\n  target: ${redacted}\n`);

  await ensureDatabase();
  await applySchema();
  console.log('  schema applied');

  if (reset) {
    await truncate();
    console.log('  existing data cleared (--reset)');
  }

  if (reset || !(await isSeeded())) {
    const counts = await seed();
    console.log('  seeded:', counts);
  } else {
    console.log('  already seeded — pass --reset to rebuild');
  }

  await pool.end();
  console.log('\n  Done. Start the application with:  npm run dev\n');
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  Setup failed: ${message}\n`);
  if (/password|authentication/i.test(message)) {
    console.error(
      '  PostgreSQL rejected the credentials. Copy .env.example to .env and set\n' +
        '  DATABASE_URL to your local PostgreSQL user and password, for example:\n\n' +
        '    DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/lm_inspect\n',
    );
  }
  await pool.end().catch(() => undefined);
  process.exit(1);
});
