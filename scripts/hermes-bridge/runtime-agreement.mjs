import fs from "node:fs"
import path from "node:path"

import { readHermesState } from "./state-store.mjs"

const DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"
const ACTIVE_QUEUE_SQL = `
SELECT
  q."goalId" AS "outcomeId",
  q."lifecycleState" AS "queueStatus",
  q."activeWorkOrderId" AS "activeWorkOrderId",
  projected_work.id AS "workOrderId",
  projected_work.ref AS "workOrderRef",
  projected_work.status AS "workOrderStatus"
FROM "outcome_queue_item" AS q
LEFT JOIN work_order AS projected_work
  ON projected_work.id = q."activeWorkOrderId"
  AND projected_work."userId" = q."userId"
WHERE q."userId" = $1
  AND q."lifecycleState" = 'active'
ORDER BY q."queueOrder" ASC, q."createdAt" ASC, q."outcomeKey" ASC
LIMIT 2
`
const ELIGIBLE_QUEUE_SQL = `
SELECT q."goalId" AS "outcomeId"
FROM "outcome_queue_item" AS q
WHERE q."userId" = $1
  AND q."lifecycleState" = 'approved'
  AND q."approvalState" = 'approved'
  AND q."authorityState" = 'matched'
  AND q."riskClass" IN ('R0', 'R1')
  AND EXISTS (
    SELECT 1
    FROM "decision" AS live_approval
    WHERE live_approval."id" = q."approvalDecisionId"
      AND live_approval."userId" = q."userId"
      AND live_approval."status" = 'accepted'
      AND live_approval."authority" = 'binding'
      AND live_approval."scope" IN (q."outcomeKey", q."goalRef")
  )
  AND EXISTS (
    SELECT 1
    FROM "authority_grant" AS live_grant
    WHERE live_grant."userId" = q."userId"
      AND live_grant."ref" = q."authorityGrantRef"
      AND live_grant."status" = 'active'
      AND live_grant."revokedAt" IS NULL
      AND (
        live_grant."expiresAt" IS NULL
        OR live_grant."expiresAt" AT TIME ZONE 'UTC' > $2::timestamptz
      )
      AND live_grant."authorityLevel" = q."authorityLevel"
      AND live_grant."grantedTo" = q."authoritySubject"
      AND live_grant."scope" IN (q."outcomeKey", q."goalRef")
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
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(q."dependencyKeys") AS dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" AS completed_dependency
      ON completed_dependency."userId" = q."userId"
      AND completed_dependency."outcomeKey" = dependency."outcomeKey"
    WHERE completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'
  )
ORDER BY q."queueOrder" ASC, q."createdAt" ASC, q."outcomeKey" ASC
LIMIT 1
`

function wall(code, message = code) {
  throw Object.assign(new Error(message), { code })
}

function positiveInteger(value, code) {
  const converted = Number(value)
  if (!Number.isSafeInteger(converted) || converted < 1) wall(code)
  return converted
}

function activeLocalExecutions(state) {
  return Object.values(state.executions).filter((execution) => {
    const binding = execution?.metadata?.outcome?.queueBinding
    return binding && typeof binding === "object"
      && ["ACTIVE", "DEFERRED"].includes(execution?.lease?.status)
  })
}

function stableLocalState(before, after) {
  return before.revision === after.revision && before.updatedAt === after.updatedAt
}

