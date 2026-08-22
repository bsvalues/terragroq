-- Disposable pre-write rollback fixture for 0001 only.
ALTER TABLE ai_evalops.schema_release
  ALTER COLUMN compatibility_floor DROP NOT NULL;
