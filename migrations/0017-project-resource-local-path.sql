-- 0017: where a Project's repo actually lives on the machine serving it.
--
-- project_resource can say WHAT a resource is -- canonicalIdentity, type, relationship, whether the
-- owner has ratified it -- but not where its checkout sits on disk. So a Space that wants to serve
-- files from "the canonical TerraFusion repository" has nothing to resolve a directory from, and
-- nine routes fall back to `process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()`: one process-wide
-- directory with no Project attached. That is why the workspace can be TerraFusion by configuration
-- while the files underneath belong to whatever the launcher happened to export.
--
-- Deliberately per-node and nullable. A canonical identity is global; a checkout path is a fact
-- about ONE machine, and the same resource legitimately has no checkout on most of them. NULL means
-- "not checked out here", which lib/loom/project-workspace-root.ts reports as an unbound root
-- rather than treating as an error -- editing must never be blocked by a missing Project record.

ALTER TABLE "project_resource"
  ADD COLUMN "localPath" text,
  -- Which node that path is on. A path without a node is a path on somebody else's disk.
  ADD COLUMN "localPathNode" text;

COMMENT ON COLUMN "project_resource"."localPath" IS
  'Absolute path to this resource on localPathNode. NULL means not checked out on that node.';

-- The workspace-root resolver looks up "the repo of this Project, on this node".
CREATE INDEX "project_resource_local_path_idx"
  ON "project_resource" ("projectId", "type", "localPathNode");
