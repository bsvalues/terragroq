const QUEUE_STATES = new Set([
  "suggested",
  "approved",
  "blocked",
  "active",
  "completed",
  "declined",
  "superseded",
])
const APPROVAL_STATES = new Set(["approved", "unapproved", "revoked"])
const AUTHORITY_STATES = new Set(["matched", "unverified", "denied", "expired", "revoked"])
const TERMINAL_STATES = new Set(["completed", "declined", "superseded"])
const LEGACY_GOAL_REFS = Object.freeze([
  "GOAL-0001",
  "GOAL-0002",
  "GOAL-0003",
  "GOAL-0004",
  "GOAL-0005",
])

const LEGAL_TRANSITIONS = Object.freeze({
  suggested: Object.freeze(["approved", "declined", "superseded"]),
  approved: Object.freeze(["blocked", "declined", "superseded"]),
  blocked: Object.freeze(["approved", "declined", "superseded"]),
  active: Object.freeze(["blocked"]),
  completed: Object.freeze([]),
  declined: Object.freeze([]),
  superseded: Object.freeze([]),
})

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

const LIVE_APPROVAL_PREDICATE = `
  q."approvalState" = 'approved'
  AND EXISTS (
    SELECT 1
    FROM "decision" AS live_approval
    WHERE live_approval."id" = q."approvalDecisionId"
      AND live_approval."userId" = q."userId"
      AND live_approval."status" = 'accepted'
      AND live_approval."authority" = 'binding'
      AND live_approval."scope" IN (q."outcomeKey", q."goalRef")
  )
`

const LIVE_AUTHORITY_PREDICATE = `
  q."authorityState" = 'matched'
  AND EXISTS (
    SELECT 1
    FROM "authority_grant" AS live_grant
    WHERE live_grant."userId" = q."userId"
      AND live_grant."ref" = q."authorityGrantRef"
      AND live_grant."status" = 'active'
      AND live_grant."revokedAt" IS NULL
      AND (live_grant."expiresAt" IS NULL OR live_grant."expiresAt" > $1::timestamptz)
      AND live_grant."authorityLevel" = q."authorityLevel"
      AND (
        live_grant."workOrderId" IS NULL
        OR q."activeWorkOrderId" = live_grant."workOrderId"
      )
  )
`

const ELIGIBILITY_PREDICATE = `
  q."userId" = $2
  AND ${LIVE_APPROVAL_PREDICATE}
  AND ${LIVE_AUTHORITY_PREDICATE}
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
  acquireLock: `SELECT pg_advisory_xact_lock(hashtext($1))`,
  persist: `
