import { createHash } from "node:crypto"

import {
  LEGAL_OUTCOME_TRANSITIONS,
  mapLegacyLifecycleState,
  NO_SELECTION_REASONS,
  OUTCOME_LIFECYCLE_STATES,
  TERMINAL_OUTCOME_STATES,
} from "../../lib/outcome-queue/contract.mjs"

const QUEUE_STATES = new Set(OUTCOME_LIFECYCLE_STATES)
const APPROVAL_STATES = new Set(["approved", "unapproved", "revoked"])
const AUTHORITY_STATES = new Set(["matched", "unverified", "denied", "expired", "revoked"])
const TERMINAL_STATES = new Set(TERMINAL_OUTCOME_STATES)
const LEGACY_GOAL_REFS = Object.freeze([
  "GOAL-0001",
  "GOAL-0002",
  "GOAL-0003",
  "GOAL-0004",
  "GOAL-0005",
])

const QUEUE_COLUMNS = `
  q."id",
  q."userId",
  q."outcomeKey",
  q."goalId",
  q."goalRef",
  q."title",
  q."objective",
  q."queueOrder",
  q."dependencyKeys",
  q."riskClass",
  q."approvalState",
  q."approvedBy",
  q."approvedAt",
  q."approvalDecisionId",
  q."authorityState",
  q."authorityLevel",
  q."authorityGrantRef",
  q."authoritySubject",
  q."authorityAction",
  q."lifecycleState",
  q."lifecycleReason",
  q."activeWorkOrderId",
  q."executionBinding",
  q."leaseHolder",
  q."leaseToken",
  q."leaseExpiresAt",
  q."fencingToken",
  q."version",
  q."acquisitionKey",
  q."terminalResult",
  q."terminalEvidenceId",
  q."terminalEvidenceRefs",
  q."terminalKey",
  q."supersedesOutcomeKey",
  q."supersededByOutcomeKey",
  q."suggestedAt",
  q."activatedAt",
  q."terminalAt",
  q."createdAt",
  q."updatedAt"
`

const ORDER_BY = `
  q."queueOrder" ASC,
  q."createdAt" ASC,
  q."outcomeKey" ASC
`

export const OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL = `
  q."riskClass" IN ('R0', 'R1')
  AND q."authorityLevel" IN ('A0_READ_ONLY', 'A1_DRAFT', 'A2_WRITE_OWN')
  AND q."authoritySubject" = 'operator'
  AND q."authorityAction" = 'outcome:execute'
  AND concat_ws(' ', q."outcomeKey", q."title", COALESCE(q."objective", '')) !~*
    '(terrafusion|terrapilot|property[[:space:]]+workbench|county|pacs|parcel|taxpayer|protected[[:space:]]+data|(deploy|release|cutover|mutat|writ|chang|updat|configur)[[:alnum:]_]*.{0,40}production|production.{0,40}(deploy|release|cutover|mutat|writ|chang|updat|configur)[[:alnum:]_]*|(create|publish|cut|push)[[:space:]]+(a[[:space:]]+)?(github[[:space:]]+)?release|(create|publish|push)[[:space:]]+(a[[:space:]]+)?(git[[:space:]]+)?tag|tag[[:space:]]+v?[0-9]|secret|password|credential|api[ -]?key|access[ -]?token|cookie|session|paid[[:space:]]+overage|increase[[:space:]]+(the[[:space:]]+)?spend|new[[:space:]]+spending|purchase|billing[[:space:]]+upgrade|destructive|delete|drop[[:space:]]+(table|database)|truncate|force[ -]?push|reset[[:space:]]+--hard|wipe|purge|issue[[:space:]]*#?357)'
`

const LIVE_APPROVAL_PREDICATE = `
  q."approvalState" = 'approved'
  AND EXISTS (
    SELECT 1
    FROM "decision" AS live_approval
    WHERE live_approval."id" = q."approvalDecisionId"
      AND live_approval."userId" = q."userId"
      AND live_approval."status" = 'accepted'
      AND live_approval."authority" = 'binding'
      AND upper(trim(live_approval."decision")) = 'APPROVE'
      AND live_approval."scope" = q."outcomeKey"
  )
`

const LIVE_AUTHORITY_PREDICATE = `
  ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
  AND q."authorityState" = 'matched'
  AND EXISTS (
    SELECT 1
    FROM "authority_grant" AS live_grant
    WHERE live_grant."userId" = q."userId"
      AND live_grant."ref" = q."authorityGrantRef"
      AND live_grant."status" = 'active'
      AND live_grant."revokedAt" IS NULL
      AND (live_grant."expiresAt" IS NULL OR live_grant."expiresAt" > $1::timestamptz)
      AND live_grant."authorityLevel" = q."authorityLevel"
      AND live_grant."grantedTo" = q."authoritySubject"
      AND live_grant."scope" = q."outcomeKey"
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(live_grant."blockedActions") AS blocked(action)
        WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
      )
      AND (
        cardinality(live_grant."allowedActions") = 0
        OR EXISTS (
          SELECT 1
          FROM unnest(live_grant."allowedActions") AS allowed(action)
          WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
        )
      )
      AND (
        live_grant."workOrderId" IS NULL
        OR q."activeWorkOrderId" = live_grant."workOrderId"
      )
  )
`

const ACQUISITION_AUTHORITY_PREDICATE = LIVE_AUTHORITY_PREDICATE.replaceAll(
  `q."activeWorkOrderId" = live_grant."workOrderId"`,
  `COALESCE($8, q."activeWorkOrderId") = live_grant."workOrderId"`,
)

const ELIGIBILITY_PREDICATE = `
  q."userId" = $2
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${ACQUISITION_AUTHORITY_PREDICATE}
  AND q."riskClass" IN ('R0', 'R1')
  AND (
    q."lifecycleState" = 'approved'
    OR (
      q."lifecycleState" = 'active'
      AND q."leaseExpiresAt" <= $1::timestamptz
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" AS completed_dependency
      ON completed_dependency."userId" = q."userId"
      AND completed_dependency."outcomeKey" = dependency."outcomeKey"
    WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "outcome_queue_item" AS live
    WHERE live."userId" = q."userId"
      AND live."lifecycleState" = 'active'
      AND live."leaseExpiresAt" > $1::timestamptz
  )
`

