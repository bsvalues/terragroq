-- 0018: where a Project's service is actually served, PER NODE.
--
-- Same shape of gap as the checkout gap 0017 fixed, and for the same reason. project_resource can
-- say WHAT a service is -- its canonicalIdentity, relationship, ratification -- but not the URL it
-- is served at, and a URL is node/deployment-specific: the workspace app is one origin on HERMES,
-- another on OMEN, and absent on ATLAS. Hanging one URL off the canonical service row would be
-- WILLIAMOS_WORKSPACE_APP_URL rebuilt in the database, exactly the global-binding defect W1 removes.
--
-- Admission today (admitWorkspaceApp) takes one configured URL and proves it is reachable, frameable
-- and looks like TerraFusion by header or HTML text. That proves a page exists; it does NOT prove
-- the runtime belongs to the bound Project. This table records what the endpoint actually REPORTED
-- about itself -- which Project it claims, an observed service identity -- so admission can check
-- belonging, and keep the HTML/header look as a secondary sanity check.
--
-- The canonical service stays in project_resource; the servable endpoint is a binding of that
-- service TO A NODE. Absence of a row is normal: most services are not served on most nodes.

CREATE TABLE "project_service_endpoint" (
  "id"                    serial PRIMARY KEY,
  "projectResourceId"     integer NOT NULL
                            REFERENCES "project_resource" ("id") ON DELETE CASCADE,
  -- The node this endpoint is served from. A URL without a node is a URL on somebody else's box.
  "node"                  text NOT NULL,
  -- The servable origin, e.g. https://192.168.88.9:5199. Origin only; paths are the app's concern.
  "endpoint"             text NOT NULL,

  -- What the endpoint REPORTED about itself, as opposed to what we hoped it would be. This is the
  -- belonging proof: a runtime serving another Project is caught here rather than by a header that
  -- happens to say TerraFusion.
  "observedProjectId"     integer REFERENCES "project" ("id") ON DELETE SET NULL,
  "observedServiceIdentity" text,
  -- The revision the running service reported, so a deployed SHA can be proven equal to the landed
  -- one rather than assumed (the DEPLOY dependency's acceptance needs exactly this).
  "observedRevision"      text,
  "observedAt"            timestamptz,

  -- Agent-drafted until the owner confirms it. Anything derived from it may proceed, not certify.
  "ratifiedAt"            timestamptz,
  "ratifiedBy"            text,

  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);

-- One endpoint of a given service per node. Two endpoints for one service on one machine is the
-- ambiguity this table removes -- which origin is the workspace, and nothing able to say.
CREATE UNIQUE INDEX "project_service_endpoint_node_unique"
  ON "project_service_endpoint" ("projectResourceId", "node");

-- The runtime resolver asks "the service of this Project, on this node".
CREATE INDEX "project_service_endpoint_node_idx"
  ON "project_service_endpoint" ("node", "projectResourceId");
