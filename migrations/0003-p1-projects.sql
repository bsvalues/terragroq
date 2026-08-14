-- WO-P1-PROJECTS: link goal/work_order to the (pre-existing) project schema + complete seeds.
-- project + project_resource already exist (integer id, userId-scoped, WilliamOS + TerraFusion seeded).
-- This migration is additive and reversible (down = drop the projectId columns, delete the added seeds).
-- Private williamos DB only; no county/PACS/protected data; no authority-semantics change.

-- 1. projectId linkage (integer, nullable, additive) on goal + work_order
ALTER TABLE "goal" ADD COLUMN IF NOT EXISTS "projectId" integer REFERENCES "project"("id");
ALTER TABLE "work_order" ADD COLUMN IF NOT EXISTS "projectId" integer REFERENCES "project"("id");

-- 2. Ensure the LocalOps project exists (WilliamOS + TerraFusion already present)
INSERT INTO "project" ("userId", "key", "name", "lifecycle")
SELECT 'YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ', 'localops', 'LocalOps', 'standby'
WHERE NOT EXISTS (SELECT 1 FROM "project" WHERE "key" = 'localops');

-- 3. Complete resource bindings (join values to the integer project id by key), skip existing
INSERT INTO "project_resource" ("userId", "projectId", "type", "canonicalIdentity", "label", "relationship")
SELECT p."userId", p."id", v.type, v.identity, v.label, v.rel
FROM "project" p
JOIN (VALUES
  ('williamos', 'database', 'atlas/williamos', 'state DB', 'state'),
  ('williamos', 'node', 'HERMES', 'coordinator', 'coordinator'),
  ('williamos', 'node', 'AEGIS', 'worker', 'worker'),
  ('terrafusion', 'database', 'atlas/terrafusion', 'TerraFusion DB', 'state'),
  ('terrafusion', 'data_source', 'harris-pacs', 'Harris PACS (source)', 'source'),
  ('terrafusion', 'node', 'AEGIS', 'worker', 'worker'),
  ('localops', 'service', 'localops-agent', 'governed local agent', 'runtime'),
  ('localops', 'node', 'HERMES', 'host', 'host')
) AS v(pkey, type, identity, label, rel) ON p."key" = v.pkey
ON CONFLICT ("projectId", "type", "canonicalIdentity", "relationship") DO NOTHING;

-- 4. Backfill: the entire current corpus is WilliamOS self-development (Primary operator).
--    Test/legacy identities are intentionally left NULL.
UPDATE "goal" SET "projectId" = (SELECT "id" FROM "project" WHERE "key" = 'williamos')
  WHERE "projectId" IS NULL AND "userId" = 'YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ';
UPDATE "work_order" SET "projectId" = (SELECT "id" FROM "project" WHERE "key" = 'williamos')
  WHERE "projectId" IS NULL AND "userId" = 'YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ';

-- ---------------------------------------------------------------------------
-- ROLLBACK. The reliable reversal is a full restore from the pre-migration backup,
-- which captures the exact pre-state (WilliamOS + TerraFusion and their repo resources
-- PRE-EXISTED this migration, so their rows must NOT be blind-deleted):
--
--   psql -U williamos -d williamos < /forge/backups/williamos-preP1-*.sql
--
-- The added projectId columns are safe to drop on their own (this migration created them):
--   ALTER TABLE "work_order" DROP COLUMN IF EXISTS "projectId";
--   ALTER TABLE "goal" DROP COLUMN IF EXISTS "projectId";
-- Do NOT delete project / project_resource rows individually — restore from the backup
-- instead, so pre-existing projects and resources are preserved.