export const OUTCOME_QUEUE_SQL = Object.freeze({
  ensureOutcomeQueueItemTable: `
CREATE TABLE IF NOT EXISTS "outcome_queue_item" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "outcomeKey" text NOT NULL,
  "goalId" integer REFERENCES "goal"("id") ON DELETE SET NULL,
  "goalRef" text,
  "title" text NOT NULL,
  "objective" text,
  "queueOrder" integer NOT NULL DEFAULT 0,
  "dependencyKeys" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "riskClass" text NOT NULL DEFAULT 'R1',
  "approvalState" text NOT NULL DEFAULT 'unapproved',
  "approvedBy" text,
  "approvedAt" timestamptz,
  "approvalDecisionId" integer REFERENCES "decision"("id") ON DELETE SET NULL,
  "authorityState" text NOT NULL DEFAULT 'unverified',
  "authorityLevel" text NOT NULL DEFAULT 'A0_READ_ONLY',
  "authorityGrantRef" text,
  "authoritySubject" text NOT NULL DEFAULT 'operator',
  "authorityAction" text NOT NULL DEFAULT 'outcome:execute',
  "lifecycleState" text NOT NULL DEFAULT 'suggested',
  "lifecycleReason" text,
  "activeWorkOrderId" integer REFERENCES "work_order"("id") ON DELETE SET NULL,
  "executionBinding" text,
  "leaseHolder" text,
  "leaseToken" text,
  "leaseExpiresAt" timestamptz,
  "fencingToken" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 0,
  "acquisitionKey" text,
  "terminalResult" text,
  "terminalEvidenceId" integer,
  "terminalEvidenceRefs" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "terminalKey" text,
  "supersedesOutcomeKey" text,
  "supersededByOutcomeKey" text,
  "suggestedAt" timestamptz NOT NULL DEFAULT NOW(),
  "activatedAt" timestamptz,
  "terminalAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_queue_item_user_key_idx"
  ON "outcome_queue_item" ("userId", "outcomeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_queue_item_user_acquisition_idx"
  ON "outcome_queue_item" ("userId", "acquisitionKey");
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_queue_item_user_terminal_idx"
  ON "outcome_queue_item" ("userId", "terminalKey");
CREATE INDEX IF NOT EXISTS "outcome_queue_item_selection_idx"
  ON "outcome_queue_item" (
    "userId", "lifecycleState", "approvalState", "authorityState", "queueOrder"
  );
CREATE INDEX IF NOT EXISTS "outcome_queue_item_lease_idx"
  ON "outcome_queue_item" ("userId", "lifecycleState", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "outcome_queue_item_goal_idx"
  ON "outcome_queue_item" ("goalId");
CREATE INDEX IF NOT EXISTS "outcome_queue_item_approval_decision_idx"
  ON "outcome_queue_item" ("approvalDecisionId");
CREATE INDEX IF NOT EXISTS "outcome_queue_item_work_order_idx"
  ON "outcome_queue_item" ("activeWorkOrderId")
`,
  ensureMutationReceiptTable: `
CREATE TABLE IF NOT EXISTS "outcome_queue_mutation_receipt" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "operation" text NOT NULL,
  "outcomeKey" text,
  "requestHash" text NOT NULL,
  "requestBinding" jsonb NOT NULL,
  "resultBinding" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "outcome_queue_mutation_receipt_user_key_unique"
    UNIQUE ("userId", "idempotencyKey")
)
`,
  ensureMutationReceiptOutcomeIndex: `
CREATE INDEX IF NOT EXISTS "outcome_queue_mutation_receipt_user_outcome_idx"
  ON "outcome_queue_mutation_receipt" ("userId", "outcomeKey", "createdAt")
`,
  ensureAcquisitionReceiptTable: `
CREATE TABLE IF NOT EXISTS "outcome_queue_acquisition_receipt" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "acquisitionKey" text NOT NULL,
  "outcomeKey" text NOT NULL,
  "firstFencingToken" integer NOT NULL,
  "latestFencingToken" integer NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "outcome_queue_acquisition_receipt_user_key_unique"
    UNIQUE ("userId", "acquisitionKey"),
  CONSTRAINT "outcome_queue_acquisition_receipt_fence_check"
    CHECK (
      "firstFencingToken" > 0
      AND "latestFencingToken" >= "firstFencingToken"
    )
)
`,
  ensureAcquisitionReceiptOutcomeIndex: `
CREATE INDEX IF NOT EXISTS "outcome_queue_acquisition_receipt_user_outcome_idx"
  ON "outcome_queue_acquisition_receipt" ("userId", "outcomeKey")
`,
  ensureGoalOutcomeIntakeReceiptTable: `
CREATE TABLE IF NOT EXISTS "goal_outcome_intake_receipt" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "requestHash" text NOT NULL,
  "goalId" integer NOT NULL REFERENCES "goal"("id") ON DELETE RESTRICT,
  "outcomeKey" text NOT NULL,
  "resultDigest" text NOT NULL,
  "replayCount" integer NOT NULL DEFAULT 0,
  "firstSubmittedAt" timestamptz NOT NULL DEFAULT NOW(),
  "lastReplayedAt" timestamptz,
  CONSTRAINT "goal_outcome_intake_receipt_user_key_unique"
    UNIQUE ("userId", "idempotencyKey"),
  CONSTRAINT "goal_outcome_intake_receipt_user_goal_unique"
    UNIQUE ("userId", "goalId"),
  CONSTRAINT "goal_outcome_intake_receipt_user_outcome_unique"
    UNIQUE ("userId", "outcomeKey"),
  CONSTRAINT "goal_outcome_intake_receipt_replay_count_check"
    CHECK ("replayCount" >= 0)
)
`,
  ensureAcquisitionAttemptTable: `
CREATE TABLE IF NOT EXISTS "outcome_queue_acquisition_attempt" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "campaignWindowId" text NOT NULL,
  "processIdentity" text NOT NULL,
  "leaseHolder" text NOT NULL,
  "acquisitionKeyDigest" text NOT NULL,
  "leaseIdentityDigest" text NOT NULL,
  "checkpointDigest" text NOT NULL,
  "checkpointOutcomeId" text NOT NULL,
  "checkpointSequence" integer NOT NULL,
  "checkpointState" text NOT NULL,
  "checkpointHeadSha" text,
  "checkpointMergeSha" text,
  "checkpointPrNumber" integer,
  "outcomeKey" text,
  "fencingToken" integer,
  "leaseExpiresAt" timestamptz,
  "activeWorkOrderId" integer,
  "disposition" text NOT NULL,
  "reason" text,
  "attemptedAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "outcome_queue_acquisition_attempt_fence_check"
    CHECK ("fencingToken" IS NULL OR "fencingToken" > 0),
  CONSTRAINT "outcome_queue_acquisition_attempt_checkpoint_check"
    CHECK (
      "checkpointSequence" >= 0
      AND ("checkpointPrNumber" IS NULL OR "checkpointPrNumber" > 0)
    )
)
`,
  ensureMutationAttemptTable: `
CREATE TABLE IF NOT EXISTS "outcome_queue_mutation_attempt" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "requestHash" text NOT NULL,
  "resultDigest" text NOT NULL,
  "attemptOrdinal" integer NOT NULL,
  "disposition" text NOT NULL,
  "attemptedAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "outcome_queue_mutation_attempt_user_ordinal_unique"
    UNIQUE ("userId", "idempotencyKey", "attemptOrdinal"),
  CONSTRAINT "outcome_queue_mutation_attempt_ordinal_check"
    CHECK ("attemptOrdinal" > 0),
  CONSTRAINT "outcome_queue_mutation_attempt_disposition_check"
    CHECK ("disposition" IN ('COMMITTED', 'REPLAY'))
)
`,
  ensureAcquisitionAttemptIndexes: `
CREATE INDEX IF NOT EXISTS "outcome_queue_acquisition_attempt_campaign_idx"
  ON "outcome_queue_acquisition_attempt" ("userId", "campaignWindowId", "attemptedAt");
CREATE INDEX IF NOT EXISTS "outcome_queue_acquisition_attempt_identity_idx"
  ON "outcome_queue_acquisition_attempt" ("userId", "acquisitionKeyDigest", "attemptedAt")
`,
  ensureMutationAttemptRequestIndex: `
CREATE INDEX IF NOT EXISTS "outcome_queue_mutation_attempt_request_idx"
  ON "outcome_queue_mutation_attempt" ("userId", "requestHash", "attemptedAt")
`,
  readReceiptColumns: `
SELECT table_class.relname AS "tableName",
       attribute.attname AS "columnName",
       format_type(attribute.atttypid, attribute.atttypmod) AS "dataType",
       attribute.attnotnull AS "notNull",
       pg_get_expr(column_default.adbin, column_default.adrelid, true) AS "defaultExpression"
FROM pg_class AS table_class
JOIN pg_attribute AS attribute
  ON attribute.attrelid = table_class.oid
LEFT JOIN pg_attrdef AS column_default
  ON column_default.adrelid = attribute.attrelid
  AND column_default.adnum = attribute.attnum
WHERE table_class.oid IN (
    '"outcome_queue_mutation_receipt"'::regclass,
    '"outcome_queue_acquisition_receipt"'::regclass,
    '"goal_outcome_intake_receipt"'::regclass,
    '"outcome_queue_acquisition_attempt"'::regclass,
    '"outcome_queue_mutation_attempt"'::regclass
  )
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
ORDER BY table_class.relname ASC, attribute.attnum ASC
`,
  readReceiptConstraints: `
SELECT table_class.relname AS "tableName",
       constraint_record.conname AS "constraintName",
       constraint_record.contype AS "constraintType",
       constraint_record.convalidated AS "validated",
       pg_get_constraintdef(constraint_record.oid, true) AS "definition"
FROM pg_constraint AS constraint_record
JOIN pg_class AS table_class
  ON table_class.oid = constraint_record.conrelid
WHERE constraint_record.conrelid IN (
    '"outcome_queue_mutation_receipt"'::regclass,
    '"outcome_queue_acquisition_receipt"'::regclass,
    '"goal_outcome_intake_receipt"'::regclass,
    '"outcome_queue_acquisition_attempt"'::regclass,
    '"outcome_queue_mutation_attempt"'::regclass
  )
ORDER BY table_class.relname ASC, constraint_record.conname ASC
`,
  readLegacyMutationReceiptUniqueIndex: `
SELECT table_class.relname AS "tableName",
       index_class.relname AS "indexName",
       index_record.indisunique AS "unique",
       index_record.indisvalid AS "valid",
       index_record.indisready AS "ready",
       index_record.indisprimary AS "primary",
       index_record.indisexclusion AS "exclusion",
       index_record.indimmediate AS "immediate",
       index_record.indnatts = index_record.indnkeyatts AS "noIncludedColumns",
       index_record.indexprs IS NULL AS "noExpressions",
       access_method.amname AS "accessMethod",
       ARRAY(
         SELECT pg_get_indexdef(index_record.indexrelid, ordinal, true)
         FROM generate_series(1, index_record.indnkeyatts) AS ordinal
         ORDER BY ordinal
       ) AS "keyColumns",
       pg_get_expr(index_record.indpred, index_record.indrelid, true) AS "predicate",
       EXISTS (
         SELECT 1
         FROM pg_constraint AS index_constraint
         WHERE index_constraint.conindid = index_record.indexrelid
       ) AS "constraintBacked"
FROM pg_index AS index_record
JOIN pg_class AS table_class
  ON table_class.oid = index_record.indrelid
JOIN pg_class AS index_class
  ON index_class.oid = index_record.indexrelid
JOIN pg_am AS access_method
  ON access_method.oid = index_class.relam
WHERE table_class.oid = '"outcome_queue_mutation_receipt"'::regclass
  AND index_class.relname = 'outcome_queue_mutation_receipt_user_key_idx'
ORDER BY index_class.relname ASC
`,
  migrateLegacyMutationReceiptUniqueIndex: `
ALTER TABLE "outcome_queue_mutation_receipt"
  ADD CONSTRAINT "outcome_queue_mutation_receipt_user_key_unique"
  UNIQUE USING INDEX "outcome_queue_mutation_receipt_user_key_idx"
`,
  migrateLegacyAcquisitionReceiptFenceChecks: `
ALTER TABLE "outcome_queue_acquisition_receipt"
  DROP CONSTRAINT "outcome_queue_acquisition_receipt_firstFencingToken_check",
  DROP CONSTRAINT "outcome_queue_acquisition_receipt_latestFencingToken_check",
  ADD CONSTRAINT "outcome_queue_acquisition_receipt_fence_check"
    CHECK (
      "firstFencingToken" > 0
      AND "latestFencingToken" >= "firstFencingToken"
    ) NOT VALID
`,
  validateAcquisitionReceiptFenceConstraint: `
ALTER TABLE "outcome_queue_acquisition_receipt"
  VALIDATE CONSTRAINT "outcome_queue_acquisition_receipt_fence_check"
`,
  readReceiptIndexes: `
SELECT table_class.relname AS "tableName",
       index_class.relname AS "indexName",
       index_record.indisunique AS "unique",
       index_record.indisvalid AS "valid",
       index_record.indisready AS "ready",
       ARRAY(
         SELECT pg_get_indexdef(index_record.indexrelid, ordinal, true)
         FROM generate_series(1, index_record.indnkeyatts) AS ordinal
         ORDER BY ordinal
       ) AS "keyColumns",
       pg_get_expr(index_record.indpred, index_record.indrelid, true) AS "predicate"
FROM pg_index AS index_record
JOIN pg_class AS table_class
  ON table_class.oid = index_record.indrelid
JOIN pg_class AS index_class
  ON index_class.oid = index_record.indexrelid
  WHERE index_class.relname IN (
    'outcome_queue_mutation_receipt_user_outcome_idx',
    'outcome_queue_acquisition_receipt_user_outcome_idx',
    'outcome_queue_acquisition_attempt_campaign_idx',
    'outcome_queue_acquisition_attempt_identity_idx',
    'outcome_queue_mutation_attempt_request_idx'
  )
ORDER BY index_class.relname ASC
`,
  inspectHardeningInvariantViolations: `
SELECT
  count(*) FILTER (
    WHERE "lifecycleState" NOT IN (
      'suggested', 'approved', 'blocked', 'active',
      'completed', 'declined', 'superseded'
    )
  )::integer AS "lifecycleViolationCount",
  count(*) FILTER (
    WHERE "approvalState" NOT IN ('unapproved', 'approved', 'revoked')
  )::integer AS "approvalViolationCount",
  count(*) FILTER (
    WHERE "authorityState" NOT IN (
      'unverified', 'matched', 'denied', 'expired', 'revoked'
    )
  )::integer AS "authorityViolationCount",
  count(*) FILTER (
    WHERE "fencingToken" < 0 OR "version" < 0
  )::integer AS "nonnegativeViolationCount",
  count(*) FILTER (
    WHERE "lifecycleState" = 'active'
      AND (
        "executionBinding" IS NULL
        OR "leaseHolder" IS NULL
        OR "leaseToken" IS NULL
        OR "leaseExpiresAt" IS NULL
        OR "acquisitionKey" IS NULL
        OR "fencingToken" <= 0
      )
  )::integer AS "activeBindingViolationCount",
  (
    SELECT count(*)::integer
    FROM (
      SELECT "userId"
      FROM "outcome_queue_item"
      WHERE "lifecycleState" = 'active'
      GROUP BY "userId"
      HAVING count(*) > 1
    ) AS duplicate_active_users
  ) AS "multipleActiveUserCount"
FROM "outcome_queue_item"
`,
  ensureOneActiveOutcomeIndex: `
DROP INDEX IF EXISTS "outcome_queue_item_one_active_per_user_idx";
CREATE UNIQUE INDEX "outcome_queue_item_one_active_per_user_idx"
  ON "outcome_queue_item" ("userId")
  WHERE "lifecycleState" = 'active'
`,
  ensureOutcomeQueueItemCheckConstraints: `
ALTER TABLE "outcome_queue_item"
  DROP CONSTRAINT IF EXISTS "outcome_queue_item_lifecycle_state_check",
  DROP CONSTRAINT IF EXISTS "outcome_queue_item_approval_state_check",
  DROP CONSTRAINT IF EXISTS "outcome_queue_item_authority_state_check",
  DROP CONSTRAINT IF EXISTS "outcome_queue_item_nonnegative_fence_check",
  DROP CONSTRAINT IF EXISTS "outcome_queue_item_active_binding_check";
ALTER TABLE "outcome_queue_item"
  ADD CONSTRAINT "outcome_queue_item_lifecycle_state_check"
    CHECK ("lifecycleState" IN (
      'suggested', 'approved', 'blocked', 'active',
      'completed', 'declined', 'superseded'
    )) NOT VALID,
  ADD CONSTRAINT "outcome_queue_item_approval_state_check"
    CHECK ("approvalState" IN ('unapproved', 'approved', 'revoked')) NOT VALID,
  ADD CONSTRAINT "outcome_queue_item_authority_state_check"
    CHECK ("authorityState" IN (
      'unverified', 'matched', 'denied', 'expired', 'revoked'
    )) NOT VALID,
  ADD CONSTRAINT "outcome_queue_item_nonnegative_fence_check"
    CHECK ("fencingToken" >= 0 AND "version" >= 0) NOT VALID,
  ADD CONSTRAINT "outcome_queue_item_active_binding_check"
    CHECK ("lifecycleState" <> 'active' OR (
      "executionBinding" IS NOT NULL
      AND "leaseHolder" IS NOT NULL
      AND "leaseToken" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND "acquisitionKey" IS NOT NULL
      AND "fencingToken" > 0
    )) NOT VALID
`,
  validateOutcomeQueueLifecycleConstraint: `
ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_lifecycle_state_check"
`,
  validateOutcomeQueueApprovalConstraint: `
ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_approval_state_check"
`,
  validateOutcomeQueueAuthorityConstraint: `
ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_authority_state_check"
`,
  validateOutcomeQueueNonnegativeFenceConstraint: `
ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_nonnegative_fence_check"
`,
  validateOutcomeQueueActiveBindingConstraint: `
ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_active_binding_check"
`,
  readOutcomeQueueHardeningConstraints: `
SELECT conname AS "constraintName",
       convalidated AS "validated",
       pg_get_constraintdef(oid, true) AS "definition"
FROM pg_constraint
WHERE conrelid = '"outcome_queue_item"'::regclass
  AND contype = 'c'
  AND conname = ANY($1::text[])
ORDER BY conname ASC
`,
  readOneActiveOutcomeIndex: `
SELECT i.indisunique AS "unique",
       i.indisvalid AS "valid",
       i.indisready AS "ready",
       pg_get_indexdef(i.indexrelid, 1, true) AS "keyColumn",
       pg_get_expr(i.indpred, i.indrelid, true) AS "predicate"
FROM pg_index AS i
JOIN pg_class AS index_class ON index_class.oid = i.indexrelid
WHERE i.indrelid = '"outcome_queue_item"'::regclass
  AND index_class.relname = 'outcome_queue_item_one_active_per_user_idx'
`,
  acquireLock: `SELECT pg_advisory_xact_lock(hashtext($1))`,
  readDependencyGraph: `
SELECT q."outcomeKey", q."dependencyKeys"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
ORDER BY q."outcomeKey" ASC
FOR UPDATE OF q
`,
  readSupersededDependencies: `
SELECT q."outcomeKey", q."supersededByOutcomeKey"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."outcomeKey" = ANY($2::text[])
  AND q."lifecycleState" = 'superseded'
ORDER BY q."outcomeKey" ASC
`,
  readAcquisitionReceipt: `
SELECT "id", "userId", "acquisitionKey", "outcomeKey",
       "firstFencingToken", "latestFencingToken", "createdAt", "updatedAt"
FROM "outcome_queue_acquisition_receipt"
WHERE "userId" = $1
  AND "acquisitionKey" = $2
FOR UPDATE
`,
  insertAcquisitionReceipt: `
INSERT INTO "outcome_queue_acquisition_receipt" (
  "userId", "acquisitionKey", "outcomeKey",
  "firstFencingToken", "latestFencingToken", "createdAt", "updatedAt"
) VALUES ($1, $2, $3, $4, $4, $5::timestamptz, $5::timestamptz)
ON CONFLICT ("userId", "acquisitionKey") DO NOTHING
RETURNING "id", "outcomeKey", "firstFencingToken", "latestFencingToken"
`,
  advanceAcquisitionReceipt: `
UPDATE "outcome_queue_acquisition_receipt"
SET "latestFencingToken" = GREATEST("latestFencingToken", $3),
    "updatedAt" = $4::timestamptz
WHERE "userId" = $1
  AND "acquisitionKey" = $2
  AND "outcomeKey" = $5
RETURNING "id", "outcomeKey", "firstFencingToken", "latestFencingToken"
`,
  insertAcquisitionAttempt: `
INSERT INTO "outcome_queue_acquisition_attempt" (
  "userId", "campaignWindowId", "processIdentity", "leaseHolder",
  "acquisitionKeyDigest", "leaseIdentityDigest", "checkpointDigest",
  "checkpointOutcomeId", "checkpointSequence", "checkpointState",
  "checkpointHeadSha", "checkpointMergeSha", "checkpointPrNumber",
  "outcomeKey", "fencingToken", "leaseExpiresAt", "activeWorkOrderId",
  "disposition", "reason", "attemptedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
  $14, $15, $16::timestamptz, $17, $18, $19, $20::timestamptz
)
RETURNING "id"
`,
  readAcquisitionAttemptEvidence: `
SELECT "id", "userId", "campaignWindowId", "processIdentity", "leaseHolder",
       "acquisitionKeyDigest", "leaseIdentityDigest", "checkpointDigest",
       "checkpointOutcomeId", "checkpointSequence", "checkpointState",
       "checkpointHeadSha", "checkpointMergeSha", "checkpointPrNumber",
       "outcomeKey", "fencingToken", "leaseExpiresAt", "activeWorkOrderId",
       "disposition", "reason", "attemptedAt"
FROM "outcome_queue_acquisition_attempt"
WHERE "userId" = $1
  AND "campaignWindowId" = $2
ORDER BY "attemptedAt" ASC, "id" ASC
`,
  readReceiptOutcome: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
FOR UPDATE OF q
`,
  readActiveAcquisitionProof: `
SELECT q."outcomeKey", q."goalId", q."fencingToken", q."leaseExpiresAt", q."activeWorkOrderId"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."lifecycleState" = 'active'
  AND q."leaseExpiresAt" > $2::timestamptz
ORDER BY q."outcomeKey" ASC
LIMIT 2
`,
  readMutationReceipt: `
SELECT "id", "userId", "idempotencyKey", "operation", "outcomeKey",
       "requestHash", "requestBinding", "resultBinding", "createdAt"
FROM "outcome_queue_mutation_receipt"
WHERE "userId" = $1
  AND "idempotencyKey" = $2
FOR UPDATE
`,
  nextMutationAttemptOrdinal: `
SELECT COALESCE(MAX("attemptOrdinal"), 0)::integer + 1 AS "attemptOrdinal"
FROM "outcome_queue_mutation_attempt"
WHERE "userId" = $1
  AND "idempotencyKey" = $2
`,
  insertMutationAttempt: `
INSERT INTO "outcome_queue_mutation_attempt" (
  "userId", "idempotencyKey", "requestHash", "resultDigest",
  "attemptOrdinal", "disposition", "attemptedAt"
) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
RETURNING "id"
`,
  readMutationAttemptEvidence: `
SELECT "id", "userId", "idempotencyKey", "requestHash", "resultDigest",
       "attemptOrdinal", "disposition", "attemptedAt"
FROM "outcome_queue_mutation_attempt"
WHERE "userId" = $1
  AND "idempotencyKey" = $2
ORDER BY "attemptOrdinal" ASC
`,
  readMutationItem: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
FOR UPDATE OF q
`,
  readMutationSnapshot: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
ORDER BY ${ORDER_BY}
FOR UPDATE OF q
`,
  readDependencyMutationSnapshot: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
ORDER BY ${ORDER_BY}
FOR UPDATE OF q
`,
  pauseMutation: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'blocked',
    "lifecycleReason" = COALESCE($4, 'OPERATOR_PAUSED'),
    "executionBinding" = NULL,
    "leaseHolder" = NULL,
    "leaseToken" = NULL,
    "leaseExpiresAt" = NULL,
    "acquisitionKey" = NULL,
    "fencingToken" = CASE
      WHEN q."lifecycleState" = 'active' THEN q."fencingToken" + 1
      ELSE q."fencingToken"
    END,
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('approved', 'active')
RETURNING ${QUEUE_COLUMNS}
`,
  governedApprovalMutation: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'approved',
    "lifecycleReason" = NULL,
    "approvalState" = 'approved',
    "approvedBy" = approval."owner",
    "approvedAt" = $6::timestamptz,
    "approvalDecisionId" = approval."id",
    "authorityState" = 'matched',
    "authorityGrantRef" = auth_grant."ref",
    "version" = q."version" + 1,
    "updatedAt" = $6::timestamptz
FROM "decision" AS approval, "authority_grant" AS auth_grant
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" = $7
  AND approval."id" = $4
  AND approval."userId" = q."userId"
  AND approval."status" = 'accepted'
  AND approval."authority" = 'binding'
  AND upper(trim(approval."decision")) = 'APPROVE'
  AND approval."scope" = q."outcomeKey"
  AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
  AND auth_grant."userId" = q."userId"
  AND auth_grant."ref" = $5
  AND auth_grant."status" = 'active'
  AND auth_grant."revokedAt" IS NULL
  AND (auth_grant."expiresAt" IS NULL OR auth_grant."expiresAt" > $6::timestamptz)
  AND auth_grant."authorityLevel" = q."authorityLevel"
  AND auth_grant."grantedTo" = q."authoritySubject"
  AND auth_grant."scope" = q."outcomeKey"
  AND NOT EXISTS (
    SELECT 1 FROM unnest(auth_grant."blockedActions") AS blocked(action)
    WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
  )
  AND (
    cardinality(auth_grant."allowedActions") = 0
    OR EXISTS (
      SELECT 1 FROM unnest(auth_grant."allowedActions") AS allowed(action)
      WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
    )
  )
  AND (auth_grant."workOrderId" IS NULL OR q."activeWorkOrderId" = auth_grant."workOrderId")
RETURNING ${QUEUE_COLUMNS}
`,
  declineMutation: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'declined',
    "lifecycleReason" = COALESCE($4, 'OPERATOR_DECLINED'),
    "terminalResult" = 'DECLINED',
    "terminalAt" = $5::timestamptz,
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
RETURNING ${QUEUE_COLUMNS}
`,
  supersedeMutation: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'superseded',
    "lifecycleReason" = COALESCE($4, 'OPERATOR_SUPERSEDED'),
    "terminalResult" = 'SUPERSEDED',
    "supersededByOutcomeKey" = $5,
    "terminalAt" = $6::timestamptz,
    "version" = q."version" + 1,
    "updatedAt" = $6::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
RETURNING ${QUEUE_COLUMNS}
`,
  insertSupersedingOutcome: `
INSERT INTO "outcome_queue_item" AS q (
  "userId", "outcomeKey", "goalId", "goalRef", "title", "objective", "queueOrder",
  "dependencyKeys", "riskClass", "approvalState", "authorityState",
  "authorityLevel", "authoritySubject", "authorityAction", "lifecycleState",
  "supersedesOutcomeKey", "suggestedAt", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, 'unapproved', 'unverified',
  $10, $11, $12, 'suggested', $13, $14::timestamptz,
  $14::timestamptz, $14::timestamptz
)
RETURNING ${QUEUE_COLUMNS}
`,
  rebindSupersededDependents: `
UPDATE "outcome_queue_item" AS q
SET "dependencyKeys" = ARRAY(
      SELECT CASE WHEN dependency."outcomeKey" = $2
        THEN $3
        ELSE dependency."outcomeKey"
      END
      FROM unnest(q."dependencyKeys") WITH ORDINALITY
        AS dependency("outcomeKey", position)
      ORDER BY dependency.position
    ),
    "version" = q."version" + 1,
    "updatedAt" = $4::timestamptz
WHERE q."userId" = $1
  AND $2 = ANY(q."dependencyKeys")
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
RETURNING ${QUEUE_COLUMNS}
`,
  reorderMutation: `
UPDATE "outcome_queue_item" AS q
SET "queueOrder" = $4,
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
RETURNING ${QUEUE_COLUMNS}
`,
  dependencyMutation: `
UPDATE "outcome_queue_item" AS q
SET "dependencyKeys" = $4::text[],
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
RETURNING ${QUEUE_COLUMNS}
`,
  insertMutationReceipt: `
INSERT INTO "outcome_queue_mutation_receipt" (
  "userId", "idempotencyKey", "operation", "outcomeKey",
  "requestHash", "requestBinding", "resultBinding", "createdAt"
) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)
RETURNING "id"
`,
  insertMutationAudit: `
INSERT INTO "governance_event" (
  "userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata", "createdAt"
) VALUES ($1, $2, 'outcome_queue_item', $3, 'operator', $4, $5::jsonb, $6::timestamptz)
RETURNING "id"
`,
  insertMutationEvent: `
INSERT INTO "event_log" (
  "userId", "type", "summary", "register", "refId", "metadata", "createdAt"
) VALUES ($1, $2, $3, 'outcome_queue', $4, $5::jsonb, $6::timestamptz)
RETURNING "id"
`,
  persist: `
INSERT INTO "outcome_queue_item" (
  "userId", "outcomeKey", "goalId", "goalRef", "title", "objective",
  "queueOrder", "dependencyKeys", "riskClass", "approvalState", "approvedBy",
  "approvedAt", "authorityState", "authorityLevel", "authorityGrantRef",
  "authoritySubject", "authorityAction", "lifecycleState", "lifecycleReason",
  "activeWorkOrderId", "terminalResult",
  "terminalEvidenceId", "terminalEvidenceRefs", "terminalKey", "suggestedAt",
  "terminalAt", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11,
  $12::timestamptz, $13, $14, $15, $16, $17, $18, $19, $20,
  $21, $22, $23::text[], $24, $25::timestamptz, $26::timestamptz,
  $27::timestamptz, $27::timestamptz
)
ON CONFLICT ("userId", "outcomeKey") DO UPDATE SET
  "goalId" = EXCLUDED."goalId",
  "goalRef" = EXCLUDED."goalRef",
  "title" = EXCLUDED."title",
  "objective" = EXCLUDED."objective",
  "queueOrder" = EXCLUDED."queueOrder",
  "dependencyKeys" = EXCLUDED."dependencyKeys",
  "riskClass" = EXCLUDED."riskClass",
  "authorityLevel" = EXCLUDED."authorityLevel",
  "authoritySubject" = EXCLUDED."authoritySubject",
  "authorityAction" = EXCLUDED."authorityAction",
  "lifecycleReason" = EXCLUDED."lifecycleReason",
  "version" = "outcome_queue_item"."version" + 1,
  "updatedAt" = EXCLUDED."updatedAt"
WHERE "outcome_queue_item"."lifecycleState" = 'suggested'
  AND "outcome_queue_item"."approvalState" = 'unapproved'
  AND "outcome_queue_item"."authorityState" = 'unverified'
RETURNING *
`,
  read: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
ORDER BY ${ORDER_BY}
`,
  readOne: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
`,
  readAcquisition: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."acquisitionKey" = $2
FOR UPDATE OF q
`,
  revalidateAcquisition: `
SELECT
  (${LIVE_APPROVAL_PREDICATE}) AS "approvalLive",
  (${LIVE_AUTHORITY_PREDICATE}) AS "authorityLive"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $2
  AND q."outcomeKey" = $3
`,
  reclaimAcquisition: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'active',
    "lifecycleReason" = 'STALE_LEASE_RECOVERED',
    "activeWorkOrderId" = COALESCE($8, q."activeWorkOrderId"),
    "executionBinding" = $4,
    "leaseHolder" = $5,
    "leaseToken" = $6,
    "leaseExpiresAt" = $7::timestamptz,
    "fencingToken" = q."fencingToken" + 1,
    "version" = q."version" + 1,
    "updatedAt" = $1::timestamptz
WHERE q."userId" = $2
  AND q."outcomeKey" = $3
  AND q."lifecycleState" = 'active'
  AND q."leaseExpiresAt" <= $1::timestamptz
  AND q."version" = $9
  AND ${LIVE_APPROVAL_PREDICATE}
  AND q."riskClass" IN ('R0', 'R1')
  AND ${ACQUISITION_AUTHORITY_PREDICATE}
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" AS completed_dependency
      ON completed_dependency."userId" = q."userId"
      AND completed_dependency."outcomeKey" = dependency."outcomeKey"
    WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "outcome_queue_item" AS live
    WHERE live."userId" = q."userId"
      AND live."id" <> q."id"
      AND live."lifecycleState" = 'active'
      AND live."leaseExpiresAt" > $1::timestamptz
  )
RETURNING ${QUEUE_COLUMNS}
`,
  acquire: `
WITH candidate AS (
  SELECT q."id"
  FROM "outcome_queue_item" AS q
  WHERE ${ELIGIBILITY_PREDICATE}
  ORDER BY ${ORDER_BY}
  FOR UPDATE OF q SKIP LOCKED
  LIMIT 1
)
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'active',
    "lifecycleReason" = CASE
      WHEN q."lifecycleState" = 'active' THEN 'STALE_LEASE_RECOVERED'
      ELSE NULL
    END,
    "activeWorkOrderId" = COALESCE($8, q."activeWorkOrderId"),
    "executionBinding" = $4,
    "acquisitionKey" = $3,
    "leaseHolder" = $5,
    "leaseToken" = $6,
    "leaseExpiresAt" = $7::timestamptz,
    "fencingToken" = q."fencingToken" + 1,
    "version" = q."version" + 1,
    "activatedAt" = COALESCE(q."activatedAt", $1::timestamptz),
    "updatedAt" = $1::timestamptz
FROM candidate
WHERE q."id" = candidate."id"
RETURNING ${QUEUE_COLUMNS}
`,
  noSelectionReason: `
SELECT
  count(*)::integer AS "totalCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active')
  )::integer
    AS "candidateStateCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active')
      AND ${LIVE_APPROVAL_PREDICATE}
  )::integer AS "approvalEligibleCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active')
      AND ${LIVE_APPROVAL_PREDICATE}
      AND ${LIVE_AUTHORITY_PREDICATE}
  )::integer AS "authorityEligibleCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active')
      AND ${LIVE_APPROVAL_PREDICATE}
      AND ${LIVE_AUTHORITY_PREDICATE}
      AND q."riskClass" IN ('R0', 'R1')
  )::integer AS "riskEligibleCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active')
      AND ${LIVE_APPROVAL_PREDICATE}
      AND ${LIVE_AUTHORITY_PREDICATE}
      AND q."riskClass" IN ('R0', 'R1')
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
        LEFT JOIN "outcome_queue_item" AS completed_dependency
          ON completed_dependency."userId" = q."userId"
          AND completed_dependency."outcomeKey" = dependency."outcomeKey"
        WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
      )
  )::integer AS "dependencyEligibleCount",
  count(*) FILTER (
    WHERE q."lifecycleState" = 'active'
      AND q."leaseExpiresAt" > $1::timestamptz
  )::integer AS "activeLeaseCount",
  count(*) FILTER (
    WHERE q."lifecycleState" = 'blocked'
  )::integer AS "blockedCount",
  count(*) FILTER (
    WHERE q."lifecycleState" IN ('completed', 'declined', 'superseded')
  )::integer AS "terminalCount"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $2
`,
  transition: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = $4,
    "lifecycleReason" = $10,
    "leaseHolder" = CASE WHEN $3 = 'active' OR $4 IN ('declined', 'superseded')
      THEN NULL ELSE q."leaseHolder" END,
    "leaseToken" = CASE WHEN $3 = 'active' OR $4 IN ('declined', 'superseded')
      THEN NULL ELSE q."leaseToken" END,
    "leaseExpiresAt" = CASE WHEN $3 = 'active' OR $4 IN ('declined', 'superseded')
      THEN NULL ELSE q."leaseExpiresAt" END,
    "terminalAt" = CASE WHEN $4 IN ('declined', 'superseded')
      THEN $9::timestamptz ELSE q."terminalAt" END,
    "version" = q."version" + 1,
    "updatedAt" = $9::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = $3
  AND q."version" = $5
  AND ($3 <> 'active' OR (
    q."executionBinding" = $6
    AND q."leaseToken" = $7
    AND q."fencingToken" = $8
    AND q."leaseExpiresAt" > $9::timestamptz
  ))
RETURNING ${QUEUE_COLUMNS}
`,
  renewLease: `
UPDATE "outcome_queue_item" AS q
SET "leaseExpiresAt" = $8::timestamptz,
    "updatedAt" = $7::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."leaseToken" = $5
  AND q."fencingToken" = $6
  AND q."leaseExpiresAt" > $7::timestamptz
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE.replaceAll("$1::timestamptz", "$7::timestamptz")}
RETURNING ${QUEUE_COLUMNS}
`,
  deferLease: `
UPDATE "outcome_queue_item" AS q
SET "leaseExpiresAt" = $7::timestamptz,
    "lifecycleReason" = $8,
    "updatedAt" = $9::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."leaseToken" = $5
  AND q."fencingToken" = $6
  AND q."leaseExpiresAt" > $9::timestamptz
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE.replaceAll("$1::timestamptz", "$9::timestamptz")}
RETURNING ${QUEUE_COLUMNS}
`,
  bindWorkOrder: `
