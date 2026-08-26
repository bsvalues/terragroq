-- 0016: routed dependencies, and the narrowing of `blocked`.
--
-- An executor that cannot perform ONE operation is not unemployed. The dependency is recorded, the
-- router takes it elsewhere, and the original contract keeps working every independent path. The
-- failure this replaces is small and expensive: "Claude cannot modify this config file" becoming
-- "frontend development stops."
--
-- A dependency therefore sits BESIDE an active work order and does not consume its lifecycle.
-- `blocked` is not deleted, it is narrowed to a computed condition -- see
-- lib/work-orders/routed-dependency.ts -- so that a single forbidden mutation can never reach it.

CREATE TABLE "routed_dependency" (
  "id"                   serial PRIMARY KEY,
  -- The work order that REMAINS ACTIVE while this is routed elsewhere.
  "workOrderId"          integer NOT NULL REFERENCES "work_order" ("id") ON DELETE CASCADE,

  -- The concrete operation that could not be performed. Prose, but specific prose: "modify
  -- deploy/hermes/start-williamos-live.ps1", not "config problem".
  "operation"            text NOT NULL,

  -- What authority WOULD have been needed: resource x class x capability.
  "requiredResource"     text,
  "requiredClass"        text,
  "requiredCapability"   text,
  -- Non-authority blockers: an unreachable node, an absent credential, a service that is down.
  "requiredCapabilityNonAuth" text,

  -- The wall or error actually observed. Not a summary of it.
  "evidence"             text[] NOT NULL DEFAULT '{}',

  "routingState"         text NOT NULL DEFAULT 'raised',
  -- Set when the router hands this to another envelope.
  "assignedWorkOrderId"  integer REFERENCES "work_order" ("id") ON DELETE SET NULL,
  "assignee"             text,

  -- Does final acceptance actually depend on this, or is it merely inconvenient? Only dependencies
  -- with this set can contribute to `blocked`.
  "blocksAcceptance"     boolean NOT NULL DEFAULT false,

  "raisedBy"             text,
  "raisedAt"             timestamptz NOT NULL DEFAULT now(),
  "routedAt"             timestamptz,
  "resolvedAt"           timestamptz,
  "resolution"           text,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "routed_dependency_state_check" CHECK (
    "routingState" IN ('raised', 'routed', 'accepted', 'resolved', 'refused')
  ),
  CONSTRAINT "routed_dependency_class_check" CHECK (
    "requiredClass" IS NULL OR "requiredClass" IN (
      'source', 'artifact', 'runtime_config', 'runtime_control',
      'data', 'secrets', 'delivery', 'external'
    )
  ),
  -- A dependency that names no unavailable capability at all is a note, not a routable item.
  CONSTRAINT "routed_dependency_names_a_need" CHECK (
    "requiredClass" IS NOT NULL OR "requiredCapabilityNonAuth" IS NOT NULL
  ),
  -- Routing to the work order that raised it is a loop, not a route.
  CONSTRAINT "routed_dependency_no_self_route" CHECK (
    "assignedWorkOrderId" IS NULL OR "assignedWorkOrderId" <> "workOrderId"
  )
);

-- Evaluating `blocked` reads every open dependency for one work order.
CREATE INDEX "routed_dependency_wo_state_idx"
  ON "routed_dependency" ("workOrderId", "routingState", "blocksAcceptance");

-- The router's queue: what has been raised and not yet placed.
CREATE INDEX "routed_dependency_routing_idx"
  ON "routed_dependency" ("routingState", "raisedAt");

CREATE INDEX "routed_dependency_assigned_idx"
  ON "routed_dependency" ("assignedWorkOrderId");
