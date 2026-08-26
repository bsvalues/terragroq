-- 0015: truth binding -- what a work order is actually working on.
--
-- work_order could not say. No projectId, no resource reference, no revision; only allowedFiles[]
-- and forbiddenFiles[], which are path strings with no repository, no branch and no SHA. A contract
-- could not express "canonical Project X, repo Y, at SHA Z", so an executor could do genuinely
-- correct work against genuinely the wrong tree and nothing in the record contradicted it.
--
-- Binding happens at ACTIVATION, not at acceptance. Binding first at acceptance is too late: an
-- executor can spend days on the wrong checkout and discover the failed premise only when it tries
-- to certify. Revision movement is recorded as an explicit lineage event and never assumed.
--
-- project_resource already carries canonicalIdentity, type, relationship, allowedOperations and
-- ratifiedAt/ratifiedBy, so this does NOT restate resource truth -- it references it. The one thing
-- project_resource genuinely lacks is a revision, which is why revisions live in the lineage here
-- rather than on the resource.

-- One binding per work order. Superseding a binding keeps the old row: a contract's history of what
-- it believed it was working on is part of the governance record.
CREATE TABLE "work_order_truth_binding" (
  "id"                  serial PRIMARY KEY,
  "workOrderId"         integer NOT NULL REFERENCES "work_order" ("id") ON DELETE CASCADE,
  "projectId"           integer NOT NULL REFERENCES "project" ("id") ON DELETE RESTRICT,
  -- The resource the running application must be served FROM. Derived from the Project, never an
  -- ambient environment URL.
  "runtimeResourceKey"  text,
  "status"              text NOT NULL DEFAULT 'bound',
  "boundAt"             timestamptz NOT NULL DEFAULT now(),
  "boundBy"             text,
  "supersededAt"        timestamptz,
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_order_truth_binding_status_check"
    CHECK ("status" IN ('bound', 'superseded'))
);

-- A work order has at most one binding in force at a time.
CREATE UNIQUE INDEX "work_order_truth_binding_active_unique"
  ON "work_order_truth_binding" ("workOrderId")
  WHERE "status" = 'bound';

CREATE INDEX "work_order_truth_binding_project_idx"
  ON "work_order_truth_binding" ("projectId", "status");

-- The canonical resources this contract is bound to. canonicalIdentity and ratifiedAt are SNAPSHOTS
-- taken at binding time: if the resource record is later edited, acceptance must still be judged
-- against what the contract was actually activated against.
CREATE TABLE "work_order_bound_resource" (
  "id"                 serial PRIMARY KEY,
  "bindingId"          integer NOT NULL
                         REFERENCES "work_order_truth_binding" ("id") ON DELETE CASCADE,
  "resourceKey"        text NOT NULL,
  "projectResourceId"  integer REFERENCES "project_resource" ("id") ON DELETE SET NULL,
  "resourceType"       text NOT NULL,
  "canonicalIdentity"  text NOT NULL,
  "role"               text NOT NULL DEFAULT 'source',
  -- NULL means the owner has never confirmed this resource record. Work may proceed; acceptance
  -- must say so and cannot certify.
  "ratifiedAt"         timestamptz,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_order_bound_resource_role_check"
    CHECK ("role" IN ('source', 'runtime', 'data', 'reference'))
);

CREATE UNIQUE INDEX "work_order_bound_resource_unique"
  ON "work_order_bound_resource" ("bindingId", "resourceKey");

-- The revision lineage. Append-only: a contract's movement between revisions is evidence, and
-- rewriting it would defeat the point of binding at activation.
--
--   bound      the base revision captured at activation. Exactly one per resource, first.
--   rebound    the revision moved for a reason outside this contract (upstream advance, rebase).
--   successor  a revision this contract itself produced.
CREATE TABLE "work_order_binding_event" (
  "id"           serial PRIMARY KEY,
  "bindingId"    integer NOT NULL
                   REFERENCES "work_order_truth_binding" ("id") ON DELETE CASCADE,
  "resourceKey"  text NOT NULL,
  "event"        text NOT NULL,
  "sha"          text NOT NULL,
  "reason"       text,
  "recordedBy"   text,
  "at"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_order_binding_event_kind_check"
    CHECK ("event" IN ('bound', 'rebound', 'successor'))
);

CREATE INDEX "work_order_binding_event_lineage_idx"
  ON "work_order_binding_event" ("bindingId", "resourceKey", "at");

-- Exactly one base binding per resource. Everything after it is movement with a recorded reason.
CREATE UNIQUE INDEX "work_order_binding_event_base_unique"
  ON "work_order_binding_event" ("bindingId", "resourceKey")
  WHERE "event" = 'bound';

-- Acceptance attempts. An attempt is not the work order's fate: PREMISE_FAILED normally sends the
-- contract back to active to rebind and continue, and is terminal only when the outcome itself has
-- become impossible. `observed` holds what was actually seen, never what was requested.
CREATE TABLE "work_order_acceptance_attempt" (
  "id"           serial PRIMARY KEY,
  "workOrderId"  integer NOT NULL REFERENCES "work_order" ("id") ON DELETE CASCADE,
  "bindingId"    integer REFERENCES "work_order_truth_binding" ("id") ON DELETE SET NULL,
  "disposition"  text NOT NULL,
  "reason"       text,
  -- The verifier. A WilliamOS-owned deterministic verifier is the default and preferred path; a
  -- distinct principal is required only where the risk class needs judgment.
  "verifiedBy"   text NOT NULL,
  "verifierKind" text NOT NULL DEFAULT 'deterministic',
  "observed"     jsonb,
  "divergences"  jsonb,
  "at"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "work_order_acceptance_attempt_disposition_check"
    CHECK ("disposition" IN ('PASS', 'FAIL', 'PARTIAL', 'PREMISE_FAILED')),
  CONSTRAINT "work_order_acceptance_attempt_verifier_kind_check"
    CHECK ("verifierKind" IN ('deterministic', 'principal'))
);

CREATE INDEX "work_order_acceptance_attempt_wo_idx"
  ON "work_order_acceptance_attempt" ("workOrderId", "at");