UPDATE "outcome_queue_item" AS q
SET "activeWorkOrderId" = $7,
    "updatedAt" = $8::timestamptz
FROM work_order AS projected_work
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."leaseToken" = $5
  AND q."fencingToken" = $6
  AND q."leaseExpiresAt" > $8::timestamptz
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE
    .replaceAll("$1::timestamptz", "$8::timestamptz")
    .replaceAll(
      `q."activeWorkOrderId" = live_grant."workOrderId"`,
      `$7 = live_grant."workOrderId"`,
    )}
  AND projected_work.id = $7
  AND projected_work."userId" = q."userId"
  AND projected_work.ref = 'WO-HERMES-OUTCOME-' || q."goalId"::text
  AND projected_work.goal = q."goalRef"
  AND projected_work.status = 'active'
  AND (q."activeWorkOrderId" IS NULL OR q."activeWorkOrderId" = $7)
RETURNING ${QUEUE_COLUMNS}
`,
  resumeAfterDecision: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'active',
    "lifecycleReason" = 'OWNER_DECISION_RESUMED',
    "leaseHolder" = $8,
    "leaseToken" = $9,
    "leaseExpiresAt" = $10::timestamptz,
    "fencingToken" = q."fencingToken" + 1,
    "version" = q."version" + 1,
    "updatedAt" = $11::timestamptz
FROM decision AS approval
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'blocked'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."acquisitionKey" = $5
  AND q."fencingToken" = $6
  AND approval.id = $7
  AND approval."userId" = q."userId"
  AND approval.status = 'accepted'
  AND approval.authority = 'binding'
  AND approval."scope" = q."outcomeKey"
  AND upper(trim(approval.decision)) = 'APPROVE'
  AND (approval.context::jsonb)->>'outcomeId' = q."goalId"::text
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE.replaceAll("$1::timestamptz", "$11::timestamptz")}
  AND q."riskClass" IN ('R0', 'R1')
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" AS completed_dependency
      ON completed_dependency."userId" = q."userId"
      AND completed_dependency."outcomeKey" = dependency."outcomeKey"
    WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "outcome_queue_item" AS live
    WHERE live."userId" = q."userId"
      AND live."id" <> q."id"
      AND live."lifecycleState" = 'active'
      AND live."leaseExpiresAt" > $11::timestamptz
  )
RETURNING ${QUEUE_COLUMNS}
`,
  verifyBoundWorkOrder: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
JOIN work_order AS projected_work
  ON projected_work.id = q."activeWorkOrderId"
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."leaseToken" = $5
  AND q."fencingToken" = $6
  AND q."activeWorkOrderId" = $7
  AND q."leaseExpiresAt" > $9::timestamptz
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${ACQUISITION_AUTHORITY_PREDICATE
    .replaceAll("$8", "$7")
    .replaceAll("$1::timestamptz", "$9::timestamptz")}
  AND projected_work."userId" = q."userId"
  AND projected_work.ref = 'WO-HERMES-OUTCOME-' || q."goalId"::text
  AND projected_work.goal = q."goalRef"
  AND projected_work.status = $8
