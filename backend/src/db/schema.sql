-- LM-Inspect AI — PostgreSQL schema
--
-- Entities that are queried, filtered and mutated individually are normalised.
-- The analysis payload of an inspection (declarations, rule results, score
-- breakdown) is stored as JSONB because it is an immutable snapshot of what the
-- engine produced at that moment: it is read as a whole and must never drift
-- when the rule catalogue is later amended.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  official_id    TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('ADMIN', 'SUPERVISOR', 'INSPECTOR')),
  designation    TEXT NOT NULL,
  department     TEXT NOT NULL,
  region         TEXT NOT NULL,
  phone          TEXT,
  avatar_initials TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  legal_reference TEXT NOT NULL,
  description     TEXT NOT NULL,
  declaration_key TEXT,
  validation_type TEXT NOT NULL,
  mandatory       BOOLEAN NOT NULL DEFAULT true,
  severity        TEXT NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  weight          INTEGER NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  params          JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  brand                TEXT NOT NULL,
  category             TEXT NOT NULL,
  manufacturer         TEXT,
  manufacturer_address TEXT,
  packer               TEXT,
  importer             TEXT,
  country_of_origin    TEXT,
  net_quantity         TEXT,
  mrp                  NUMERIC(10, 2) DEFAULT 0,
  packed_on            TEXT,
  best_before          TEXT,
  consumer_care        TEXT,
  fssai_license        TEXT,
  barcode              TEXT,
  batch_number         TEXT,
  image_id             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_inspected_at    TIMESTAMPTZ,
  inspection_count     INTEGER NOT NULL DEFAULT 0,
  latest_score         INTEGER,
  latest_status        TEXT,
  open_violations      INTEGER NOT NULL DEFAULT 0,
  repeat_offender      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS inspections (
  id               TEXT PRIMARY KEY,
  product_id       TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  brand            TEXT NOT NULL,
  category         TEXT NOT NULL,
  inspector_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  inspector_name   TEXT NOT NULL,
  region           TEXT NOT NULL,
  location         TEXT NOT NULL,
  inspected_at     TIMESTAMPTZ NOT NULL,
  source           TEXT NOT NULL,
  stage            TEXT NOT NULL,
  status           TEXT NOT NULL,
  screening_score  INTEGER NOT NULL,
  score_breakdown  JSONB NOT NULL,
  declarations     JSONB NOT NULL,
  rule_results     JSONB NOT NULL,
  ocr              JSONB,
  remarks          TEXT,
  report_id        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS violations (
  id                 TEXT PRIMARY KEY,
  inspection_id      TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  rule_id            TEXT NOT NULL,
  title              TEXT NOT NULL,
  category           TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  detected           TEXT,
  explanation        TEXT,
  recommended_action TEXT,
  legal_reference    TEXT,
  confidence         NUMERIC(4, 3),
  evidence_region    JSONB,
  state              TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'VERIFIED', 'DISMISSED')),
  officer_note       TEXT,
  verified_by        TEXT,
  verified_at        TIMESTAMPTZ,
  position           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  evidence_number TEXT NOT NULL,
  type            TEXT NOT NULL,
  image_id        TEXT NOT NULL,
  data_url        TEXT,
  description     TEXT,
  captured_at     TIMESTAMPTZ NOT NULL,
  uploaded_by     TEXT NOT NULL,
  checksum        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id                TEXT PRIMARY KEY,
  inspection_id     TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  product_name      TEXT NOT NULL,
  brand             TEXT NOT NULL,
  generated_at      TIMESTAMPTZ NOT NULL,
  generated_by      TEXT NOT NULL,
  status            TEXT NOT NULL,
  format            TEXT NOT NULL,
  screening_score   INTEGER NOT NULL,
  compliance_status TEXT NOT NULL,
  violation_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  detail        TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  priority   TEXT NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  category   TEXT NOT NULL,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sequence backing the human-readable LM-2026-#### inspection identifiers.
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inspections_inspected_at ON inspections (inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_product      ON inspections (product_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector    ON inspections (inspector_id, status);
CREATE INDEX IF NOT EXISTS idx_violations_inspection    ON violations (inspection_id);
CREATE INDEX IF NOT EXISTS idx_violations_rule_state    ON violations (rule_id, state);
CREATE INDEX IF NOT EXISTS idx_evidence_inspection      ON evidence (inspection_id);
CREATE INDEX IF NOT EXISTS idx_audit_inspection         ON audit_log (inspection_id, at);
CREATE INDEX IF NOT EXISTS idx_products_brand           ON products (brand);
CREATE INDEX IF NOT EXISTS idx_reports_generated_at     ON reports (generated_at DESC);
