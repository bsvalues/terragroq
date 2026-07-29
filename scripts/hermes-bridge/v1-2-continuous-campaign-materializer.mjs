import { createHash } from "node:crypto"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { ensureOutcomeQueueHardeningSchema } from "./outcome-queue-source.mjs"

const REPOSITORY = "bsvalues/terragroq"
const PRIMARY_EMAIL = "bsvalues@gmail.com"
const PARENT_AUTHOR_ID = 179160703
const PARENT_ISSUE = 471
const PARENT_GOAL = "GOAL-WOS-V1.2-001"
// Any parent-body edit requires an intentional digest review and re-pin here.
const PARENT_BODY_SHA256 = "3771f688ee4c5d2f7e4ff22dbb09c45062a75d503fea5931912b98d1270db73a"
const CAMPAIGN_QUEUE_PARTITION_LIMIT = 90
export const V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT = "WILLIAMOS_V1_2_CAMPAIGN_SUGGESTION_V1"
const MATERIALIZER_ID = "scripts/hermes-bridge/v1-2-continuous-campaign-materializer.mjs"
const SUGGESTION_REASON = "Suggested from the exact owner-authored and still-open V1.2 parent #471 without approval or authority."
const GOAL_RATIONALE = "Suggested as fixed WilliamOS-native R1 work from pinned live parent #471; this record conveys no approval or execution authority."
const GOAL_RECOMMENDED_MOVE = "Await an explicit owner approval and independently verified authority match."
const LIFECYCLE_REASON = "V1_2_CAMPAIGN_SUGGESTION_REQUIRES_OWNER_APPROVAL"
const AUTHORITY_MUTATION_SQL = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?(?:(?:"?[a-z_][\w$]*"?\s*\.\s*)?)"?(?:decision|authority_grant)"?(?=\s|\(|$)/i
const AUTHORITY_DESTRUCTIVE_SQL = /\b(?:TRUNCATE(?:\s+TABLE)?|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*?(?:(?:"?[a-z_][\w$]*"?\s*\.\s*)?)"?(?:decision|authority_grant)"?(?=\s|,|\(|;|$)/i
const AUTHORITY_INDIRECT_SQL = /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:RULE|(?:CONSTRAINT\s+)?TRIGGER)\b[\s\S]*?\b(?:ON|TO)\s+(?:(?:"?[a-z_][\w$]*"?\s*\.\s*)?)"?(?:decision|authority_grant)"?(?=\s|,|\(|;|$)/i
const AUTHORITY_PERMISSION_SQL = /\b(?:GRANT|REVOKE)\b[\s\S]*?\bON(?:\s+TABLE)?\s+(?:(?:"?[a-z_][\w$]*"?\s*\.\s*)?)"?(?:decision|authority_grant)"?(?=\s|,|\(|;|$)/i

export const V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES = Object.freeze([
  Object.freeze({
    outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
    title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
    objective: "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist.",
    dependencyKeys: Object.freeze([]),
  }),
  Object.freeze({
    outcomeKey: "campaign:v1-2:runtime-continuity-status",
    title: "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
    objective: "Show the live campaign window, acquisition and settlement sequence, automatic successor handoff, and truthful evidence gaps.",
    dependencyKeys: Object.freeze(["campaign:v1-2:queue-evidence-drilldown"]),
  }),
])

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

function digest(value) {
  const source = typeof value === "string"
    ? value
    : JSON.stringify(canonical(value))
  return createHash("sha256").update(source).digest("hex")
}

function normalizedBody(value) {
  return String(value ?? "").replaceAll("\r\n", "\n").trim()
}

function iso(value) {
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

export function assertV12CampaignSuggestionOnlySql(sqlValue) {
  if (AUTHORITY_MUTATION_SQL.test(String(sqlValue))
    || AUTHORITY_DESTRUCTIVE_SQL.test(String(sqlValue))
    || AUTHORITY_INDIRECT_SQL.test(String(sqlValue))
    || AUTHORITY_PERMISSION_SQL.test(String(sqlValue))) {
    throw new Error("V1_2_CAMPAIGN_AUTHORITY_MUTATION_WALL")
  }
  return true
}

export function buildV12CampaignMaterializerProvenance({
  userId,
  goalId,
  item,
}) {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new Error("V1_2_CAMPAIGN_PROVENANCE_IDENTITY_WALL")
  }
  if (!Number.isSafeInteger(Number(goalId)) || Number(goalId) <= 0) {
    throw new Error("V1_2_CAMPAIGN_PROVENANCE_GOAL_WALL")
  }
  if (!item || typeof item !== "object") {
    throw new Error("V1_2_CAMPAIGN_PROVENANCE_OUTCOME_WALL")
  }

  const timestamp = iso(item.suggestedAt)
  if (timestamp == null) throw new Error("V1_2_CAMPAIGN_PROVENANCE_TIME_WALL")
  const claims = {
    contract: V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
    materializer: MATERIALIZER_ID,
    repository: REPOSITORY,
    parent: {
      issue: PARENT_ISSUE,
      url: `https://github.com/${REPOSITORY}/issues/${PARENT_ISSUE}`,
      goal: PARENT_GOAL,
      bodySha256: PARENT_BODY_SHA256,
    },
    userId,
    goal: {
      id: Number(goalId),
      ref: item.goalRef,
      command: item.title,
      lane: "read_model",
      mode: "implement",
      risk: "low",
      authority: "A0_READ_ONLY",
      verdict: "requires_approval",
      rationale: GOAL_RATIONALE,
      mistakePatterns: [],
      matchedRules: [],
      recommendedMove: GOAL_RECOMMENDED_MOVE,
      requiresApproval: true,
      linkedWorkOrderId: null,
      status: "classified",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    outcome: {
      key: item.outcomeKey,
      goalRef: item.goalRef,
      title: item.title,
      objective: item.objective,
      queueOrder: item.queueOrder,
      dependencyKeys: [...item.dependencyKeys],
      riskClass: "R1",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      approvalDecisionId: null,
      authorityState: "unverified",
      authorityLevel: "A0_READ_ONLY",
      authorityGrantRef: null,
      authoritySubject: "operator",
      authorityAction: "outcome:execute",
      lifecycleState: "suggested",
      lifecycleReason: LIFECYCLE_REASON,
      activeWorkOrderId: null,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      version: 0,
      acquisitionKey: null,
      terminalResult: null,
      terminalEvidenceId: null,
      terminalEvidenceRefs: [],
      terminalKey: null,
      supersedesOutcomeKey: null,
      supersededByOutcomeKey: null,
      suggestedAt: timestamp,
      activatedAt: null,
      terminalAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
  return { ...claims, contentHash: digest(claims) }
}

export function validateV12ParentIssue(issue) {
  return issue?.number === PARENT_ISSUE
    && issue?.state === "open"
    && issue?.user?.id === PARENT_AUTHOR_ID
    && issue?.user?.login === "bsvalues"
    && issue?.user?.type === "User"
    && issue?.title === "GOAL-WOS-V1.2-001 — Continuous Approved Outcome Queue"
    && issue?.html_url === `https://github.com/${REPOSITORY}/issues/${PARENT_ISSUE}`
    && digest(normalizedBody(issue?.body)) === PARENT_BODY_SHA256
}

export function buildV12ContinuousCampaignPlan({
  userId,
  firstGoalNumber,
  firstQueueOrder,
  now,
}) {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new Error("V1_2_CAMPAIGN_PRIMARY_IDENTITY_WALL")
  }
  if (!Number.isSafeInteger(firstGoalNumber) || firstGoalNumber <= 0) {
    throw new Error("V1_2_CAMPAIGN_GOAL_REF_WALL")
  }
  if (V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES.length !== 2) {
    throw new Error("V1_2_CAMPAIGN_FIXED_OUTCOME_WALL")
  }
  const lastQueueOrder = firstQueueOrder + V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES.length - 1
  if (!Number.isSafeInteger(firstQueueOrder)
    || firstQueueOrder < 0
    || lastQueueOrder >= CAMPAIGN_QUEUE_PARTITION_LIMIT) {
    throw new Error("V1_2_CAMPAIGN_QUEUE_ORDER_WALL")
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("V1_2_CAMPAIGN_TIME_WALL")
  }

  const suggestedAt = now.toISOString()
  return V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES.map((outcome, index) => ({
    ...outcome,
    dependencyKeys: [...outcome.dependencyKeys],
    goalRef: `GOAL-${String(firstGoalNumber + index).padStart(4, "0")}`,
    queueOrder: firstQueueOrder + index,
    suggestedAt,
  }))
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

export function isExactV12CampaignReplay(rows, plan, userId) {
  if (!Array.isArray(rows) || rows.length !== 2 || plan.length !== 2) return false
  return plan.every((expected) => {
    const row = rows.find((candidate) => candidate.outcomeKey === expected.outcomeKey)
    const goalId = Number(row?.goalId)
    const provenance = Number.isSafeInteger(goalId) && goalId > 0
      ? buildV12CampaignMaterializerProvenance({ userId, goalId, item: expected })
      : null
    const expectedEventMetadata = provenance == null
      ? null
      : {
          governanceEventId: Number(row?.provenanceEventId),
          outcomeKey: expected.outcomeKey,
          parentIssue: provenance.parent.url,
          provenanceContract: V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
          provenanceHash: provenance.contentHash,
        }
    return row?.userId === userId
      && Number.isSafeInteger(goalId)
      && goalId > 0
      && row.goalRef === expected.goalRef
      && row.materializedGoalRef === expected.goalRef
      && row.goalCommand === expected.title
      && row.goalLane === "read_model"
      && row.goalMode === "implement"
      && row.goalRisk === "low"
      && row.goalAuthority === "A0_READ_ONLY"
      && row.goalVerdict === "requires_approval"
      && row.goalRationale === GOAL_RATIONALE
      && sameStrings(row.goalMistakePatterns, [])
      && sameStrings(row.goalMatchedRules, [])
      && row.goalRecommendedMove === GOAL_RECOMMENDED_MOVE
      && row.goalRequiresApproval === true
      && row.goalLinkedWorkOrderId == null
      && row.goalStatus === "classified"
      && iso(row.goalCreatedAt) === expected.suggestedAt
      && iso(row.goalUpdatedAt) === expected.suggestedAt
      && row.title === expected.title
      && row.objective === expected.objective
      && Number(row.queueOrder) === expected.queueOrder
      && Number(row.queueOrder) < CAMPAIGN_QUEUE_PARTITION_LIMIT
      && sameStrings(row.dependencyKeys, expected.dependencyKeys)
      && row.riskClass === "R1"
      && row.approvalState === "unapproved"
      && row.approvedBy == null
      && row.approvedAt == null
      && row.approvalDecisionId == null
      && row.authorityState === "unverified"
      && row.authorityLevel === "A0_READ_ONLY"
      && row.authorityGrantRef == null
      && row.authoritySubject === "operator"
      && row.authorityAction === "outcome:execute"
      && row.lifecycleState === "suggested"
      && row.lifecycleReason === LIFECYCLE_REASON
      && iso(row.suggestedAt) === expected.suggestedAt
      && row.executionBinding == null
      && row.leaseHolder == null
      && row.leaseToken == null
      && row.leaseExpiresAt == null
      && Number(row.fencingToken) === 0
      && Number(row.version) === 0
      && row.acquisitionKey == null
      && row.activeWorkOrderId == null
      && row.terminalResult == null
      && row.terminalEvidenceId == null
      && sameStrings(row.terminalEvidenceRefs, [])
      && row.terminalKey == null
      && row.supersedesOutcomeKey == null
      && row.supersededByOutcomeKey == null
      && row.activatedAt == null
      && row.terminalAt == null
      && iso(row.createdAt) === expected.suggestedAt
      && iso(row.updatedAt) === expected.suggestedAt
      && Number(row.provenanceEventCount) === 1
      && Number.isSafeInteger(Number(row.provenanceEventId))
      && Number(row.provenanceEventId) > 0
      && row.provenanceEventType === "V1_2_CHILD_OUTCOME_SUGGESTED"
      && row.provenanceEntityType === "outcome_queue_item"
      && row.provenanceEntityId === expected.outcomeKey
      && row.provenanceActor === "hermes"
      && row.provenanceReason === SUGGESTION_REASON
      && row.provenanceBeforeHash == null
      && row.provenanceRef == null
      && row.provenanceAfterHash === provenance?.contentHash
      && row.provenanceEvidenceId == null
      && digest(row.provenanceMetadata) === digest(provenance)
      && iso(row.provenanceCreatedAt) === expected.suggestedAt
      && Number(row.provenanceLogCount) === 1
      && Number.isSafeInteger(Number(row.provenanceLogId))
      && Number(row.provenanceLogId) > 0
      && row.provenanceLogType === "outcome.suggested"
      && row.provenanceLogSummary === `${expected.goalRef} suggested from pinned live V1.2 parent #471; owner approval remains required.`
      && row.provenanceLogRegister === "outcome-queue"
      && Number(row.provenanceLogRefId) === goalId
      && digest(row.provenanceLogMetadata) === digest(expectedEventMetadata)
      && iso(row.provenanceLogCreatedAt) === expected.suggestedAt
  })
}

const REPLAY_SQL = `
SELECT
  q."userId", q."outcomeKey", q."goalId", q."goalRef", q.title, q.objective,
  q."queueOrder", q."dependencyKeys", q."riskClass", q."approvalState",
  q."approvedBy", q."approvedAt", q."approvalDecisionId",
  q."authorityState", q."authorityLevel", q."authorityGrantRef",
  q."authoritySubject", q."authorityAction",
  q."lifecycleState", q."lifecycleReason", q."suggestedAt",
  q."executionBinding", q."leaseHolder", q."leaseToken", q."leaseExpiresAt",
  q."fencingToken", q.version, q."acquisitionKey", q."activeWorkOrderId",
  q."terminalResult", q."terminalEvidenceId", q."terminalEvidenceRefs",
  q."terminalKey", q."supersedesOutcomeKey", q."supersededByOutcomeKey",
  q."activatedAt", q."terminalAt", q."createdAt", q."updatedAt",
  g.ref AS "materializedGoalRef", g.command AS "goalCommand", g.verdict AS "goalVerdict",
  g.lane AS "goalLane", g.mode AS "goalMode", g.risk AS "goalRisk",
  g.authority AS "goalAuthority", g.rationale AS "goalRationale",
  g."mistakePatterns" AS "goalMistakePatterns",
  g."matchedRules" AS "goalMatchedRules",
  g."recommendedMove" AS "goalRecommendedMove",
  g."requiresApproval" AS "goalRequiresApproval",
  g."linkedWorkOrderId" AS "goalLinkedWorkOrderId",
  g.status AS "goalStatus", g."createdAt" AS "goalCreatedAt",
  g."updatedAt" AS "goalUpdatedAt",
  provenance."eventCount" AS "provenanceEventCount",
  provenance.id AS "provenanceEventId",
  provenance."eventType" AS "provenanceEventType",
  provenance."entityType" AS "provenanceEntityType",
  provenance."entityId" AS "provenanceEntityId",
  provenance.actor AS "provenanceActor",
  provenance.reason AS "provenanceReason",
  provenance.ref AS "provenanceRef",
  provenance."beforeHash" AS "provenanceBeforeHash",
  provenance."afterHash" AS "provenanceAfterHash",
  provenance."evidenceId" AS "provenanceEvidenceId",
  provenance.metadata AS "provenanceMetadata",
  provenance."createdAt" AS "provenanceCreatedAt",
  provenance_log."eventCount" AS "provenanceLogCount",
  provenance_log.id AS "provenanceLogId",
  provenance_log.type AS "provenanceLogType",
  provenance_log.summary AS "provenanceLogSummary",
  provenance_log.register AS "provenanceLogRegister",
  provenance_log."refId" AS "provenanceLogRefId",
  provenance_log.metadata AS "provenanceLogMetadata",
  provenance_log."createdAt" AS "provenanceLogCreatedAt"
FROM "outcome_queue_item" q
JOIN goal g ON g.id = q."goalId" AND g."userId" = q."userId"
JOIN LATERAL (
  SELECT ge.*,
    count(*) OVER ()::integer AS "eventCount"
  FROM governance_event ge
  WHERE ge."userId" = q."userId"
    AND ge."eventType" = 'V1_2_CHILD_OUTCOME_SUGGESTED'
    AND ge."entityType" = 'outcome_queue_item'
    AND ge."entityId" = q."outcomeKey"
) provenance ON true
JOIN LATERAL (
  SELECT el.*,
    count(*) OVER ()::integer AS "eventCount"
  FROM event_log el
  WHERE el."userId" = q."userId"
    AND el.type = 'outcome.suggested'
    AND el.register = 'outcome-queue'
    AND el.metadata->>'outcomeKey' = q."outcomeKey"
    AND el.metadata->>'governanceEventId' = provenance.id::text
) provenance_log ON true
WHERE q."userId" = $1 AND q."outcomeKey" = ANY($2::text[])
ORDER BY q."queueOrder", q."outcomeKey"
`

async function fetchParentIssue(fetchImpl) {
  const token = process.env.GITHUB_TOKEN
  let response
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${REPOSITORY}/issues/${PARENT_ISSUE}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (error) {
    if (error instanceof Error
      && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("V1_2_CAMPAIGN_PARENT_TIMEOUT_WALL")
    }
    throw new Error("V1_2_CAMPAIGN_PARENT_TRANSPORT_WALL")
  }
  const rateLimited = response?.status === 429
    || (
      response?.status === 403
      && (
        response.headers?.get?.("x-ratelimit-remaining") === "0"
        || response.headers?.has?.("retry-after") === true
      )
    )
  if (rateLimited) {
    throw new Error("V1_2_CAMPAIGN_PARENT_RATE_LIMIT_WALL")
  }
  if (!response?.ok) throw new Error("V1_2_CAMPAIGN_PARENT_READ_WALL")
  let issue
  try {
    issue = await response.json()
  } catch (error) {
    if (error instanceof Error
      && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error("V1_2_CAMPAIGN_PARENT_TIMEOUT_WALL")
    }
    throw new Error("V1_2_CAMPAIGN_PARENT_READ_WALL")
  }
  if (!validateV12ParentIssue(issue)) {
    throw new Error("V1_2_CAMPAIGN_PARENT_AUTHORITY_WALL")
  }
  return issue
}

export async function materializeV12ContinuousCampaign({
  databaseUrl = process.env.DATABASE_URL,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  createPool,
  pool: injectedPool,
  ensureSchema = ensureOutcomeQueueHardeningSchema,
} = {}) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL_REQUIRED")
  }
  if (typeof fetchImpl !== "function") throw new Error("V1_2_CAMPAIGN_FETCH_WALL")
  if (typeof ensureSchema !== "function") throw new Error("V1_2_CAMPAIGN_SCHEMA_WALL")

  const issue = await fetchParentIssue(fetchImpl)
  await ensureSchema({ databaseUrl })

  let pool = injectedPool
  let ownsPool = false
  if (!pool) {
    const { Pool } = createPool ? { Pool: createPool } : await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
    ownsPool = true
  }
  if (typeof pool?.connect !== "function") throw new Error("V1_2_CAMPAIGN_POOL_WALL")

  let client
  try {
    client = await pool.connect()
  } catch (error) {
    if (ownsPool) await pool.end()
    throw error
  }
  const query = (sql, params = []) => {
    assertV12CampaignSuggestionOnlySql(sql)
    return client.query(sql, params)
  }
  try {
    await query("BEGIN")
    const primary = await query(
      `SELECT id FROM "user" WHERE lower(email) = lower($1) ORDER BY id LIMIT 2`,
      [PRIMARY_EMAIL],
    )
    if (primary.rows.length !== 1) throw new Error("V1_2_CAMPAIGN_PRIMARY_IDENTITY_WALL")
    const userId = primary.rows[0].id
    for (const lock of [
      `${userId}:authority-grant-allocation`,
      `${userId}:goal-outcome-intake`,
      `${userId}:outcome-queue`,
      `${userId}:v1-2-continuous-campaign`,
    ]) {
      await query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lock])
    }

    const existing = await query(
      REPLAY_SQL,
      [userId, V1_2_CONTINUOUS_CAMPAIGN_OUTCOMES.map((outcome) => outcome.outcomeKey)],
    )
    if (existing.rows.length > 0) {
      const firstGoalNumber = Number(
        existing.rows
          .map((row) => String(row.goalRef).match(/^GOAL-(\d+)$/)?.[1])
          .filter(Boolean)
          .sort((left, right) => Number(left) - Number(right))[0],
      )
      const firstQueueOrder = Math.min(...existing.rows.map((row) => Number(row.queueOrder)))
      const replayPlan = buildV12ContinuousCampaignPlan({
        userId,
        firstGoalNumber,
        firstQueueOrder,
        now: new Date(existing.rows[0].suggestedAt ?? now),
      })
      if (!isExactV12CampaignReplay(existing.rows, replayPlan, userId)) {
        throw new Error("V1_2_CAMPAIGN_REPLAY_WALL")
      }
      await query("COMMIT")
      return {
        status: "REPLAYED",
        parentIssue: issue.html_url,
        outcomes: replayPlan.map(({ outcomeKey, goalRef, queueOrder }) => ({
          outcomeKey,
          goalRef,
          queueOrder,
        })),
      }
    }

    const goalNumberResult = await query(
      `SELECT COALESCE(max((regexp_match(ref, '^GOAL-([0-9]+)$'))[1]::integer), 0)::integer AS value
       FROM goal WHERE "userId" = $1`,
      [userId],
    )
    const queueOrderResult = await query(
      `SELECT COALESCE(max("queueOrder"), -1)::integer AS value
       FROM "outcome_queue_item"
       WHERE "userId" = $1 AND "queueOrder" < $2`,
      [userId, CAMPAIGN_QUEUE_PARTITION_LIMIT],
    )
    const plan = buildV12ContinuousCampaignPlan({
      userId,
      firstGoalNumber: Number(goalNumberResult.rows[0].value) + 1,
      firstQueueOrder: Number(queueOrderResult.rows[0].value) + 1,
      now,
    })
    const allocationCollision = await query(
      `SELECT
         (SELECT count(*)::integer FROM goal
           WHERE "userId" = $1 AND ref = ANY($2::text[])) AS goals,
         (SELECT count(*)::integer FROM "outcome_queue_item"
           WHERE "userId" = $1 AND "queueOrder" = ANY($3::integer[])) AS queue_rows,
         (SELECT count(*)::integer FROM "outcome_queue_item"
           WHERE "userId" = $1 AND "outcomeKey" = ANY($4::text[])) AS outcome_rows`,
      [
        userId,
        plan.map((item) => item.goalRef),
        plan.map((item) => item.queueOrder),
        plan.map((item) => item.outcomeKey),
      ],
    )
    if (Number(allocationCollision.rows[0]?.goals) !== 0
      || Number(allocationCollision.rows[0]?.queue_rows) !== 0
      || Number(allocationCollision.rows[0]?.outcome_rows) !== 0) {
      throw new Error("V1_2_CAMPAIGN_ALLOCATION_COLLISION_WALL")
    }

    for (const item of plan) {
      const goalResult = await query(
        `INSERT INTO goal (
           "userId", ref, command, lane, mode, risk, authority, verdict,
           rationale, "mistakePatterns", "matchedRules", "recommendedMove",
           "requiresApproval", status, "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'read_model', 'implement', 'low', 'A0_READ_ONLY',
           'requires_approval', $4, '{}', '{}', $5, true, 'classified', $6, $6
         ) RETURNING id`,
        [
          userId,
          item.goalRef,
          item.title,
          GOAL_RATIONALE,
          GOAL_RECOMMENDED_MOVE,
          now,
        ],
      )
      const goalId = Number(goalResult.rows[0].id)
      await query(
        `INSERT INTO "outcome_queue_item" (
           "userId", "outcomeKey", "goalId", "goalRef", title, objective,
           "queueOrder", "dependencyKeys", "riskClass", "approvalState",
           "approvedBy", "approvedAt", "approvalDecisionId", "authorityState",
           "authorityLevel", "authorityGrantRef", "authoritySubject",
           "authorityAction", "lifecycleState", "lifecycleReason",
           "activeWorkOrderId", "executionBinding", "leaseHolder", "leaseToken",
           "leaseExpiresAt", "fencingToken", version, "acquisitionKey",
           "terminalResult", "terminalEvidenceId", "terminalEvidenceRefs",
           "terminalKey", "supersedesOutcomeKey", "supersededByOutcomeKey",
           "suggestedAt", "activatedAt", "terminalAt", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'R1', 'unapproved',
           NULL, NULL, NULL, 'unverified', 'A0_READ_ONLY', NULL, 'operator',
           'outcome:execute', 'suggested', $9,
           NULL, NULL, NULL, NULL, NULL, 0, 0, NULL,
           NULL, NULL, '{}', NULL, NULL, NULL,
           $10, NULL, NULL, $10, $10
         )`,
        [
          userId,
          item.outcomeKey,
          goalId,
          item.goalRef,
          item.title,
           item.objective,
           item.queueOrder,
           item.dependencyKeys,
           LIFECYCLE_REASON,
           now,
         ],
       )
      const provenance = buildV12CampaignMaterializerProvenance({
        userId,
        goalId,
        item,
      })
      const governance = await query(
        `INSERT INTO governance_event (
           "userId", "eventType", "entityType", "entityId", actor, reason,
           "afterHash", metadata, "createdAt"
         ) VALUES (
           $1, 'V1_2_CHILD_OUTCOME_SUGGESTED', 'outcome_queue_item', $2,
           'hermes', $3, $4, $5::jsonb, $6
         ) RETURNING id`,
        [
           userId,
           item.outcomeKey,
           SUGGESTION_REASON,
           provenance.contentHash,
           JSON.stringify(provenance),
           now,
         ],
       )
      await query(
        `INSERT INTO event_log (
           "userId", type, summary, register, "refId", metadata, "createdAt"
         ) VALUES (
           $1, 'outcome.suggested', $2, 'outcome-queue', $3, $4::jsonb, $5
         )`,
        [
          userId,
          `${item.goalRef} suggested from pinned live V1.2 parent #471; owner approval remains required.`,
          goalId,
          JSON.stringify({
             governanceEventId: Number(governance.rows[0].id),
             outcomeKey: item.outcomeKey,
             parentIssue: issue.html_url,
             provenanceContract: V1_2_CAMPAIGN_MATERIALIZER_PROVENANCE_CONTRACT,
             provenanceHash: provenance.contentHash,
           }),
          now,
        ],
      )
    }

    const created = await query(
      REPLAY_SQL,
      [userId, plan.map((outcome) => outcome.outcomeKey)],
    )
    if (!isExactV12CampaignReplay(created.rows, plan, userId)) {
      throw new Error("V1_2_CAMPAIGN_ATOMICITY_WALL")
    }
    await query("COMMIT")
    return {
      status: "CREATED",
      parentIssue: issue.html_url,
      outcomes: plan.map(({ outcomeKey, goalRef, queueOrder }) => ({
        outcomeKey,
        goalRef,
        queueOrder,
      })),
    }
  } catch (error) {
    await query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    client.release()
    if (ownsPool) await pool.end()
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  materializeV12ContinuousCampaign()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.message ?? "V1_2_CAMPAIGN_MATERIALIZATION_WALL"}\n`)
      process.exitCode = 1
    })
}