`,
  replayResumeAfterDecision: `
SELECT ${QUEUE_COLUMNS}
FROM "outcome_queue_item" AS q
JOIN decision AS approval
  ON approval.id = $7
  AND approval."userId" = q."userId"
  AND approval.status = 'accepted'
  AND approval.authority = 'binding'
  AND approval."scope" = q."outcomeKey"
  AND upper(trim(approval.decision)) = 'APPROVE'
  AND (approval.context::jsonb)->>'outcomeId' = q."goalId"::text
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."lifecycleReason" = 'OWNER_DECISION_RESUMED'
  AND q."version" = $3::integer + 1
  AND q."executionBinding" = $4
  AND q."acquisitionKey" = $5
  AND q."fencingToken" = $6::integer + 1
  AND q."leaseHolder" = $8
  AND q."leaseToken" = $9
  AND q."leaseExpiresAt" > $11::timestamptz
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE.replaceAll("$1::timestamptz", "$11::timestamptz")}
`,
  approve: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'approved',
    "lifecycleReason" = NULL,
    "approvalState" = 'approved',
    "approvedBy" = approval."owner",
    "approvedAt" = $5::timestamptz,
    "approvalDecisionId" = approval."id",
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
FROM "decision" AS approval
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'blocked')
  AND approval."id" = $4
  AND approval."userId" = q."userId"
  AND approval."status" = 'accepted'
  AND approval."authority" = 'binding'
  AND upper(trim(approval."decision")) = 'APPROVE'
  AND approval."scope" = q."outcomeKey"
  AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
RETURNING ${QUEUE_COLUMNS}
`,
  matchAuthority: `
UPDATE "outcome_queue_item" AS q
SET "authorityState" = 'matched',
    "authorityGrantRef" = auth_grant."ref",
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
FROM "authority_grant" AS auth_grant
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
  AND auth_grant."userId" = q."userId"
  AND auth_grant."ref" = $4
  AND auth_grant."status" = 'active'
  AND auth_grant."revokedAt" IS NULL
  AND (auth_grant."expiresAt" IS NULL OR auth_grant."expiresAt" > $5::timestamptz)
  AND auth_grant."authorityLevel" = q."authorityLevel"
  AND auth_grant."grantedTo" = q."authoritySubject"
  AND auth_grant."scope" = q."outcomeKey"
  AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(auth_grant."blockedActions") AS blocked(action)
    WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
  )
  AND (
    cardinality(auth_grant."allowedActions") = 0
    OR EXISTS (
      SELECT 1
      FROM unnest(auth_grant."allowedActions") AS allowed(action)
      WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
    )
  )
  AND (
    auth_grant."workOrderId" IS NULL
    OR q."activeWorkOrderId" = auth_grant."workOrderId"
  )
RETURNING ${QUEUE_COLUMNS}
`,
  complete: `
UPDATE "outcome_queue_item" AS q
SET "lifecycleState" = 'completed',
    "lifecycleReason" = NULL,
    "leaseHolder" = NULL,
    "leaseToken" = NULL,
    "leaseExpiresAt" = NULL,
    "terminalResult" = $9,
    "terminalEvidenceId" = $10,
    "terminalEvidenceRefs" = $11::text[],
    "terminalKey" = $8,
    "terminalAt" = $12::timestamptz,
    "version" = q."version" + 1,
    "updatedAt" = $12::timestamptz
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."lifecycleState" = 'active'
  AND q."version" = $3
  AND q."executionBinding" = $4
  AND q."leaseToken" = $5
  AND q."fencingToken" = $6
  AND q."leaseExpiresAt" > $12::timestamptz
  AND q."acquisitionKey" = $7
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE.replaceAll("$1::timestamptz", "$12::timestamptz")}
RETURNING ${QUEUE_COLUMNS}
`,
  legacyHistory: `
SELECT
  g."id" AS "legacyGoalId",
  g."userId",
  g."ref",
  g."command",
  g."status",
  g."linkedWorkOrderId",
  linked_work."status" AS "workOrderStatus",
  linked_work."result" AS "workOrderResult",
  linked_work."completedAt" AS "workOrderCompletedAt",
  g."createdAt",
  g."updatedAt"
FROM "goal" AS g
LEFT JOIN "work_order" AS linked_work
  ON linked_work."id" = g."linkedWorkOrderId"
  AND linked_work."userId" = g."userId"
WHERE g."userId" = $1
  AND g."ref" = ANY($2::text[])
ORDER BY g."ref" ASC, g."id" ASC
`,
})

export const OUTCOME_QUEUE_STATES = Object.freeze([...QUEUE_STATES])
export const OUTCOME_QUEUE_LEGAL_TRANSITIONS = LEGAL_OUTCOME_TRANSITIONS
export const OUTCOME_QUEUE_LEGACY_GOAL_REFS = LEGACY_GOAL_REFS
export const OUTCOME_QUEUE_NO_SELECTION_REASONS = NO_SELECTION_REASONS
export const OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS = Object.freeze({
  COMMITTED: "COMMITTED",
  REPLAY: "REPLAY",
})

export function canonicalOutcomeQueueCheckpointProof(input) {
  const outcomeId = nonempty(String(input?.outcomeId ?? ""), "OUTCOME_QUEUE_CHECKPOINT_OUTCOME_INVALID")
  const outcomeKey = nonempty(input?.outcomeKey, "OUTCOME_QUEUE_CHECKPOINT_OUTCOME_INVALID")
  const fencingToken = integer(
    input?.fencingToken,
    "OUTCOME_QUEUE_CHECKPOINT_FENCE_INVALID",
    { minimum: 1 },
  )
  const sequence = integer(
    input?.sequence,
    "OUTCOME_QUEUE_CHECKPOINT_SEQUENCE_INVALID",
    { minimum: 0 },
  )
  const state = nonempty(input?.state, "OUTCOME_QUEUE_CHECKPOINT_STATE_INVALID")
  const workOrderId = integer(
    input?.workOrderId,
    "OUTCOME_QUEUE_CHECKPOINT_WORK_ORDER_INVALID",
    { nullable: true, minimum: 1 },
  )
  const commit = input?.commit ?? {}
  const headSha = optionalString(commit.headSha, "OUTCOME_QUEUE_CHECKPOINT_COMMIT_INVALID")
  const mergeSha = optionalString(commit.mergeSha, "OUTCOME_QUEUE_CHECKPOINT_COMMIT_INVALID")
  const prNumber = integer(
    commit.prNumber,
    "OUTCOME_QUEUE_CHECKPOINT_COMMIT_INVALID",
    { nullable: true, minimum: 1 },
  )
  if ((headSha !== null && !/^[0-9a-f]{40}$/i.test(headSha))
    || (mergeSha !== null && !/^[0-9a-f]{40}$/i.test(mergeSha))) {
    fail("OUTCOME_QUEUE_CHECKPOINT_COMMIT_INVALID")
  }
  return canonicalValue({
    commit: { headSha, mergeSha, prNumber },
    fencingToken,
    outcomeId,
    outcomeKey,
    sequence,
    state,
    workOrderId,
  })
}

export function digestOutcomeQueueCheckpointProof(input) {
  return requestHash(canonicalOutcomeQueueCheckpointProof(input))
}

const poolByConnectionString = new Map()

function poolFor(databaseUrl) {
  let poolPromise = poolByConnectionString.get(databaseUrl)
  if (!poolPromise) {
    poolPromise = import("pg")
      .then(({ Pool }) => {
        const pool = new Pool({ connectionString: databaseUrl })
        pool.on("error", () => {
          if (poolByConnectionString.get(databaseUrl) === poolPromise) {
            poolByConnectionString.delete(databaseUrl)
          }
          void pool.end().catch(() => {})
        })
        return pool
      })
      .catch((error) => {
        poolByConnectionString.delete(databaseUrl)
        throw error
      })
    poolByConnectionString.set(databaseUrl, poolPromise)
  }
  return poolPromise
}

function fail(code, message = code) {
  throw Object.assign(new Error(message), { code })
}

function normalizeQuery(query) {
  if (typeof query === "function") return { query, close: async () => {} }
  if (query && typeof query.query === "function") {
    return { query: query.query.bind(query), close: async () => {} }
  }
  return null
}

async function openQuery(query, databaseUrl, transactional = false) {
  if (query && typeof query.connect === "function") {
    const client = await query.connect()
    return { query: client.query.bind(client), close: async () => client.release?.() }
  }
  const injected = normalizeQuery(query)
  if (injected) {
    if (transactional) fail("OUTCOME_QUEUE_DEDICATED_CLIENT_REQUIRED")
    return injected
  }
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    fail("DATABASE_URL_REQUIRED", "DATABASE_URL is required")
  }
  const pool = await poolFor(databaseUrl)
  if (!transactional) return { query: pool.query.bind(pool), close: async () => {} }
  const client = await pool.connect()
  return {
    query: client.query.bind(client),
    close: async () => client.release(),
  }
}

export async function closeOutcomeQueuePools() {
  const poolPromises = [...poolByConnectionString.values()]
  poolByConnectionString.clear()
  const pools = await Promise.allSettled(poolPromises)
  await Promise.allSettled(pools.flatMap((result) => (
    result.status === "fulfilled" ? [result.value.end()] : []
  )))
}

function timestamp(value, code = "OUTCOME_QUEUE_TIME_INVALID") {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""))
  if (!Number.isFinite(milliseconds)) fail(code)
  return new Date(milliseconds).toISOString()
}

function integer(value, code, { nullable = false, minimum = 0 } = {}) {
  if (nullable && value == null) return null
  if (!Number.isSafeInteger(value) || value < minimum) fail(code)
  return value
}

function nonempty(value, code) {
  if (typeof value !== "string" || value.trim() === "") fail(code)
  return value.trim()
}

function optionalString(value, code) {
  if (value == null) return null
  return nonempty(value, code)
}

function enumValue(value, allowed, code) {
  if (typeof value !== "string" || !allowed.has(value)) fail(code)
  return value
}

function stringArray(value, code) {
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    fail(code)
  }
  return [...new Set(value.map((entry) => entry.trim()))].sort()
}

const OUTCOME_QUEUE_HARDENING_CONSTRAINT_NAMES = Object.freeze([
  "outcome_queue_item_active_binding_check",
  "outcome_queue_item_approval_state_check",
  "outcome_queue_item_authority_state_check",
  "outcome_queue_item_lifecycle_state_check",
  "outcome_queue_item_nonnegative_fence_check",
])

const RECEIPT_COLUMN_CONTRACTS = Object.freeze({
  goal_outcome_intake_receipt: Object.freeze([
    ["id", "integer", true, "sequence"],
    ["userId", "text", true, null],
    ["idempotencyKey", "text", true, null],
    ["requestHash", "text", true, null],
    ["goalId", "integer", true, null],
    ["outcomeKey", "text", true, null],
    ["resultDigest", "text", true, null],
    ["replayCount", "integer", true, "0"],
    ["firstSubmittedAt", "timestamp with time zone", true, "now()"],
    ["lastReplayedAt", "timestamp with time zone", false, null],
  ]),
  outcome_queue_acquisition_attempt: Object.freeze([
    ["id", "integer", true, "sequence"],
    ["userId", "text", true, null],
    ["campaignWindowId", "text", true, null],
    ["processIdentity", "text", true, null],
    ["leaseHolder", "text", true, null],
    ["acquisitionKeyDigest", "text", true, null],
    ["leaseIdentityDigest", "text", true, null],
    ["checkpointDigest", "text", true, null],
    ["checkpointOutcomeId", "text", true, null],
    ["checkpointSequence", "integer", true, null],
    ["checkpointState", "text", true, null],
    ["checkpointHeadSha", "text", false, null],
    ["checkpointMergeSha", "text", false, null],
    ["checkpointPrNumber", "integer", false, null],
    ["outcomeKey", "text", false, null],
    ["fencingToken", "integer", false, null],
    ["leaseExpiresAt", "timestamp with time zone", false, null],
    ["activeWorkOrderId", "integer", false, null],
    ["disposition", "text", true, null],
    ["reason", "text", false, null],
    ["attemptedAt", "timestamp with time zone", true, "now()"],
  ]),
  outcome_queue_acquisition_receipt: Object.freeze([
    ["id", "integer", true, "sequence"],
    ["userId", "text", true, null],
    ["acquisitionKey", "text", true, null],
    ["outcomeKey", "text", true, null],
    ["firstFencingToken", "integer", true, null],
    ["latestFencingToken", "integer", true, null],
    ["createdAt", "timestamp with time zone", true, "now()"],
    ["updatedAt", "timestamp with time zone", true, "now()"],
  ]),
  outcome_queue_mutation_receipt: Object.freeze([
    ["id", "integer", true, "sequence"],
    ["userId", "text", true, null],
    ["idempotencyKey", "text", true, null],
    ["operation", "text", true, null],
    ["outcomeKey", "text", false, null],
    ["requestHash", "text", true, null],
    ["requestBinding", "jsonb", true, null],
    ["resultBinding", "jsonb", true, null],
    ["createdAt", "timestamp with time zone", true, "now()"],
  ]),
  outcome_queue_mutation_attempt: Object.freeze([
    ["id", "integer", true, "sequence"],
    ["userId", "text", true, null],
    ["idempotencyKey", "text", true, null],
    ["requestHash", "text", true, null],
    ["resultDigest", "text", true, null],
    ["attemptOrdinal", "integer", true, null],
    ["disposition", "text", true, null],
    ["attemptedAt", "timestamp with time zone", true, "now()"],
  ]),
})

const RECEIPT_CONSTRAINT_CONTRACTS = Object.freeze({
  goal_outcome_intake_receipt: Object.freeze({
    goal_outcome_intake_receipt_pkey:
      ["p", "primarykeyid"],
    goal_outcome_intake_receipt_goalId_fkey:
      ["f", "foreignkeygoalidreferencesgoalidondeleterestrict"],
    goal_outcome_intake_receipt_user_key_unique:
      ["u", "uniqueuserid,idempotencykey"],
    goal_outcome_intake_receipt_user_goal_unique:
      ["u", "uniqueuserid,goalid"],
    goal_outcome_intake_receipt_user_outcome_unique:
      ["u", "uniqueuserid,outcomekey"],
    goal_outcome_intake_receipt_replay_count_check:
      ["c", "checkreplaycount>=0"],
  }),
  outcome_queue_acquisition_attempt: Object.freeze({
    outcome_queue_acquisition_attempt_pkey:
      ["p", "primarykeyid"],
    outcome_queue_acquisition_attempt_fence_check:
      ["c", "checkfencingtokenisnullorfencingtoken>0"],
    outcome_queue_acquisition_attempt_checkpoint_check:
      ["c", "checkcheckpointsequence>=0andcheckpointprnumberisnullorcheckpointprnumber>0"],
  }),
  outcome_queue_acquisition_receipt: Object.freeze({
    outcome_queue_acquisition_receipt_pkey:
      ["p", "primarykeyid"],
    outcome_queue_acquisition_receipt_user_key_unique:
      ["u", "uniqueuserid,acquisitionkey"],
    outcome_queue_acquisition_receipt_fence_check:
      ["c", "checkfirstfencingtoken>0andlatestfencingtoken>=firstfencingtoken"],
  }),
  outcome_queue_mutation_receipt: Object.freeze({
    outcome_queue_mutation_receipt_pkey:
      ["p", "primarykeyid"],
    outcome_queue_mutation_receipt_user_key_unique:
      ["u", "uniqueuserid,idempotencykey"],
  }),
  outcome_queue_mutation_attempt: Object.freeze({
    outcome_queue_mutation_attempt_pkey:
      ["p", "primarykeyid"],
    outcome_queue_mutation_attempt_user_ordinal_unique:
      ["u", "uniqueuserid,idempotencykey,attemptordinal"],
    outcome_queue_mutation_attempt_ordinal_check:
      ["c", "checkattemptordinal>0"],
    outcome_queue_mutation_attempt_disposition_check:
      ["c", "checkdisposition=anyarray['committed','replay']"],
  }),
})

