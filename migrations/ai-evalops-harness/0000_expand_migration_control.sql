-- AEH migration fixture: expand phase only; disposable validation until separately activated.
CREATE SCHEMA IF NOT EXISTS ai_evalops;

CREATE TABLE IF NOT EXISTS ai_evalops.schema_release (
  release_id text PRIMARY KEY,
  migration_digest text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('expand', 'contract', 'forward_fix')),
  backup_receipt_ref text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_evalops.schema_release
  ADD COLUMN IF NOT EXISTS compatibility_floor text;
