BEGIN;

-- #876 / #871 boundary 2, proved insufficient by acceptance run 4.
--
-- project_resource could describe the PARTS of PACS -- the owning node, the backups, the restore, the
-- derivative database -- but nothing named the resource those parts belong to. Resolution asked for
-- "PACS" and got RESOURCE_UNKNOWN, because no row is called PACS: they are called aegis and
-- atlas:/forge/sources/pacs/... The project grouping is the wrong level, since PACS is one resource of
-- the TerraFusion project rather than a project itself.
--
-- One column, added only because the acceptance run proved the model insufficient rather than because
-- a richer model seemed nicer.

ALTER TABLE "project_resource"
  ADD COLUMN IF NOT EXISTS "resourceKey" text;

CREATE INDEX IF NOT EXISTS "project_resource_resource_key_idx"
  ON "project_resource" ("userId", "resourceKey");

COMMIT;