const LEGACY_RECEIPT_CONSTRAINT_CONTRACTS = Object.freeze({
  ...RECEIPT_CONSTRAINT_CONTRACTS,
  outcome_queue_acquisition_receipt: Object.freeze({
    outcome_queue_acquisition_receipt_pkey:
      ["p", "primarykeyid"],
    outcome_queue_acquisition_receipt_user_key_unique:
      ["u", "uniqueuserid,acquisitionkey"],
    outcome_queue_acquisition_receipt_firstFencingToken_check:
      ["c", "checkfirstfencingtoken>0"],
    outcome_queue_acquisition_receipt_latestFencingToken_check:
      ["c", "checklatestfencingtoken>=firstfencingtoken"],
  }),
  outcome_queue_mutation_receipt: Object.freeze({
    outcome_queue_mutation_receipt_pkey:
      ["p", "primarykeyid"],
  }),
})

const RECEIPT_INDEX_CONTRACTS = Object.freeze({
  outcome_queue_acquisition_attempt_campaign_idx:
    ["outcome_queue_acquisition_attempt", ["userId", "campaignWindowId", "attemptedAt"]],
  outcome_queue_acquisition_attempt_identity_idx:
    ["outcome_queue_acquisition_attempt", ["userId", "acquisitionKeyDigest", "attemptedAt"]],
  outcome_queue_acquisition_receipt_user_outcome_idx:
    ["outcome_queue_acquisition_receipt", ["userId", "outcomeKey"]],
  outcome_queue_mutation_receipt_user_outcome_idx:
    ["outcome_queue_mutation_receipt", ["userId", "outcomeKey", "createdAt"]],
  outcome_queue_mutation_attempt_request_idx:
    ["outcome_queue_mutation_attempt", ["userId", "requestHash", "attemptedAt"]],
})

function hardeningConstraintMatches(row) {
  return row?.validated === true
    && OUTCOME_QUEUE_HARDENING_CONSTRAINT_NAMES.includes(row.constraintName)
}

function canonicalCatalogExpression(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("::text", "")
    .replace(/[()"`\s]/g, "")
}

function receiptDefaultMatches(observed, expected) {
  const canonical = String(observed ?? "").toLowerCase().replace(/\s/g, "")
  if (expected === null) return observed == null
  if (expected === "sequence") {
    return /^nextval\('.+_id_seq'::regclass\)$/.test(canonical)
  }
  return canonical === expected
}

function receiptColumnsMatch(rows) {
  const observedTables = new Set(rows.map((row) => row?.tableName))
  if (observedTables.size !== Object.keys(RECEIPT_COLUMN_CONTRACTS).length) return false
  return Object.entries(RECEIPT_COLUMN_CONTRACTS).every(([tableName, columns]) => {
    const observed = rows.filter((row) => row?.tableName === tableName)
    return observed.length === columns.length
      && columns.every(([columnName, dataType, notNull, defaultExpression], index) => {
        const row = observed[index]
        return row?.columnName === columnName
          && row?.dataType === dataType
          && row?.notNull === notNull
          && receiptDefaultMatches(row?.defaultExpression, defaultExpression)
      })
  })
}

function receiptConstraintsMatchContract(rows, contracts) {
  const expectedCount = Object.values(contracts)
    .reduce((count, contracts) => count + Object.keys(contracts).length, 0)
  if (rows.length !== expectedCount) return false
  return Object.entries(contracts).every(([tableName, tableContracts]) => {
    const observed = rows.filter((row) => row?.tableName === tableName)
    return observed.length === Object.keys(tableContracts).length
      && Object.entries(tableContracts).every(([constraintName, [constraintType, definition]]) => {
        const row = observed.find((candidate) => candidate?.constraintName === constraintName)
        return row?.constraintType === constraintType
          && row?.validated === true
          && canonicalCatalogExpression(row?.definition) === definition
      })
  })
}

function receiptConstraintsMatch(rows) {
  return receiptConstraintsMatchContract(rows, RECEIPT_CONSTRAINT_CONTRACTS)
}

function legacyReceiptConstraintsMatch(rows) {
  return receiptConstraintsMatchContract(
    rows,
    LEGACY_RECEIPT_CONSTRAINT_CONTRACTS,
  )
}

function legacyMutationReceiptUniqueIndexMatches(rows) {
  if (rows.length !== 1) return false
  const row = rows[0]
  return row?.tableName === "outcome_queue_mutation_receipt"
    && row?.indexName === "outcome_queue_mutation_receipt_user_key_idx"
    && row?.unique === true
    && row?.valid === true
    && row?.ready === true
    && row?.primary === false
    && row?.exclusion === false
    && row?.immediate === true
    && row?.noIncludedColumns === true
    && row?.noExpressions === true
    && row?.accessMethod === "btree"
    && row?.constraintBacked === false
    && row?.predicate == null
    && Array.isArray(row?.keyColumns)
    && row.keyColumns.length === 2
    && canonicalCatalogExpression(row.keyColumns[0]) === "userid"
    && canonicalCatalogExpression(row.keyColumns[1]) === "idempotencykey"
}

function receiptIndexesMatch(rows) {
  if (rows.length !== Object.keys(RECEIPT_INDEX_CONTRACTS).length) return false
  return Object.entries(RECEIPT_INDEX_CONTRACTS).every((
    [indexName, [tableName, keyColumns]],
  ) => {
    const row = rows.find((candidate) => candidate?.indexName === indexName)
    return row?.tableName === tableName
      && row?.unique === false
      && row?.valid === true
      && row?.ready === true
      && row?.predicate == null
      && Array.isArray(row?.keyColumns)
      && row.keyColumns.length === keyColumns.length
      && row.keyColumns.every((column, index) => (
        canonicalCatalogExpression(column)
          === canonicalCatalogExpression(keyColumns[index])
      ))
  })
}

function oneActiveIndexMatches(row) {
  return row?.unique === true
    && row?.valid === true
    && row?.ready === true
    && canonicalCatalogExpression(row.keyColumn) === "userid"
    && canonicalCatalogExpression(row.predicate) === "lifecyclestate='active'"
}

function hardeningWall(code, details = null, cause = null) {
  throw Object.assign(new Error(code), {
    code,
    details,
    ...(cause ? { cause } : {}),
  })
}

export async function ensureOutcomeQueueHardeningSchema({
  query,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  let phase = "open"
  try {
    await connection.query("BEGIN")
    begun = true
    phase = "lock"
    await connection.query(
      OUTCOME_QUEUE_SQL.acquireLock,
      ["williamos:outcome-queue:hardening-schema"],
    )
    phase = "receipt-table"
    await connection.query(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable)
    await connection.query(OUTCOME_QUEUE_SQL.ensureMutationReceiptTable)
    await connection.query(OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable)
    await connection.query(OUTCOME_QUEUE_SQL.ensureGoalOutcomeIntakeReceiptTable)
    await connection.query(OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable)
    await connection.query(OUTCOME_QUEUE_SQL.ensureMutationAttemptTable)
    phase = "receipt-columns"
    const receiptColumns = await connection.query(OUTCOME_QUEUE_SQL.readReceiptColumns)
    if (!receiptColumnsMatch(receiptColumns?.rows ?? [])) {
      hardeningWall("OUTCOME_QUEUE_HARDENING_RECEIPT_COLUMN_WALL", {
        observed: receiptColumns?.rows ?? [],
      })
    }
    phase = "receipt-constraints"
    let receiptConstraints = await connection.query(
      OUTCOME_QUEUE_SQL.readReceiptConstraints,
    )
    if (!receiptConstraintsMatch(receiptConstraints?.rows ?? [])) {
      const observedConstraints = receiptConstraints?.rows ?? []
      if (!legacyReceiptConstraintsMatch(observedConstraints)) {
        hardeningWall("OUTCOME_QUEUE_HARDENING_RECEIPT_CONSTRAINT_WALL", {
          observed: observedConstraints,
        })
      }
      phase = "receipt-legacy-index"
      const legacyIndex = await connection.query(
        OUTCOME_QUEUE_SQL.readLegacyMutationReceiptUniqueIndex,
      )
      if (!legacyMutationReceiptUniqueIndexMatches(legacyIndex?.rows ?? [])) {
        hardeningWall("OUTCOME_QUEUE_HARDENING_RECEIPT_MIGRATION_WALL", {
          observed: legacyIndex?.rows ?? [],
        })
      }
      phase = "receipt-migration"
      await connection.query(
        OUTCOME_QUEUE_SQL.migrateLegacyMutationReceiptUniqueIndex,
      )
      await connection.query(
        OUTCOME_QUEUE_SQL.migrateLegacyAcquisitionReceiptFenceChecks,
      )
      await connection.query(
        OUTCOME_QUEUE_SQL.validateAcquisitionReceiptFenceConstraint,
      )
      phase = "receipt-constraints"
      receiptConstraints = await connection.query(
        OUTCOME_QUEUE_SQL.readReceiptConstraints,
      )
      if (!receiptConstraintsMatch(receiptConstraints?.rows ?? [])) {
        hardeningWall("OUTCOME_QUEUE_HARDENING_RECEIPT_CONSTRAINT_WALL", {
          observed: receiptConstraints?.rows ?? [],
          migratedFrom: "known-parent-receipt-schema",
        })
      }
    }
    phase = "receipt-indexes"
    await connection.query(OUTCOME_QUEUE_SQL.ensureMutationReceiptOutcomeIndex)
    await connection.query(OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptOutcomeIndex)
    await connection.query(OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptIndexes)
    await connection.query(OUTCOME_QUEUE_SQL.ensureMutationAttemptRequestIndex)
    const receiptIndexes = await connection.query(OUTCOME_QUEUE_SQL.readReceiptIndexes)
    if (!receiptIndexesMatch(receiptIndexes?.rows ?? [])) {
      hardeningWall("OUTCOME_QUEUE_HARDENING_RECEIPT_INDEX_WALL", {
        observed: receiptIndexes?.rows ?? [],
      })
    }
    phase = "preflight"
    const inspection = await connection.query(
      OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations,
    )
    const violations = inspection?.rows?.[0]
    const violationCounts = Object.fromEntries([
      "lifecycleViolationCount",
      "approvalViolationCount",
      "authorityViolationCount",
      "nonnegativeViolationCount",
      "activeBindingViolationCount",
      "multipleActiveUserCount",
    ].map((name) => [name, Number(violations?.[name] ?? Number.NaN)]))
    if (Object.values(violationCounts).some((count) => (
      !Number.isSafeInteger(count) || count < 0
    ))) {
      hardeningWall("OUTCOME_QUEUE_HARDENING_PREFLIGHT_WALL")
    }
    if (Object.values(violationCounts).some((count) => count > 0)) {
      hardeningWall(
        "OUTCOME_QUEUE_HARDENING_EXISTING_ROWS_INVALID",
        violationCounts,
      )
    }
    phase = "constraints"
    await connection.query(OUTCOME_QUEUE_SQL.ensureOneActiveOutcomeIndex)
    await connection.query(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints)
    for (const sql of [
      OUTCOME_QUEUE_SQL.validateOutcomeQueueLifecycleConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueApprovalConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueAuthorityConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueNonnegativeFenceConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueActiveBindingConstraint,
    ]) {
      await connection.query(sql)
    }
    phase = "verify"
    const verified = await connection.query(
      OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints,
      [OUTCOME_QUEUE_HARDENING_CONSTRAINT_NAMES],
    )
    const verifiedRows = verified?.rows ?? []
    const verifiedNames = new Set(verifiedRows
      .filter(hardeningConstraintMatches)
      .map((row) => row.constraintName))
    if (OUTCOME_QUEUE_HARDENING_CONSTRAINT_NAMES.some((name) => (
      !verifiedNames.has(name)
    ))) {
      hardeningWall("OUTCOME_QUEUE_HARDENING_CONSTRAINT_WALL", {
        expected: OUTCOME_QUEUE_HARDENING_CONSTRAINT_NAMES,
        verified: [...verifiedNames].sort(),
        observed: verifiedRows.map((row) => ({
          constraintName: row.constraintName,
          validated: row.validated,
        })),
      })
    }
    const indexVerification = await connection.query(
      OUTCOME_QUEUE_SQL.readOneActiveOutcomeIndex,
    )
    if (indexVerification?.rows?.length !== 1
      || !oneActiveIndexMatches(indexVerification.rows[0])) {
      hardeningWall("OUTCOME_QUEUE_HARDENING_INDEX_WALL")
    }
    phase = "commit"
    await connection.query("COMMIT")
    begun = false
    return true
  } catch (error) {
    if (begun) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the schema bootstrap error.
      }
    }
    if (String(error?.code ?? "").startsWith("OUTCOME_QUEUE_HARDENING_")) {
      throw error
    }
    hardeningWall("OUTCOME_QUEUE_HARDENING_SCHEMA_WALL", { phase }, error)
  } finally {
    await connection.close()
  }
}

function findDependencyCycle(rows) {
  const graph = new Map(rows.map((row) => [
    row.outcomeKey,
    [...new Set(row.dependencyKeys ?? [])].sort(),
  ]))
  const visited = new Set()
  const visiting = new Set()
  const path = []

  function visit(key) {
    if (visiting.has(key)) {
      const start = path.indexOf(key)
      return [...path.slice(start), key]
    }
    if (visited.has(key) || !graph.has(key)) return null
    visiting.add(key)
    path.push(key)
    for (const dependencyKey of graph.get(key)) {
      const cycle = visit(dependencyKey)
      if (cycle) return cycle
    }
    path.pop()
    visiting.delete(key)
    visited.add(key)
    return null
  }

  for (const key of [...graph.keys()].sort()) {
    const cycle = visit(key)
    if (cycle) return cycle
  }
  return null
}

function userScope(userId) {
  return nonempty(userId, "OUTCOME_QUEUE_USER_ID_INVALID")
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function requestHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function jsonValue(value, code) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      fail(code)
    }
  }
  if (!value || typeof value !== "object") fail(code)
  return value
}

function normalizeItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) fail("OUTCOME_QUEUE_ITEM_INVALID")
  const outcomeKey = nonempty(item.outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const dependencyKeys = stringArray(item.dependencyKeys ?? [], "OUTCOME_QUEUE_DEPENDENCIES_INVALID")
  if (dependencyKeys.includes(outcomeKey)) fail("OUTCOME_QUEUE_DEPENDENCIES_INVALID")
  const lifecycleState = enumValue(item.lifecycleState, QUEUE_STATES, "OUTCOME_QUEUE_STATE_INVALID")
  const approvalState = enumValue(
    item.approvalState,
    APPROVAL_STATES,
    "OUTCOME_QUEUE_APPROVAL_INVALID",
  )
  const authorityState = enumValue(
    item.authorityState,
    AUTHORITY_STATES,
    "OUTCOME_QUEUE_AUTHORITY_INVALID",
  )
  if (lifecycleState !== "suggested"
    || approvalState !== "unapproved"
    || authorityState !== "unverified"
    || item.approvedBy != null
    || item.approvedAt != null
    || item.authorityGrantRef != null) {
    fail("OUTCOME_QUEUE_INTAKE_MUST_BE_UNAUTHORIZED_SUGGESTION")
  }
  if (item.terminalResult != null
    || item.terminalEvidenceId != null
    || (item.terminalEvidenceRefs?.length ?? 0) > 0
    || item.terminalKey != null
    || item.terminalAt != null) {
    fail("OUTCOME_QUEUE_INTAKE_MUST_NOT_BE_TERMINAL")
  }
  return {
    outcomeKey,
    goalId: integer(item.goalId, "OUTCOME_QUEUE_GOAL_ID_INVALID", { nullable: true, minimum: 1 }),
    goalRef: optionalString(item.goalRef, "OUTCOME_QUEUE_GOAL_REF_INVALID"),
    title: nonempty(item.title, "OUTCOME_QUEUE_TITLE_INVALID"),
    objective: optionalString(item.objective, "OUTCOME_QUEUE_OBJECTIVE_INVALID"),
    queueOrder: integer(item.queueOrder ?? 0, "OUTCOME_QUEUE_ORDER_INVALID"),
    dependencyKeys,
    riskClass: nonempty(item.riskClass, "OUTCOME_QUEUE_RISK_INVALID"),
    approvalState,
    approvedBy: optionalString(item.approvedBy, "OUTCOME_QUEUE_APPROVED_BY_INVALID"),
    approvedAt: item.approvedAt == null ? null : timestamp(item.approvedAt),
    authorityState,
    authorityLevel: nonempty(item.authorityLevel ?? "A0_READ_ONLY", "OUTCOME_QUEUE_AUTHORITY_LEVEL_INVALID"),
    authorityGrantRef: optionalString(
      item.authorityGrantRef,
      "OUTCOME_QUEUE_AUTHORITY_GRANT_INVALID",
    ),
    authoritySubject: nonempty(
      item.authoritySubject ?? "operator",
      "OUTCOME_QUEUE_AUTHORITY_SUBJECT_INVALID",
    ),
    authorityAction: nonempty(
      item.authorityAction ?? "outcome:execute",
      "OUTCOME_QUEUE_AUTHORITY_ACTION_INVALID",
    ),
    lifecycleState,
    lifecycleReason: optionalString(item.lifecycleReason, "OUTCOME_QUEUE_REASON_INVALID"),
    activeWorkOrderId: integer(
      item.activeWorkOrderId,
      "OUTCOME_QUEUE_WORK_ORDER_ID_INVALID",
      { nullable: true, minimum: 1 },
    ),
    terminalResult: optionalString(item.terminalResult, "OUTCOME_QUEUE_TERMINAL_RESULT_INVALID"),
    terminalEvidenceId: integer(
      item.terminalEvidenceId,
      "OUTCOME_QUEUE_TERMINAL_EVIDENCE_ID_INVALID",
      { nullable: true, minimum: 1 },
    ),
    terminalEvidenceRefs: stringArray(
      item.terminalEvidenceRefs ?? [],
      "OUTCOME_QUEUE_TERMINAL_EVIDENCE_INVALID",
    ),
    terminalKey: optionalString(item.terminalKey, "OUTCOME_QUEUE_TERMINAL_KEY_INVALID"),
    suggestedAt: item.suggestedAt == null ? null : timestamp(item.suggestedAt),
    terminalAt: item.terminalAt == null ? null : timestamp(item.terminalAt),
  }
}

function noSelectionReason(row = {}) {
  const count = (name) => Number(row[name] ?? 0)
  if (count("totalCount") === 0) return "EMPTY_QUEUE"
  if (count("terminalCount") === count("totalCount")) return "ALL_OUTCOMES_TERMINAL"
  if (count("candidateStateCount") === 0) return "NO_ELIGIBLE_OUTCOME"
  if (count("approvalEligibleCount") === 0) return "AWAITING_APPROVAL"
  if (count("authorityEligibleCount") === 0) return "AUTHORITY_INELIGIBLE"
  if (count("riskEligibleCount") === 0) return "RISK_INELIGIBLE"
  if (count("dependencyEligibleCount") === 0) return "DEPENDENCIES_UNSATISFIED"
  if (count("activeLeaseCount") > 0) return "ACTIVE_LEASE_HELD"
  if (count("blockedCount") > 0) return "ONLY_BLOCKED_OUTCOMES"
  return "NO_ELIGIBLE_OUTCOME"
}

function compatibilityProjection(row) {
  const converted = row.status === "converted"
  const completed = converted && (
    row.workOrderStatus === "closed"
    || ["PASS", "FAIL", "PARTIAL"].includes(row.workOrderResult)
    || row.workOrderCompletedAt != null
  )
  return Object.freeze({
    userId: row.userId,
    outcomeKey: `goal:${row.ref}`,
    goalId: row.legacyGoalId,
    goalRef: row.ref,
    title: row.command,
    objective: row.command,
    lifecycleState: mapLegacyLifecycleState(row.status, completed),
    lifecycleReason: converted && !completed
      ? "LEGACY_CONVERSION_REQUIRES_TERMINAL_WORK_ORDER"
      : null,
    activeWorkOrderId: row.linkedWorkOrderId ?? null,
    approvalState: "unapproved",
    authorityState: "unverified",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    compatibility: "LEGACY_GOAL_HISTORY",
    historyOnly: true,
    selectable: false,
    executionAuthority: false,
  })
}

export async function persistOutcomeQueueItem({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  item,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const value = normalizeItem(item)
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  try {
    await connection.query("BEGIN")
    begun = true
    await connection.query(OUTCOME_QUEUE_SQL.acquireLock, [`${user}:outcome-queue`])
    if (value.dependencyKeys.length > 0) {
      const superseded = await connection.query(
        OUTCOME_QUEUE_SQL.readSupersededDependencies,
        [user, value.dependencyKeys],
      )
      if ((superseded?.rows?.length ?? 0) > 0) {
        fail("OUTCOME_QUEUE_DEPENDENCY_SUPERSEDED")
      }
      const graphResult = await connection.query(OUTCOME_QUEUE_SQL.readDependencyGraph, [user])
      const graph = (graphResult?.rows ?? [])
        .filter((row) => row.outcomeKey !== value.outcomeKey)
      graph.push({
        outcomeKey: value.outcomeKey,
        dependencyKeys: value.dependencyKeys,
      })
      if (findDependencyCycle(graph)) {
        fail("OUTCOME_QUEUE_DEPENDENCY_DEADLOCK")
      }
    }
    const result = await connection.query(OUTCOME_QUEUE_SQL.persist, [
      user,
      value.outcomeKey,
      value.goalId,
      value.goalRef,
      value.title,
      value.objective,
      value.queueOrder,
      value.dependencyKeys,
      value.riskClass,
      value.approvalState,
      value.approvedBy,
      value.approvedAt,
      value.authorityState,
      value.authorityLevel,
      value.authorityGrantRef,
      value.authoritySubject,
      value.authorityAction,
      value.lifecycleState,
      value.lifecycleReason,
      value.activeWorkOrderId,
      value.terminalResult,
      value.terminalEvidenceId,
      value.terminalEvidenceRefs,
      value.terminalKey,
      value.suggestedAt ?? at,
      value.terminalAt,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_PERSIST_CONFLICT")
    await connection.query("COMMIT")
    begun = false
    return result.rows[0]
  } catch (error) {
    if (begun) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary persistence error.
      }
    }
    throw error
  } finally {
    await connection.close()
  }
}

export async function readOutcomeQueue({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  includeLegacyHistory = false,
} = {}) {
  const user = userScope(userId)
  const connection = await openQuery(query, databaseUrl)
  try {
    const durable = await connection.query(OUTCOME_QUEUE_SQL.read, [user])
    if (!includeLegacyHistory) return durable?.rows ?? []
    const legacy = await connection.query(
      OUTCOME_QUEUE_SQL.legacyHistory,
      [user, LEGACY_GOAL_REFS],
    )
    return [...(durable?.rows ?? []), ...(legacy?.rows ?? []).map(compatibilityProjection)]
  } finally {
    await connection.close()
  }
}

export async function readLegacyOutcomeHistory({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
} = {}) {
  const user = userScope(userId)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(
      OUTCOME_QUEUE_SQL.legacyHistory,
      [user, LEGACY_GOAL_REFS],
    )
    return (result?.rows ?? []).map(compatibilityProjection)
  } finally {
    await connection.close()
  }
}

function acquisitionResult(outcome, { replayed = false, reclaimed = false } = {}) {
  return { outcome, acquired: true, replayed, reclaimed, reason: null }
}

async function ensureAcquisitionReceipt(connection, user, key, row, at, receiptExists = false) {
  const fence = Number(row.fencingToken)
  if (!Number.isSafeInteger(fence) || fence <= 0) {
    fail("OUTCOME_QUEUE_ACQUISITION_RECEIPT_INVALID")
  }
  if (receiptExists) {
    const advanced = await connection.query(OUTCOME_QUEUE_SQL.advanceAcquisitionReceipt, [
      user,
      key,
      fence,
      at,
      row.outcomeKey,
    ])
    if (advanced?.rows?.length !== 1) {
      fail("OUTCOME_QUEUE_ACQUISITION_RECEIPT_INVALID")
    }
    return advanced.rows[0]
  }
  const inserted = await connection.query(OUTCOME_QUEUE_SQL.insertAcquisitionReceipt, [
    user,
    key,
    row.outcomeKey,
    fence,
    at,
  ])
  if (inserted?.rows?.length === 1) return inserted.rows[0]

  const existing = await connection.query(OUTCOME_QUEUE_SQL.readAcquisitionReceipt, [user, key])
  if (existing?.rows?.length !== 1 || existing.rows[0].outcomeKey !== row.outcomeKey) {
    fail("OUTCOME_QUEUE_ACQUISITION_KEY_CONFLICT")
  }
  const advanced = await connection.query(OUTCOME_QUEUE_SQL.advanceAcquisitionReceipt, [
    user,
    key,
    fence,
    at,
    row.outcomeKey,
  ])
  if (advanced?.rows?.length !== 1) {
    fail("OUTCOME_QUEUE_ACQUISITION_RECEIPT_INVALID")
  }
  return advanced.rows[0]
}

async function appendAcquisitionAttempt(
  connection,
  context,
  result,
  disposition,
  at,
  proofOutcome = result?.outcome ?? null,
) {
  const outcome = proofOutcome
  if (!outcome) return
  const checkpointProof = canonicalOutcomeQueueCheckpointProof(
    await context.checkpointProofProvider({
      disposition,
      outcome: {
        activeWorkOrderId: outcome.activeWorkOrderId ?? null,
        fencingToken: Number(outcome.fencingToken),
        goalId: outcome.goalId,
        outcomeKey: outcome.outcomeKey,
      },
      processIdentity: context.processIdentity,
    }),
  )
  if (checkpointProof.outcomeKey !== outcome.outcomeKey
    || checkpointProof.outcomeId !== String(outcome.goalId)
    || checkpointProof.fencingToken !== Number(outcome.fencingToken)
    || checkpointProof.workOrderId !== (
      Number.isSafeInteger(Number(outcome.activeWorkOrderId))
        && Number(outcome.activeWorkOrderId) > 0
        ? Number(outcome.activeWorkOrderId)
        : null
    )) {
    fail("OUTCOME_QUEUE_CHECKPOINT_BINDING_WALL")
  }
  const inserted = await connection.query(OUTCOME_QUEUE_SQL.insertAcquisitionAttempt, [
    context.user,
    context.campaignWindowId,
    context.processIdentity,
    context.leaseHolder,
    context.acquisitionKeyDigest,
    context.leaseIdentityDigest,
    digestOutcomeQueueCheckpointProof(checkpointProof),
    checkpointProof.outcomeId,
    checkpointProof.sequence,
    checkpointProof.state,
    checkpointProof.commit.headSha,
    checkpointProof.commit.mergeSha,
    checkpointProof.commit.prNumber,
    outcome?.outcomeKey ?? null,
    Number.isSafeInteger(Number(outcome?.fencingToken))
      && Number(outcome?.fencingToken) > 0
      ? Number(outcome.fencingToken)
      : null,
    outcome?.leaseExpiresAt ?? null,
    Number.isSafeInteger(Number(outcome?.activeWorkOrderId))
      && Number(outcome?.activeWorkOrderId) > 0
      ? Number(outcome.activeWorkOrderId)
      : null,
    disposition,
    result?.reason ?? null,
    at,
  ])
  if (inserted?.rows?.length !== 1) {
    fail("OUTCOME_QUEUE_ACQUISITION_ATTEMPT_WRITE_WALL")
  }
}

