BEGIN;

-- #876 / #871 boundary 2: a resource must resolve to a governed record.
--
-- project_resource already models the parts that are relationships between things -- the owning node,
-- the source artefacts, the runtime, the canonical derivatives, and the evidence of completed work are
-- all resources related to the same project. Two facts about a resource are not relationships and had
-- nowhere to live:
--
--   allowedOperations  what may be done to it at all
--   ratifiedAt/By      whether a human has confirmed this record is true
--
-- The second exists because the first version of any resource record is drafted by an agent from
-- artefacts it found. A canonical record carrying a guess is worse than no record: every later answer
-- inherits the guess and states it with confidence, which is exactly how the PACS incident produced two
-- wrong public claims. An unratified record must therefore be able to say so.

ALTER TABLE "project_resource"
  ADD COLUMN IF NOT EXISTS "allowedOperations" text[] NOT NULL DEFAULT '{}';

ALTER TABLE "project_resource"
  ADD COLUMN IF NOT EXISTS "ratifiedAt" timestamptz;

ALTER TABLE "project_resource"
  ADD COLUMN IF NOT EXISTS "ratifiedBy" text;

COMMIT;
