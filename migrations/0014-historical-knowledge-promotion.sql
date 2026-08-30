-- 0014: provenance-bound historical knowledge promotion.
--
-- Doctrine portion: historical inputs remain non-authoritative, inactive, and
-- outside ordinary Doctrine mutation and supersession lifecycles.

BEGIN;

ALTER TABLE "doctrine"
  ADD COLUMN IF NOT EXISTS "historicalCandidateId" text,
  ADD COLUMN IF NOT EXISTS "historicalClaimId" text,
  ADD COLUMN IF NOT EXISTS "historicalProvenance" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "doctrine_historical_candidate_user_idx"
  ON "doctrine" ("userId", "historicalCandidateId")
  WHERE "historicalCandidateId" IS NOT NULL;

DO $historical_doctrine_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctrine_historical_identity_check'
      AND conrelid = 'doctrine'::regclass
  ) THEN
    ALTER TABLE "doctrine"
      ADD CONSTRAINT "doctrine_historical_identity_check" CHECK (
        (
          "historicalCandidateId" IS NULL
          AND "historicalClaimId" IS NULL
          AND "historicalProvenance" IS NULL
          AND "status" NOT IN ('historical_input', 'historical_archived')
        ) OR (
          "historicalCandidateId" IS NOT NULL
          AND "historicalClaimId" IS NOT NULL
          AND "historicalProvenance" IS NOT NULL
          AND "status" IN ('historical_input', 'historical_archived')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctrine_historical_safety_check'
      AND conrelid = 'doctrine'::regclass
  ) THEN
    ALTER TABLE "doctrine"
      ADD CONSTRAINT "doctrine_historical_safety_check" CHECK (
        "historicalCandidateId" IS NULL OR (
          "active" = false
          AND "priority" = 0
          AND cardinality("allowed") = 0
          AND cardinality("forbidden") = 0
          AND cardinality("requiresApproval") = 0
          AND "locked" = false
          AND "supersedesId" IS NULL
          AND "supersededById" IS NULL
          AND COALESCE("historicalProvenance"->>'authority', '') = 'historical_non_authoritative'
        )
      );
  END IF;
END
$historical_doctrine_constraints$;

COMMIT;