export async function acquireNextEligibleOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  acquisitionKey,
  leaseHolder,
  leaseToken,
  executionBinding,
  leaseDurationMs,
  activeWorkOrderId = null,
  campaignWindowId,
  processIdentity,
  checkpointProofProvider,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(acquisitionKey, "OUTCOME_QUEUE_ACQUISITION_KEY_INVALID")
  const holder = nonempty(leaseHolder, "OUTCOME_QUEUE_LEASE_HOLDER_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const campaign = nonempty(
    campaignWindowId,
    "OUTCOME_QUEUE_CAMPAIGN_WINDOW_INVALID",
  )
  const processId = nonempty(
    processIdentity,
    "OUTCOME_QUEUE_PROCESS_IDENTITY_INVALID",
  )
  if (typeof checkpointProofProvider !== "function") {
    fail("OUTCOME_QUEUE_CHECKPOINT_PROVIDER_REQUIRED")
  }
  integer(leaseDurationMs, "OUTCOME_QUEUE_LEASE_DURATION_INVALID", { minimum: 1 })
  const workOrderId = integer(
    activeWorkOrderId,
    "OUTCOME_QUEUE_WORK_ORDER_ID_INVALID",
    { nullable: true, minimum: 1 },
  )
  const at = timestamp(now)
  const expiresAt = timestamp(new Date(Date.parse(at) + leaseDurationMs))
  const attemptContext = {
    user,
    campaignWindowId: campaign,
    processIdentity: processId,
    leaseHolder: holder,
    acquisitionKeyDigest: requestHash({ acquisitionKey: key }),
    leaseIdentityDigest: requestHash({ leaseHolder: holder, leaseToken: token }),
    checkpointProofProvider,
  }
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  try {
    await connection.query("BEGIN")
    begun = true
    await connection.query(OUTCOME_QUEUE_SQL.acquireLock, [`${user}:outcome-queue`])
    const finish = async (result, disposition, proofOutcome = result?.outcome ?? null) => {
      await appendAcquisitionAttempt(
        connection,
        attemptContext,
        result,
        disposition,
        at,
        proofOutcome,
      )
      await connection.query("COMMIT")
      begun = false
      return result
    }
    const receiptResult = await connection.query(
      OUTCOME_QUEUE_SQL.readAcquisitionReceipt,
      [user, key],
    )
    if ((receiptResult?.rows?.length ?? 0) > 1) {
      fail("OUTCOME_QUEUE_ACQUISITION_RECEIPT_DUPLICATED")
    }
    const receipt = receiptResult?.rows?.[0] ?? null
    let receiptEstablished = receipt !== null
    const prior = receipt
      ? await connection.query(OUTCOME_QUEUE_SQL.readReceiptOutcome, [user, receipt.outcomeKey])
      : await connection.query(OUTCOME_QUEUE_SQL.readAcquisition, [user, key])
    if ((prior?.rows?.length ?? 0) > 1) fail("OUTCOME_QUEUE_ACQUISITION_DUPLICATED")
    if (receipt && prior?.rows?.length !== 1) {
      fail("OUTCOME_QUEUE_ACQUISITION_RECEIPT_INVALID")
    }
    if (prior?.rows?.length === 1) {
      const row = prior.rows[0]
      if (!receipt) {
        await ensureAcquisitionReceipt(connection, user, key, row, at)
        receiptEstablished = true
      }
      if (row.acquisitionKey !== key) {
        return await finish({
          outcome: row,
          acquired: false,
          replayed: true,
          reclaimed: false,
          reason: "ACQUISITION_KEY_RETIRED",
        }, "REPLAY_RETIRED")
      }
      if (TERMINAL_STATES.has(row.lifecycleState)) {
        return await finish({
          outcome: row,
          acquired: false,
          replayed: true,
          reclaimed: false,
          reason: row.lifecycleState === "completed"
            ? "OUTCOME_ALREADY_COMPLETED"
            : "OUTCOME_ALREADY_TERMINAL",
        }, "REPLAY_TERMINAL")
      }
      const live = row.lifecycleState === "active"
        && Date.parse(String(row.leaseExpiresAt)) > Date.parse(at)
      if (live) {
        if (row.leaseHolder === holder
          && row.leaseToken === token
          && row.executionBinding === binding) {
          const eligibility = await connection.query(
            OUTCOME_QUEUE_SQL.revalidateAcquisition,
            [at, user, row.outcomeKey],
          )
          const liveState = eligibility?.rows?.[0]
          if (!liveState?.approvalLive || !liveState?.authorityLive) {
            return await finish({
              outcome: row,
              acquired: false,
              replayed: false,
              reclaimed: false,
              reason: !liveState?.approvalLive
                ? "AWAITING_APPROVAL"
                : "AUTHORITY_INELIGIBLE",
            }, "REPLAY_INELIGIBLE")
          }
          return await finish(
            acquisitionResult(row, { replayed: true }),
            "REPLAY_WINNER",
          )
        }
        return await finish({
          outcome: row,
          acquired: false,
          replayed: false,
          reclaimed: false,
          reason: "ACQUISITION_KEY_CONFLICT",
        }, "LOSER")
      }
      if (row.lifecycleState === "active") {
        const reclaimed = await connection.query(OUTCOME_QUEUE_SQL.reclaimAcquisition, [
          at,
          user,
          row.outcomeKey,
          binding,
          holder,
          token,
          expiresAt,
          workOrderId,
          row.version,
        ])
        if (reclaimed?.rows?.length === 1) {
          await ensureAcquisitionReceipt(
            connection,
            user,
            key,
            reclaimed.rows[0],
            at,
            receiptEstablished,
          )
          return await finish(
            acquisitionResult(reclaimed.rows[0], { reclaimed: true }),
            "RECLAIMED",
          )
        }
      }
      return await finish({
        outcome: row,
        acquired: false,
        replayed: true,
        reclaimed: false,
        reason: "ACQUISITION_KEY_INELIGIBLE",
      }, "REPLAY_INELIGIBLE")
    }
    const selected = await connection.query(OUTCOME_QUEUE_SQL.acquire, [
      at,
      user,
      key,
      binding,
      holder,
      token,
      expiresAt,
      workOrderId,
    ])
    if (selected?.rows?.length === 1) {
      await ensureAcquisitionReceipt(connection, user, key, selected.rows[0], at)
      const reclaimed = selected.rows[0].lifecycleReason === "STALE_LEASE_RECOVERED"
      return await finish(
        acquisitionResult(selected.rows[0], { reclaimed }),
        reclaimed ? "RECLAIMED" : "WINNER",
      )
    }
    const reasonResult = await connection.query(
      OUTCOME_QUEUE_SQL.noSelectionReason,
      [at, user],
    )
    const reason = noSelectionReason(reasonResult?.rows?.[0])
    let contentionOutcome = null
    if (reason === "ACTIVE_LEASE_HELD") {
      const contention = await connection.query(
        OUTCOME_QUEUE_SQL.readActiveAcquisitionProof,
        [user, at],
      )
      if (contention?.rows?.length !== 1) {
        fail("OUTCOME_QUEUE_ACQUISITION_CONTENTION_PROOF_WALL")
      }
      contentionOutcome = contention.rows[0]
    }
    return await finish({
      outcome: null,
      acquired: false,
      replayed: false,
      reclaimed: false,
      reason,
    }, reason === "ACTIVE_LEASE_HELD" ? "LOSER" : "NO_SELECTION", contentionOutcome)
  } catch (error) {
    if (begun) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary transaction error.
      }
    }
    throw error
  } finally {
    await connection.close()
  }
}