function buildAgreement(queueRows, eligibleRows, localState, observedAt, primaryUserId) {
  const localExecutions = activeLocalExecutions(localState)
  if (queueRows.length === 0 && localExecutions.length === 0) {
    if (eligibleRows.length !== 0) wall("QUEUE_RUNTIME_AGREEMENT_ELIGIBLE_WORK_WALL")
    return Object.freeze({
      schemaVersion: 1,
      observedAt,
      mode: "HEALTHY_IDLE",
      queue: null,
      local: null,
      workOrder: null,
    })
  }
  if (queueRows.length !== 1 || localExecutions.length !== 1) {
    wall("QUEUE_RUNTIME_AGREEMENT_CARDINALITY_WALL")
  }

  const row = queueRows[0]
  const execution = localExecutions[0]
  const outcomeId = positiveInteger(row.outcomeId, "QUEUE_RUNTIME_AGREEMENT_OUTCOME_WALL")
  const activeWorkOrderId = positiveInteger(
    row.activeWorkOrderId,
    "QUEUE_RUNTIME_AGREEMENT_WORK_ORDER_WALL",
  )
  const workOrderId = positiveInteger(row.workOrderId, "QUEUE_RUNTIME_AGREEMENT_WORK_ORDER_WALL")
  const binding = execution.metadata.outcome.queueBinding
  const canonicalRef = `WO-HERMES-OUTCOME-${outcomeId}`
  if (row.queueStatus !== "active"
    || activeWorkOrderId !== workOrderId
    || String(row.workOrderRef) !== canonicalRef
    || String(execution.outcomeId) !== String(outcomeId)
    || String(binding.userId) !== String(primaryUserId)
    || Number(binding.activeWorkOrderId) !== activeWorkOrderId) {
    wall("QUEUE_RUNTIME_AGREEMENT_MISMATCH")
  }
  const workOrderStatus = String(row.workOrderStatus ?? "").toUpperCase()
  if (!["ACTIVE", "IN_PROGRESS", "REVIEW"].includes(workOrderStatus)) {
    wall("QUEUE_RUNTIME_AGREEMENT_WORK_ORDER_STATUS_WALL")
  }

  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    mode: "ACTIVE",
    queue: Object.freeze({
      outcomeId,
      status: "active",
      workOrderRef: canonicalRef,
    }),
    local: Object.freeze({
      outcomeId,
      leaseStatus: execution.lease.status,
      checkpointState: String(execution.checkpoint?.state ?? ""),
      workOrderRef: canonicalRef,
    }),
    workOrder: Object.freeze({
      ref: canonicalRef,
      status: workOrderStatus,
    }),
  })
}

async function openConnection({ databaseUrl, query, createPool }) {
  if (typeof query === "function") {
    return { query, close: async () => {} }
  }
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    wall("DATABASE_URL_REQUIRED")
  }
  const pool = createPool
    ? await createPool(databaseUrl)
    : new (await import("pg")).Pool({
        connectionString: databaseUrl,
        allowExitOnIdle: true,
      })
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
    wall("QUEUE_RUNTIME_AGREEMENT_POOL_WALL")
  }
  const client = await pool.connect()
  return {
    query: client.query.bind(client),
    close: async () => {
      client.release()
      await pool.end()
    },
  }
}

export function writeRuntimeAgreementAtomic(filePath, snapshot) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    fs.renameSync(temporary, filePath)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

export async function produceRuntimeAgreement({
  statePath,
  outputPath = null,
  databaseUrl = process.env.DATABASE_URL,
  query,
  createPool,
  now = () => Date.now(),
} = {}) {
  if (typeof statePath !== "string" || !path.isAbsolute(statePath)) {
    wall("QUEUE_RUNTIME_AGREEMENT_STATE_PATH_WALL")
  }
  const localBefore = readHermesState(statePath)
  const connection = await openConnection({ databaseUrl, query, createPool })
  let committed = false
  try {
    await connection.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    const primary = await connection.query(
      `SELECT id
       FROM "user"
       WHERE lower(email) = lower($1)
       ORDER BY id
       LIMIT 2`,
      [DECLARED_PRIMARY_EMAIL],
    )
    if (primary.rows.length !== 1) wall("QUEUE_RUNTIME_AGREEMENT_PRIMARY_WALL")
    const active = await connection.query(ACTIVE_QUEUE_SQL, [primary.rows[0].id])
    const observedAt = new Date(now()).toISOString()
    const eligible = await connection.query(
      ELIGIBLE_QUEUE_SQL,
      [primary.rows[0].id, observedAt],
    )
    const localAfter = readHermesState(statePath)
    if (!stableLocalState(localBefore, localAfter)) {
      wall("QUEUE_RUNTIME_AGREEMENT_CONCURRENT_MUTATION_WALL")
    }
    const snapshot = buildAgreement(
      active.rows ?? [],
      eligible.rows ?? [],
      localAfter,
      observedAt,
      primary.rows[0].id,
    )
    await connection.query("COMMIT")
    committed = true
    if (outputPath !== null) writeRuntimeAgreementAtomic(outputPath, snapshot)
    return snapshot
  } catch (error) {
    if (!committed) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary read or validation error.
      }
    }
    throw error
  } finally {
    await connection.close()
  }
}

export const RUNTIME_AGREEMENT_SQL = Object.freeze({
  active: ACTIVE_QUEUE_SQL,
  eligible: ELIGIBLE_QUEUE_SQL,
})
