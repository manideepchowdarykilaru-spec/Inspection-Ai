import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSeedCorpus } from '@shared/data/seedCorpus';
import { pool } from './pool';
import {
  insertEvidence,
  insertInspection,
  insertNotification,
  upsertProduct,
  upsertReport,
  upsertRule,
  upsertUser,
} from './repo';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function applySchema() {
  await pool.query(readFileSync(schemaPath, 'utf8'));
}

export async function isSeeded(): Promise<boolean> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM inspections');
  return rows[0].n > 0;
}

/** Wipes the operational tables. Reference data is re-inserted by seed(). */
export async function truncate() {
  await pool.query(
    `TRUNCATE audit_log, violations, evidence, reports, inspections, products,
              notifications, compliance_rules, password_resets, users, counters RESTART IDENTITY CASCADE`,
  );
}

export async function seed() {
  const corpus = buildSeedCorpus();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const user of corpus.users) await upsertUser(user, client);
    for (const rule of corpus.rules) await upsertRule(rule, client);
    for (const product of corpus.products) await upsertProduct(product, client);
    for (const inspection of corpus.inspections) await insertInspection(inspection, client);
    for (const evidence of corpus.evidence) await insertEvidence(evidence, client);
    for (const report of corpus.reports) await upsertReport(report, client);
    for (const notification of corpus.notifications) await insertNotification(notification, client);

    await client.query(
      `INSERT INTO counters (name, value) VALUES ('inspection', $1)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [corpus.sequence],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    users: corpus.users.length,
    products: corpus.products.length,
    inspections: corpus.inspections.length,
    evidence: corpus.evidence.length,
    reports: corpus.reports.length,
    rules: corpus.rules.length,
  };
}