export async function transitionOutcomeQueueItem({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  fromState,
  toState,
  expectedVersion,
  executionBinding = null,
  leaseToken = null,
  fencingToken = null,
  lifecycleReason = null,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const from = enumValue(fromState, QUEUE_STATES, "OUTCOME_QUEUE_STATE_INVALID")
  const to = enumValue(toState, QUEUE_STATES, "OUTCOME_QUEUE_STATE_INVALID")
  if (!LEGAL_OUTCOME_TRANSITIONS[from].includes(to)) fail("OUTCOME_QUEUE_TRANSITION_ILLEGAL")
  if (to === "active") fail("OUTCOME_QUEUE_ACTIVE_REQUIRES_ACQUISITION")
  if (to === "approved") fail("OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED")
  if (to === "superseded") fail("OUTCOME_QUEUE_SUPERSEDE_REQUIRES_MUTATION")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  let binding = executionBinding
  let token = leaseToken
  let fence = fencingToken
  if (from === "active") {
    binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
    token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
    fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  }
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.transition, [
      user,
      key,
      from,
      to,
      version,
      binding,
      token,
      fence,
      at,
      optionalString(lifecycleReason, "OUTCOME_QUEUE_REASON_INVALID"),
    ])
    if (result?.rows?.length !== 1) {
      fail(from === "active" ? "OUTCOME_QUEUE_STALE_FENCE" : "OUTCOME_QUEUE_VERSION_CONFLICT")
    }
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function renewOutcomeQueueLease({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  leaseToken,
  fencingToken,
  leaseDurationMs,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  integer(leaseDurationMs, "OUTCOME_QUEUE_LEASE_DURATION_INVALID", { minimum: 1 })
  const at = timestamp(now)
  const expiresAt = timestamp(new Date(Date.parse(at) + leaseDurationMs))
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.renewLease, [
      user,
      key,
      version,
      binding,
      token,
      fence,
      at,
      expiresAt,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_STALE_FENCE")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function deferOutcomeQueueLease({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  leaseToken,
  fencingToken,
  retryAfter,
  lifecycleReason = "PROVIDER_UNAVAILABLE",
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  const retryAt = timestamp(retryAfter)
  const at = timestamp(now)
  if (Date.parse(retryAt) <= Date.parse(at)) fail("OUTCOME_QUEUE_RETRY_AFTER_INVALID")
  const reason = nonempty(lifecycleReason, "OUTCOME_QUEUE_REASON_INVALID")
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.deferLease, [
      user,
      key,
      version,
      binding,
      token,
      fence,
      retryAt,
      reason,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_STALE_FENCE")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function bindOutcomeQueueWorkOrder({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  leaseToken,
  fencingToken,
  activeWorkOrderId,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  const workOrderId = integer(activeWorkOrderId, "OUTCOME_QUEUE_WORK_ORDER_ID_INVALID", { minimum: 1 })
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.bindWorkOrder, [
      user,
      key,
      version,
      binding,
      token,
      fence,
      workOrderId,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_STALE_FENCE")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function verifyOutcomeQueueWorkOrderBinding({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  leaseToken,
  fencingToken,
  activeWorkOrderId,
  expectedWorkOrderStatus,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  const workOrderId = integer(activeWorkOrderId, "OUTCOME_QUEUE_WORK_ORDER_ID_INVALID", { minimum: 1 })
  const status = enumValue(
    expectedWorkOrderStatus,
    new Set(["active", "review", "blocked", "closed"]),
    "OUTCOME_QUEUE_WORK_ORDER_STATUS_INVALID",
  )
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.verifyBoundWorkOrder, [
      user,
      key,
      version,
      binding,
      token,
      fence,
      workOrderId,
      status,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_WORK_ORDER_BINDING_WALL")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function resumeOutcomeQueueAfterDecision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  acquisitionKey,
  fencingToken,
  ownerDecisionId,
  leaseHolder,
  leaseToken,
  leaseDurationMs,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const acquisition = nonempty(acquisitionKey, "OUTCOME_QUEUE_ACQUISITION_KEY_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  const decisionId = integer(ownerDecisionId, "OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED", { minimum: 1 })
  const holder = nonempty(leaseHolder, "OUTCOME_QUEUE_LEASE_HOLDER_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  integer(leaseDurationMs, "OUTCOME_QUEUE_LEASE_DURATION_INVALID", { minimum: 1 })
  const at = timestamp(now)
  const expiresAt = timestamp(new Date(Date.parse(at) + leaseDurationMs))
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  try {
    await connection.query("BEGIN")
    begun = true
    await connection.query(OUTCOME_QUEUE_SQL.acquireLock, [`${user}:outcome-queue`])
    const result = await connection.query(OUTCOME_QUEUE_SQL.resumeAfterDecision, [
      user,
      key,
      version,
      binding,
      acquisition,
      fence,
      decisionId,
      holder,
      token,
      expiresAt,
      at,
    ])
    if (result?.rows?.length === 1) {
      await connection.query("COMMIT")
      begun = false
      return result.rows[0]
    }
    const replay = await connection.query(OUTCOME_QUEUE_SQL.replayResumeAfterDecision, [
      user,
      key,
      version,
      binding,
      acquisition,
      fence,
      decisionId,
      holder,
      token,
      expiresAt,
      at,
    ])
    if (replay?.rows?.length !== 1) fail("OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL")
    await connection.query("COMMIT")
    begun = false
    return replay.rows[0]
  } catch (error) {
    if (begun) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary resume error.
      }
    }
    throw error
  } finally {
    await connection.close()
  }
}

export async function approveOutcomeQueueItem({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  approvalDecisionId,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const decisionId = integer(
    approvalDecisionId,
    "OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED",
    { minimum: 1 },
  )
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.approve, [
      user,
      key,
      version,
      decisionId,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_APPROVAL_DECISION_INVALID")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function matchOutcomeAuthorityGrant({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  authorityGrantRef,
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const grantRef = nonempty(
    authorityGrantRef,
    "OUTCOME_QUEUE_AUTHORITY_GRANT_REF_INVALID",
  )
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.matchAuthority, [
      user,
      key,
      version,
      grantRef,
      at,
    ])
    if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_AUTHORITY_GRANT_INVALID")
    return result.rows[0]
  } finally {
    await connection.close()
  }
}

export async function completeOutcomeQueueItem({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  outcomeKey,
  expectedVersion,
  executionBinding,
  leaseToken,
  fencingToken,
  acquisitionKey,
  terminalKey,
  terminalResult,
  terminalEvidenceId = null,
  terminalEvidenceRefs = [],
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const version = integer(expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const fence = integer(fencingToken, "OUTCOME_QUEUE_FENCING_TOKEN_INVALID", { minimum: 1 })
  const acquisition = nonempty(acquisitionKey, "OUTCOME_QUEUE_ACQUISITION_KEY_INVALID")
  const completion = nonempty(terminalKey, "OUTCOME_QUEUE_TERMINAL_KEY_INVALID")
  const terminal = nonempty(terminalResult, "OUTCOME_QUEUE_TERMINAL_RESULT_REQUIRED")
  const evidenceId = integer(
    terminalEvidenceId,
    "OUTCOME_QUEUE_TERMINAL_EVIDENCE_ID_INVALID",
    { nullable: true, minimum: 1 },
  )
  const evidenceRefs = stringArray(
    terminalEvidenceRefs,
    "OUTCOME_QUEUE_TERMINAL_EVIDENCE_INVALID",
  )
  if (evidenceId == null && evidenceRefs.length === 0) {
    fail("OUTCOME_QUEUE_TERMINAL_EVIDENCE_REQUIRED")
  }
  const at = timestamp(now)
  const connection = await openQuery(query, databaseUrl)
  try {
    const result = await connection.query(OUTCOME_QUEUE_SQL.complete, [
      user,
      key,
      version,
      binding,
      token,
      fence,
      acquisition,
      completion,
      terminal,
      evidenceId,
      evidenceRefs,
      at,
    ])
    if (result?.rows?.length === 1) return { outcome: result.rows[0], replayed: false }
    const current = await connection.query(OUTCOME_QUEUE_SQL.readOne, [user, key])
    const row = current?.rows?.length === 1 ? current.rows[0] : null
    if (row?.lifecycleState === "completed"
      && row.executionBinding === binding
      && Number(row.fencingToken) === fence
      && row.acquisitionKey === acquisition
      && row.terminalKey === completion
      && row.terminalResult === terminal
      && row.terminalEvidenceId === evidenceId
      && JSON.stringify(row.terminalEvidenceRefs ?? []) === JSON.stringify(evidenceRefs)) {
      return { outcome: row, replayed: true }
    }
    fail("OUTCOME_QUEUE_STALE_FENCE")
  } finally {
    await connection.close()
  }
}

const MUTATION_ACTIONS = new Set([
  "pause",
  "resume",
  "reorder",
  "dependencies",
  "approve",
  "decline",
  "supersede",
])

function normalizeOrderedOutcomes(value) {
  if (value == null) return null
  if (!Array.isArray(value) || value.length === 0) {
    fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_INVALID")
  }
  const ordered = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_INVALID")
    }
    return {
      outcomeKey: nonempty(entry.outcomeKey, "OUTCOME_QUEUE_KEY_INVALID"),
      expectedVersion: integer(
        entry.expectedVersion,
        "OUTCOME_QUEUE_VERSION_INVALID",
      ),
    }
  })
  if (new Set(ordered.map((entry) => entry.outcomeKey)).size !== ordered.length) {
    fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_INVALID")
  }
  return ordered
}

function normalizeReplacement(value, sourceKey, user, idempotencyKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("OUTCOME_QUEUE_REPLACEMENT_REQUIRED")
  }
  const outcomeKey = `outcome:successor:${createHash("sha256")
    .update(`${user}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24)}`
  if (outcomeKey === sourceKey) fail("OUTCOME_QUEUE_REPLACEMENT_KEY_INVALID")
  return {
    outcomeKey,
    title: nonempty(value.title, "OUTCOME_QUEUE_REPLACEMENT_TITLE_INVALID"),
    objective: optionalString(value.objective, "OUTCOME_QUEUE_REPLACEMENT_OBJECTIVE_INVALID"),
  }
}

function normalizeDependencyKeys(value) {
  if (!Array.isArray(value) || value.length > 100) {
    fail("OUTCOME_QUEUE_DEPENDENCIES_INVALID")
  }
  const dependencies = value.map((entry) => (
    nonempty(entry, "OUTCOME_QUEUE_DEPENDENCIES_INVALID")
  ))
  if (new Set(dependencies).size !== dependencies.length) {
    fail("OUTCOME_QUEUE_DEPENDENCIES_INVALID")
  }
  return dependencies.sort()
}

function mutationRequest(input, user) {
  const action = enumValue(input.action, MUTATION_ACTIONS, "OUTCOME_QUEUE_MUTATION_ACTION_INVALID")
  const outcomeKey = nonempty(input.outcomeKey, "OUTCOME_QUEUE_KEY_INVALID")
  const expectedVersion = integer(input.expectedVersion, "OUTCOME_QUEUE_VERSION_INVALID")
  const idempotencyKey = nonempty(
    input.idempotencyKey,
    "OUTCOME_QUEUE_IDEMPOTENCY_KEY_INVALID",
  )
  const orderedOutcomes = action === "reorder"
    ? normalizeOrderedOutcomes(input.orderedOutcomes)
    : null
  if (action === "reorder" && orderedOutcomes === null) {
    fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_REQUIRED")
  }
  const dependencyKeys = action === "dependencies"
    ? normalizeDependencyKeys(input.dependencyKeys)
    : null
  const approvalDecisionId = input.approvalDecisionId == null
    ? null
    : integer(input.approvalDecisionId, "OUTCOME_QUEUE_APPROVAL_DECISION_INVALID", { minimum: 1 })
  const authorityGrantRef = optionalString(
    input.authorityGrantRef,
    "OUTCOME_QUEUE_AUTHORITY_GRANT_INVALID",
  )
  if (["approve", "resume"].includes(action)
    && (approvalDecisionId === null || authorityGrantRef === null)) {
    fail("OUTCOME_QUEUE_APPROVAL_AUTHORITY_REQUIRED")
  }
  const replacement = action === "supersede"
    ? normalizeReplacement(input.replacement, outcomeKey, user, idempotencyKey)
    : null
  return {
    action,
    outcomeKey,
    expectedVersion,
    idempotencyKey,
    reason: optionalString(input.reason, "OUTCOME_QUEUE_REASON_INVALID"),
    approvalDecisionId,
    authorityGrantRef,
    orderedOutcomes,
    dependencyKeys,
    replacement,
  }
}

function assertVersion(row, expectedVersion) {
  if (row.version !== expectedVersion) fail("OUTCOME_QUEUE_VERSION_CONFLICT")
}

function safeMutationOutcome(row) {
  if (row == null) return null
  const safe = { ...row }
  for (const field of [
    "executionBinding",
    "leaseToken",
    "fencingToken",
    "acquisitionKey",
    "terminalKey",
  ]) delete safe[field]
  return safe
}

async function appendMutationAttempt(
  connection,
  { user, idempotencyKey, requestDigest, resultDigest, disposition, at },
) {
  const ordinalResult = await connection.query(
    OUTCOME_QUEUE_SQL.nextMutationAttemptOrdinal,
    [user, idempotencyKey],
  )
  const attemptOrdinal = Number(ordinalResult?.rows?.[0]?.attemptOrdinal)
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal <= 0) {
    fail("OUTCOME_QUEUE_MUTATION_ATTEMPT_ORDINAL_WALL")
  }
  const inserted = await connection.query(OUTCOME_QUEUE_SQL.insertMutationAttempt, [
    user,
    idempotencyKey,
    requestDigest,
    resultDigest,
    attemptOrdinal,
    disposition,
    at,
  ])
  if (inserted?.rows?.length !== 1) {
    fail("OUTCOME_QUEUE_MUTATION_ATTEMPT_WRITE_WALL")
  }
  return inserted.rows[0]
}

async function reorderMutation(connection, request, user, at) {
  const snapshotResult = await connection.query(OUTCOME_QUEUE_SQL.readMutationSnapshot, [user])
  const snapshot = snapshotResult?.rows ?? []
  const target = snapshot.find((row) => row.outcomeKey === request.outcomeKey)
  if (!target) fail("OUTCOME_QUEUE_OUTCOME_NOT_FOUND")
  assertVersion(target, request.expectedVersion)
  if (target.lifecycleState === "active") fail("OUTCOME_QUEUE_REORDER_ACTIVE_ILLEGAL")

  if (request.orderedOutcomes.length !== snapshot.length) {
    fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE")
  }
  const byKey = new Map(snapshot.map((row) => [row.outcomeKey, row]))
  const ordered = request.orderedOutcomes.map((entry) => {
    const row = byKey.get(entry.outcomeKey)
    if (!row) fail("OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE")
    assertVersion(row, entry.expectedVersion)
    return row
  })

  let outcome = target
  const affectedOutcomes = []
  for (const [queueOrder, row] of ordered.entries()) {
    // Active work owns its version until it pauses or terminalizes.
    if (row.lifecycleState === "active") continue
    if (row.queueOrder === queueOrder) continue
    const updated = await connection.query(OUTCOME_QUEUE_SQL.reorderMutation, [
      user,
      row.outcomeKey,
      row.version,
      queueOrder,
      at,
    ])
    if (updated?.rows?.length !== 1) fail("OUTCOME_QUEUE_VERSION_CONFLICT")
    affectedOutcomes.push(updated.rows[0])
    if (row.outcomeKey === request.outcomeKey) outcome = updated.rows[0]
  }
  return { outcome, affectedOutcomes }
}

function dependencyMutationCycle(snapshot, outcomeKey, dependencyKeys) {
  const byKey = new Map(snapshot.map((row) => [row.outcomeKey, row]))
  const dependenciesFor = (key) => (
    key === outcomeKey ? dependencyKeys : (byKey.get(key)?.dependencyKeys ?? [])
  )
  const visiting = new Set()
  const visited = new Set()

  function visit(key) {
    if (visiting.has(key)) return true
    if (visited.has(key)) return false
    visiting.add(key)
    for (const dependencyKey of dependenciesFor(key)) {
      if (visit(dependencyKey)) return true
    }
    visiting.delete(key)
    visited.add(key)
    return false
  }

  return visit(outcomeKey)
}

async function dependenciesMutation(connection, request, user, at) {
  const snapshotResult = await connection.query(
    OUTCOME_QUEUE_SQL.readDependencyMutationSnapshot,
    [user],
  )
  const snapshot = snapshotResult?.rows ?? []
  const target = snapshot.find((row) => row.outcomeKey === request.outcomeKey)
  if (!target) fail("OUTCOME_QUEUE_OUTCOME_NOT_FOUND")
  assertVersion(target, request.expectedVersion)
  if (!["suggested", "approved", "blocked"].includes(target.lifecycleState)) {
    fail("OUTCOME_QUEUE_DEPENDENCIES_ILLEGAL")
  }
  if (request.dependencyKeys.includes(request.outcomeKey)) {
    fail("OUTCOME_QUEUE_DEPENDENCY_CYCLE")
  }
  const byKey = new Map(snapshot.map((row) => [row.outcomeKey, row]))
  for (const dependencyKey of request.dependencyKeys) {
    const dependency = byKey.get(dependencyKey)
    if (!dependency || ["declined", "superseded"].includes(dependency.lifecycleState)) {
      fail("OUTCOME_QUEUE_DEPENDENCY_INVALID")
    }
  }
  if (dependencyMutationCycle(snapshot, request.outcomeKey, request.dependencyKeys)) {
    fail("OUTCOME_QUEUE_DEPENDENCY_CYCLE")
  }
  const updated = await connection.query(OUTCOME_QUEUE_SQL.dependencyMutation, [
    user,
    request.outcomeKey,
    request.expectedVersion,
    request.dependencyKeys,
    at,
  ])
  if (updated?.rows?.length !== 1) fail("OUTCOME_QUEUE_VERSION_CONFLICT")
  return updated.rows[0]
}

/**
 * Canonical exactly-once operator mutation boundary used by app/actions/outcome-queue.ts.
 */
export async function mutateOutcomeQueueItem({
  query,
  databaseUrl = process.env.DATABASE_URL,
  userId,
  now = new Date(),
  ...input
} = {}) {
  const user = userScope(userId)
  const request = mutationRequest(input, user)
  const at = timestamp(now)
  const binding = canonicalValue(request)
  const hash = requestHash(binding)
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  try {
    await connection.query("BEGIN")
    begun = true
    await connection.query(OUTCOME_QUEUE_SQL.acquireLock, [`${user}:outcome-queue`])
    const prior = await connection.query(
      OUTCOME_QUEUE_SQL.readMutationReceipt,
      [user, request.idempotencyKey],
    )
    if (prior?.rows?.length === 1) {
      const receipt = prior.rows[0]
      if (receipt.requestHash !== hash
        || canonicalJson(jsonValue(
          receipt.requestBinding,
          "OUTCOME_QUEUE_RECEIPT_INVALID",
        )) !== canonicalJson(binding)) {
        fail("OUTCOME_QUEUE_IDEMPOTENCY_CONFLICT")
      }
      const recorded = jsonValue(receipt.resultBinding, "OUTCOME_QUEUE_RECEIPT_INVALID")
      const resultDigest = requestHash(canonicalValue(recorded))
      await appendMutationAttempt(connection, {
        user,
        idempotencyKey: request.idempotencyKey,
        requestDigest: hash,
        resultDigest,
        disposition: OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.REPLAY,
        at,
      })
      await connection.query("COMMIT")
      begun = false
      return { ...recorded, replayed: true }
    }

    let outcome
    let affectedOutcomes = []
    let successor = null
    let reboundDependents = []
    if (request.action === "reorder") {
      const reordered = await reorderMutation(connection, request, user, at)
      outcome = reordered.outcome
      affectedOutcomes = reordered.affectedOutcomes
    } else if (request.action === "dependencies") {
      outcome = await dependenciesMutation(connection, request, user, at)
      affectedOutcomes = [outcome]
    } else {
      const currentResult = await connection.query(
        OUTCOME_QUEUE_SQL.readMutationItem,
        [user, request.outcomeKey],
      )
      if (currentResult?.rows?.length !== 1) fail("OUTCOME_QUEUE_OUTCOME_NOT_FOUND")
      const current = currentResult.rows[0]
      assertVersion(current, request.expectedVersion)

      let result
      if (request.action === "pause") {
        if (!["approved", "active"].includes(current.lifecycleState)) {
          fail("OUTCOME_QUEUE_PAUSE_ILLEGAL")
        }
        result = await connection.query(OUTCOME_QUEUE_SQL.pauseMutation, [
          user, request.outcomeKey, request.expectedVersion, request.reason, at,
        ])
      } else if (request.action === "approve" || request.action === "resume") {
        const expectedState = request.action === "resume" ? "blocked" : "suggested"
        if (current.lifecycleState !== expectedState) {
          fail(`OUTCOME_QUEUE_${request.action.toUpperCase()}_ILLEGAL`)
        }
        result = await connection.query(OUTCOME_QUEUE_SQL.governedApprovalMutation, [
          user,
          request.outcomeKey,
          request.expectedVersion,
          request.approvalDecisionId,
          request.authorityGrantRef,
          at,
          expectedState,
        ])
        if (result?.rows?.length !== 1) {
          fail("OUTCOME_QUEUE_APPROVAL_AUTHORITY_INVALID")
        }
      } else if (request.action === "decline") {
        if (current.lifecycleState === "active") {
          fail("OUTCOME_QUEUE_ACTIVE_TERMINATION_ILLEGAL")
        }
        result = await connection.query(OUTCOME_QUEUE_SQL.declineMutation, [
          user, request.outcomeKey, request.expectedVersion, request.reason, at,
        ])
      } else {
        if (current.lifecycleState === "active") {
          fail("OUTCOME_QUEUE_ACTIVE_TERMINATION_ILLEGAL")
        }
        const replacement = request.replacement
        result = await connection.query(OUTCOME_QUEUE_SQL.supersedeMutation, [
          user,
          request.outcomeKey,
          request.expectedVersion,
          request.reason,
          replacement.outcomeKey,
          at,
        ])
        if (result?.rows?.length === 1) {
          const inserted = await connection.query(OUTCOME_QUEUE_SQL.insertSupersedingOutcome, [
            user,
            replacement.outcomeKey,
            current.goalId,
            current.goalRef,
            replacement.title,
            replacement.objective,
            current.queueOrder,
            current.dependencyKeys,
            current.riskClass,
            current.authorityLevel,
            current.authoritySubject,
            current.authorityAction,
            request.outcomeKey,
            at,
          ])
          if (inserted?.rows?.length !== 1) fail("OUTCOME_QUEUE_REPLACEMENT_CONFLICT")
          successor = inserted.rows[0]
          const rebound = await connection.query(
            OUTCOME_QUEUE_SQL.rebindSupersededDependents,
            [user, request.outcomeKey, replacement.outcomeKey, at],
          )
          reboundDependents = rebound?.rows ?? []
        }
      }
      if (result?.rows?.length !== 1) fail("OUTCOME_QUEUE_VERSION_CONFLICT")
      outcome = result.rows[0]
      affectedOutcomes = successor
        ? [outcome, successor, ...reboundDependents]
        : [outcome]
    }

    const recorded = canonicalValue({
      outcome: safeMutationOutcome(outcome),
      affectedOutcomes: affectedOutcomes.map(safeMutationOutcome),
      successor: safeMutationOutcome(successor),
    })
    const resultDigest = requestHash(recorded)
    const receiptResult = await connection.query(OUTCOME_QUEUE_SQL.insertMutationReceipt, [
      user,
      request.idempotencyKey,
      request.action,
      request.outcomeKey,
      hash,
      canonicalJson(binding),
      canonicalJson(recorded),
      at,
    ])
    if (receiptResult?.rows?.length !== 1) fail("OUTCOME_QUEUE_RECEIPT_WRITE_FAILED")
    const mutationAttempt = await appendMutationAttempt(connection, {
      user,
      idempotencyKey: request.idempotencyKey,
      requestDigest: hash,
      resultDigest,
      disposition: OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.COMMITTED,
      at,
    })
    const metadata = {
      idempotencyKey: request.idempotencyKey,
      operation: request.action,
      receiptId: receiptResult.rows[0].id,
      requestHash: hash,
      resultDigest,
      mutationAttemptId: mutationAttempt.id,
      resultVersion: recorded.outcome.version,
      affectedOutcomes: recorded.affectedOutcomes.map((item) => ({
        outcomeKey: item.outcomeKey,
        version: item.version,
      })),
      successor: recorded.successor
        ? {
            outcomeKey: recorded.successor.outcomeKey,
            version: recorded.successor.version,
          }
        : null,
    }
    const eventType = `OUTCOME_QUEUE_${request.action.toUpperCase()}`
    const audit = await connection.query(OUTCOME_QUEUE_SQL.insertMutationAudit, [
      user,
      eventType,
      request.outcomeKey,
      request.reason,
      canonicalJson(metadata),
      at,
    ])
    if (audit?.rows?.length !== 1) fail("OUTCOME_QUEUE_AUDIT_WRITE_FAILED")
    const event = await connection.query(OUTCOME_QUEUE_SQL.insertMutationEvent, [
      user,
      eventType,
      `Outcome queue ${request.action}: ${request.outcomeKey}`,
      recorded.outcome.id ?? null,
      canonicalJson({ ...metadata, governanceEventId: audit.rows[0].id }),
      at,
    ])
    if (event?.rows?.length !== 1) fail("OUTCOME_QUEUE_EVENT_WRITE_FAILED")
    await connection.query("COMMIT")
    begun = false
    return { ...recorded, replayed: false }
  } catch (error) {
    if (begun) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary mutation error.
      }
    }
    throw error
  } finally {
    await connection.close()
  }
}

export const enqueueOutcome = persistOutcomeQueueItem
export const listOutcomeQueue = readOutcomeQueue
export const acquireOutcome = acquireNextEligibleOutcome
export const renewOutcomeLease = renewOutcomeQueueLease
export const deferOutcomeLease = deferOutcomeQueueLease
export const bindOutcomeWorkOrder = bindOutcomeQueueWorkOrder
export const verifyOutcomeWorkOrderBinding = verifyOutcomeQueueWorkOrderBinding
export const resumeOutcomeAfterDecision = resumeOutcomeQueueAfterDecision
export const approveOutcome = approveOutcomeQueueItem
export const transitionOutcome = transitionOutcomeQueueItem
export const matchOutcomeAuthority = matchOutcomeAuthorityGrant
export const completeQueuedOutcome = completeOutcomeQueueItem