INSERT INTO "outcome_queue_item" (
  "userId", "outcomeKey", "goalId", "goalRef", "title", "objective",
  "queueOrder", "dependencyKeys", "riskClass", "approvalState", "approvedBy",
  "approvedAt", "authorityState", "authorityLevel", "authorityGrantRef",
  "lifecycleState", "lifecycleReason", "activeWorkOrderId", "terminalResult",
  "terminalEvidenceId", "terminalEvidenceRefs", "terminalKey", "suggestedAt",
  "terminalAt", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11,
  $12::timestamptz, $13, $14, $15, $16, $17, $18, $19, $20,
  $21::text[], $22, $23::timestamptz, $24::timestamptz,
  $25::timestamptz, $25::timestamptz
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
FOR UPDATE OF q SKIP LOCKED
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
  AND ${LIVE_AUTHORITY_PREDICATE}
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" AS completed_dependency
      ON completed_dependency."userId" = q."userId"
      AND completed_dependency."outcomeKey" = dependency."outcomeKey"
    WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
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
  AND approval."scope" IN (q."outcomeKey", q."goalRef")
RETURNING ${QUEUE_COLUMNS}
`,
  matchAuthority: `
UPDATE "outcome_queue_item" AS q
SET "authorityState" = 'matched',
    "authorityGrantRef" = grant."ref",
    "version" = q."version" + 1,
    "updatedAt" = $5::timestamptz
FROM "authority_grant" AS grant
WHERE q."userId" = $1
  AND q."outcomeKey" = $2
  AND q."version" = $3
  AND q."lifecycleState" IN ('suggested', 'approved', 'blocked')
  AND grant."userId" = q."userId"
  AND grant."ref" = $4
  AND grant."status" = 'active'
  AND grant."revokedAt" IS NULL
  AND (grant."expiresAt" IS NULL OR grant."expiresAt" > $5::timestamptz)
  AND grant."authorityLevel" = q."authorityLevel"
  AND (
    grant."workOrderId" IS NULL
    OR q."activeWorkOrderId" = grant."workOrderId"
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
RETURNING ${QUEUE_COLUMNS}
`,
  legacyHistory: `
SELECT
  g."id" AS "legacyGoalId",
  g."userId",
  g."ref",
  g."command",
  g."status",
  g."createdAt",
  g."updatedAt"
FROM "goal" AS g
WHERE g."userId" = $1
  AND g."ref" = ANY($2::text[])
ORDER BY g."ref" ASC, g."id" ASC
`,
})

export const OUTCOME_QUEUE_STATES = Object.freeze([...QUEUE_STATES])
export const OUTCOME_QUEUE_LEGAL_TRANSITIONS = LEGAL_TRANSITIONS
export const OUTCOME_QUEUE_LEGACY_GOAL_REFS = LEGACY_GOAL_REFS

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
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl })
  if (!transactional) return { query: pool.query.bind(pool), close: async () => pool.end() }
  const client = await pool.connect()
  return {
    query: client.query.bind(client),
    close: async () => {
      client.release()
      await pool.end()
    },
  }
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

function userScope(userId) {
  return nonempty(userId, "OUTCOME_QUEUE_USER_ID_INVALID")
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
  if (lifecycleState === "active") fail("OUTCOME_QUEUE_ACTIVE_REQUIRES_ACQUISITION")
  if (lifecycleState !== "suggested"
    || approvalState !== "unapproved"
    || authorityState !== "unverified"
    || item.approvedBy != null
    || item.approvedAt != null
    || item.authorityGrantRef != null) {
    fail("OUTCOME_QUEUE_INTAKE_MUST_BE_UNAUTHORIZED_SUGGESTION")
  }
  if (lifecycleState === "completed"
    && (!item.terminalResult || (!item.terminalEvidenceId && !item.terminalEvidenceRefs?.length))) {
    fail("OUTCOME_QUEUE_TERMINAL_EVIDENCE_REQUIRED")
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
  return "CONTENDED"
}

function compatibilityProjection(row) {
  return Object.freeze({
    userId: row.userId,
    outcomeKey: `goal:${row.ref}`,
    goalId: row.legacyGoalId,
    goalRef: row.ref,
    title: row.command,
    objective: row.command,
    lifecycleState: row.status === "converted" ? "completed" : "superseded",
    approvalState: "unapproved",
    authorityState: "unverified",
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
  const connection = await openQuery(query, databaseUrl)
  try {
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
    return result.rows[0]
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
  now = new Date(),
} = {}) {
  const user = userScope(userId)
  const key = nonempty(acquisitionKey, "OUTCOME_QUEUE_ACQUISITION_KEY_INVALID")
  const holder = nonempty(leaseHolder, "OUTCOME_QUEUE_LEASE_HOLDER_INVALID")
  const token = nonempty(leaseToken, "OUTCOME_QUEUE_LEASE_TOKEN_INVALID")
  const binding = nonempty(executionBinding, "OUTCOME_QUEUE_EXECUTION_BINDING_INVALID")
  integer(leaseDurationMs, "OUTCOME_QUEUE_LEASE_DURATION_INVALID", { minimum: 1 })
  const workOrderId = integer(
    activeWorkOrderId,
    "OUTCOME_QUEUE_WORK_ORDER_ID_INVALID",
    { nullable: true, minimum: 1 },
  )
  const at = timestamp(now)
  const expiresAt = timestamp(new Date(Date.parse(at) + leaseDurationMs))
  const connection = await openQuery(query, databaseUrl, true)
  let begun = false
  try {
    await connection.query("BEGIN")
    begun = true
    await connection.query(OUTCOME_QUEUE_SQL.acquireLock, [`${user}:outcome-queue`])
    const prior = await connection.query(OUTCOME_QUEUE_SQL.readAcquisition, [user, key])
    if ((prior?.rows?.length ?? 0) > 1) fail("OUTCOME_QUEUE_ACQUISITION_DUPLICATED")
    if (prior?.rows?.length === 1) {
      const row = prior.rows[0]
      if (TERMINAL_STATES.has(row.lifecycleState)) {
        await connection.query("COMMIT")
        begun = false
        return {
          outcome: row,
          acquired: false,
          replayed: true,
          reclaimed: false,
          reason: row.lifecycleState === "completed"
            ? "OUTCOME_ALREADY_COMPLETED"
            : "OUTCOME_ALREADY_TERMINAL",
        }
      }
      const live = row.lifecycleState === "active"
        && Date.parse(String(row.leaseExpiresAt)) > Date.parse(at)
      if (live) {
        await connection.query("COMMIT")
        begun = false
        if (row.leaseHolder === holder
          && row.leaseToken === token
          && row.executionBinding === binding) {
          return acquisitionResult(row, { replayed: true })
        }
        return {
          outcome: row,
          acquired: false,
          replayed: false,
          reclaimed: false,
          reason: "ACQUISITION_KEY_CONFLICT",
        }
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
          await connection.query("COMMIT")
          begun = false
          return acquisitionResult(reclaimed.rows[0], { reclaimed: true })
        }
      }
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
      await connection.query("COMMIT")
      begun = false
      return acquisitionResult(selected.rows[0], {
        reclaimed: selected.rows[0].lifecycleReason === "STALE_LEASE_RECOVERED",
      })
    }
    const reasonResult = await connection.query(
      OUTCOME_QUEUE_SQL.noSelectionReason,
      [at, user],
    )
    await connection.query("COMMIT")
    begun = false
    return {
      outcome: null,
      acquired: false,
      replayed: false,
      reclaimed: false,
      reason: noSelectionReason(reasonResult?.rows?.[0]),
    }
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
  if (!LEGAL_TRANSITIONS[from].includes(to)) fail("OUTCOME_QUEUE_TRANSITION_ILLEGAL")
  if (to === "approved") fail("OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED")
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

export const enqueueOutcome = persistOutcomeQueueItem
export const listOutcomeQueue = readOutcomeQueue
export const acquireOutcome = acquireNextEligibleOutcome
export const approveOutcome = approveOutcomeQueueItem
export const transitionOutcome = transitionOutcomeQueueItem
export const matchOutcomeAuthority = matchOutcomeAuthorityGrant
export const completeQueuedOutcome = completeOutcomeQueueItem
