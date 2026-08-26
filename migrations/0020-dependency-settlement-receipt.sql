-- 0020: structured, fence-bound proof that a routed dependency was settled BY the executor.
--
-- LAND's second fact -- "the resolution went through the HERMES executor, not a manual UPDATE" --
-- must not rest on settlement PROSE. A hand-written UPDATE can set resolution = 'settled by queue
-- #23' as easily as the executor can. The proof is this receipt: structured fields the executor
-- produces from a real leased/fenced execution, which a manual settlement cannot forge without also
-- fabricating a matching live lease/fence.
--
-- The receipt binds the canonical dependency to the queue projection that executed it, under the
-- exact HERMES lease/fence, with the acceptance evidence (bindW1Runtime = bound, observed Project,
-- observed revision). LAND queries these fields, never the settlement text.

CREATE TABLE "dependency_settlement_receipt" (
  "id"                     serial PRIMARY KEY,
  "canonicalDependencyId"  integer NOT NULL REFERENCES "routed_dependency" ("id") ON DELETE CASCADE,
  "projectionQueueItemId"  integer NOT NULL REFERENCES "outcome_queue_item" ("id") ON DELETE CASCADE,
  -- The queue terminal receipt that released the lease for this execution.
  "queueTerminalKey"       text,
  -- The lease/fence identity the execution actually held. Validated against the live queue row at
  -- settlement time; a receipt whose fence did not match an active lease is rejected.
  "leaseHolder"            text NOT NULL,
  "fencingToken"           integer NOT NULL,
  "executionBinding"       text NOT NULL,
  -- The structured discriminator. Only 'projection_executor' proves the graph ran itself; any manual
  -- path would have to lie in this field AND forge a matching fence.
  "settlementMethod"       text NOT NULL DEFAULT 'projection_executor',
  "routingState"           text NOT NULL,
  -- The acceptance evidence, structured.
  "bindW1RuntimeBound"     boolean NOT NULL,
  "observedProjectId"      integer,
  "observedRevision"       text,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "dependency_settlement_receipt_method_check"
    CHECK ("settlementMethod" IN ('projection_executor')),
  CONSTRAINT "dependency_settlement_receipt_routing_check"
    CHECK ("routingState" IN ('resolved', 'refused'))
);

-- One receipt per (dependency, projection) execution.
CREATE UNIQUE INDEX "dependency_settlement_receipt_dep_projection_idx"
  ON "dependency_settlement_receipt" ("canonicalDependencyId", "projectionQueueItemId", "fencingToken");

CREATE INDEX "dependency_settlement_receipt_dep_idx"
  ON "dependency_settlement_receipt" ("canonicalDependencyId");
