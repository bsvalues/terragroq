-- 0017: where a canonical resource is checked out, PER NODE.
--
-- project_resource can say WHAT a resource is -- canonicalIdentity, type, relationship, whether the
-- owner has ratified it -- but not where its checkout sits on disk. So a Space that wants to serve
-- files from "the canonical TerraFusion repository" has nothing to resolve a directory from, and
-- nine routes fall back to `process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()`.
--
-- The obvious fix is wrong. A checkout path is NOT a property of the canonical resource: the same
-- repository is at C:\... on HERMES, /srv/... on AEGIS, somewhere else again on OMEN, and absent on
-- ATLAS. project_resource holds one row per (projectId, type, canonicalIdentity, relationship), so
-- a path column there could hold exactly one node's answer -- which is WILLIAMOS_PROJECT_ROOT
-- rebuilt inside the database, with a node label making it look node-aware while structurally
-- permitting only one.
--
-- So the canonical repo stays in project_resource, and the physical checkout is a binding of that
-- resource TO A NODE. Absence of a row is meaningful and normal: most resources are not checked out
-- on most nodes.

CREATE TABLE "project_resource_checkout" (
  "id"                  serial PRIMARY KEY,
  "projectResourceId"   integer NOT NULL
                          REFERENCES "project_resource" ("id") ON DELETE CASCADE,
  -- The node this path is on. A path without a node is a path on somebody else's disk.
  "node"                text NOT NULL,
  "path"                text NOT NULL,

  -- What was last actually SEEN at that path, as opposed to what the resource claims. Kept
  -- separately and deliberately: a checkout whose remote does not match the canonical identity is
  -- the stale-worktree failure at its source, and it is only detectable if both are recorded.
  "observedIdentity"    text,
  "observedRevision"    text,
  "observedAt"          timestamptz,

  -- An agent may draft a checkout record from what it found on disk. Until the owner confirms it,
  -- anything derived from it can proceed but cannot certify.
  "ratifiedAt"          timestamptz,
  "ratifiedBy"          text,

  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

-- One checkout of a given resource per node. A second checkout of the same repo on the same machine
-- is exactly the ambiguity this table exists to remove -- two worktrees, one of them stale, and
-- nothing able to say which the workspace is serving.
CREATE UNIQUE INDEX "project_resource_checkout_node_unique"
  ON "project_resource_checkout" ("projectResourceId", "node");

-- The workspace-root resolver asks "the repo of this Project, on this node".
CREATE INDEX "project_resource_checkout_node_idx"
  ON "project_resource_checkout" ("node", "projectResourceId");
