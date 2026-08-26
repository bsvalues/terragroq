-- 0019: bind an outcome_queue_item to the canonical routed_dependency it projects.
--
-- routed_dependency is canonical work truth; outcome_queue_item is its executable lease projection.
-- The projection needs a DURABLE, EXPLICIT reference back to the dependency and the resource-scoped
-- v2 envelope it carries -- not a relationship parsed out of an outcomeKey string. These columns are
-- that binding. Existing queue rows have them NULL and are unaffected: a NULL canonicalDependencyId
-- is an ordinary (non-projection) outcome, exactly as today.
--
-- Authority is NOT stored as an A-level here. The real authority is (envelopeClass x
-- envelopeCapability) over envelopeResource; the queue's own authorityLevel stays at its neutral
-- default for projections, because the core engine gates on authorityState, not authorityLevel.
-- envelopeDigest binds the projection to the exact envelope + truth binding so acquisition can
-- refuse execution if either drifted.

ALTER TABLE "outcome_queue_item"
  ADD COLUMN "canonicalDependencyId" integer REFERENCES "routed_dependency" ("id") ON DELETE CASCADE,
  ADD COLUMN "envelopeResource"      text,
  ADD COLUMN "envelopeClass"         text,
  ADD COLUMN "envelopeCapability"    text,
  ADD COLUMN "envelopeDigest"        text;

-- Idempotency: at most ONE live projection per routed dependency. Running the projector twice must
-- not create two PROVISION jobs. A projection is "live" until the queue item reaches a terminal
-- lifecycle (completed or superseded); after that a dependency could legitimately be re-projected.
CREATE UNIQUE INDEX "outcome_queue_item_canonical_dependency_live_idx"
  ON "outcome_queue_item" ("canonicalDependencyId")
  WHERE "canonicalDependencyId" IS NOT NULL
    AND "lifecycleState" NOT IN ('completed', 'superseded');

CREATE INDEX "outcome_queue_item_canonical_dependency_idx"
  ON "outcome_queue_item" ("canonicalDependencyId");

-- A projection either binds all five projection fields or none (an ordinary outcome). Enforced as a
-- table check so a half-formed projection cannot exist.
ALTER TABLE "outcome_queue_item" ADD CONSTRAINT "outcome_queue_item_envelope_complete_check" CHECK (
  ("canonicalDependencyId" IS NULL AND "envelopeResource" IS NULL AND "envelopeClass" IS NULL
    AND "envelopeCapability" IS NULL AND "envelopeDigest" IS NULL)
  OR
  ("canonicalDependencyId" IS NOT NULL AND "envelopeResource" IS NOT NULL AND "envelopeClass" IS NOT NULL
    AND "envelopeCapability" IS NOT NULL AND "envelopeDigest" IS NOT NULL)
);
