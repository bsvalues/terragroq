import path from "node:path"

import { pool } from "@/lib/db"
import { validateWorkingWorld } from "@/lib/environment/working-world"
import { authorityGrantFactsFromRow, grantCovers, isGrantActive } from "@/lib/governance/authority"
import { hashRecord } from "@/lib/governance/hash"
import type {
  CodexContinuationDependencies,
  CodexContinuationRecord,
} from "@/lib/loom/codex-continuation"
import { deriveCodexPathEvidence } from "@/lib/loom/codex-continuation"
import { codexContinuationEvidenceEvent } from "@/lib/loom/codex-continuation"
import { inspectCodexAssignmentTarget } from "@/lib/loom/codex-assignment"

type BindingRow = Record<string, unknown>
const PROJECT_ROOT = path.resolve(process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd())

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function authorityVersion(row: BindingRow): string {
  return hashRecord({
    outcome: {
      id: Number(row.outcomeId),
      key: String(row.outcomeKey),
      version: Number(row.outcomeVersion),
      activeWorkOrderId: Number(row.activeWorkOrderId),
    },
    workOrder: {
      id: Number(row.workOrderId),
      status: String(row.workOrderStatus),
      authorityLevel: String(row.workOrderAuthorityLevel),
      authorityGrantId: Number(row.authorityGrantId),
      agent: String(row.workOrderAgent),
      allowed: strings(row.allowedFiles),
      forbidden: strings(row.forbiddenFiles),
      acceptanceCriteria: strings(row.acceptanceCriteria),
      validators: strings(row.validators),
      updatedAt: row.workOrderUpdatedAt instanceof Date
        ? row.workOrderUpdatedAt.toISOString()
        : String(row.workOrderUpdatedAt),
    },
    grant: {
      id: Number(row.grantId),
      ref: row.grantRef == null ? null : String(row.grantRef),
      status: String(row.grantStatus),
      authorityLevel: String(row.grantAuthorityLevel),
      workOrderId: Number(row.grantWorkOrderId),
      grantedTo: String(row.grantedTo),
      allowed: strings(row.grantAllowedActions),
      blocked: strings(row.grantBlockedActions),
      contentHash: row.grantContentHash == null ? null : String(row.grantContentHash),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
      revokedAt: row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt,
    },
  })
}

function validBinding(userId: string, worldId: string, row: BindingRow): boolean {
  const world = validateWorkingWorld(typeof row.worldSnapshot === "string"
    ? JSON.parse(row.worldSnapshot)
    : row.worldSnapshot)
  const allowed = strings(row.allowedFiles)
  const forbidden = strings(row.forbiddenFiles)
  const grantAllowed = strings(row.grantAllowedActions)
  const grantBlocked = strings(row.grantBlockedActions)
  const grantFacts = authorityGrantFactsFromRow({
    id: row.grantId,
    ref: row.grantRef,
    status: row.grantStatus,
    authorityLevel: row.grantAuthorityLevel,
    allowedActions: grantAllowed,
    blockedActions: grantBlocked,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason,
    userId: row.grantUserId,
    grantedTo: row.grantedTo,
  })
  return String(row.worldId) === worldId
    && world.spine.outcomeKey === String(row.outcomeKey)
    && world.spine.workOrderId === Number(row.workOrderId)
    && String(row.outcomeState) === "active"
    && Number(row.activeWorkOrderId) === Number(row.workOrderId)
    && String(row.workOrderStatus) === "active"
    && String(row.workOrderAgent).toLowerCase() === "codex"
    && Number(row.authorityGrantId) === Number(row.grantId)
    && String(row.grantUserId) === userId
    && Number(row.grantWorkOrderId) === Number(row.workOrderId)
    && String(row.grantedTo).toLowerCase() === "codex"
    && allowed.length > 0
    && sameStrings(allowed, grantAllowed)
    && sameStrings(forbidden, grantBlocked)
    && isGrantActive(grantFacts).ok
    && grantCovers(grantFacts, "A2_WRITE_OWN").ok
}

const BINDING_SQL = `SELECT
  world."id" AS "worldId", world."snapshot" AS "worldSnapshot",
  outcome."id" AS "outcomeId", outcome."outcomeKey", outcome."lifecycleState" AS "outcomeState",
  outcome."activeWorkOrderId", outcome."version" AS "outcomeVersion",
  work."id" AS "workOrderId", work."title" AS "workOrderTitle",
  work."description" AS "workOrderObjective", work."status" AS "workOrderStatus",
  work."authorityLevel" AS "workOrderAuthorityLevel", work."authorityGrantId",
  work."agent" AS "workOrderAgent", work."allowedFiles", work."forbiddenFiles",
  work."acceptanceCriteria", work."validators", work."updatedAt" AS "workOrderUpdatedAt",
  grant_row."id" AS "grantId", grant_row."ref" AS "grantRef",
  grant_row."userId" AS "grantUserId", grant_row."workOrderId" AS "grantWorkOrderId",
  grant_row."grantedTo", grant_row."status" AS "grantStatus",
  grant_row."authorityLevel" AS "grantAuthorityLevel",
  grant_row."allowedActions" AS "grantAllowedActions",
  grant_row."blockedActions" AS "grantBlockedActions",
  grant_row."expiresAt", grant_row."revokedAt", grant_row."revokeReason",
  grant_row."contentHash" AS "grantContentHash"
FROM "working_world" world
JOIN "outcome_queue_item" outcome
  ON outcome."userId" = world."userId"
  AND outcome."outcomeKey" = (world."snapshot"::jsonb #>> '{spine,outcomeKey}')
JOIN "work_order" work
  ON work."userId" = outcome."userId" AND work."id" = outcome."activeWorkOrderId"
JOIN "authority_grant" grant_row
  ON grant_row."userId" = work."userId" AND grant_row."id" = work."authorityGrantId"
WHERE world."userId" = $1 AND world."id" = $2`

async function load(userId: string, worldId: string): Promise<CodexContinuationRecord | null> {
  const bindingResult = await pool.query(BINDING_SQL, [userId, worldId])
  const row = bindingResult.rows[0] as BindingRow | undefined
  if (!row || bindingResult.rows.length !== 1 || !validBinding(userId, worldId, row)) return null
  const eventResult = await pool.query(
    `WITH scoped AS (
      SELECT "id", "eventType", "entityType", "entityId", "metadata", "createdAt"
      FROM "governance_event"
      WHERE "userId" = $1
        AND "entityType" IN ('loom_codex_assignment', 'loom_codex_ready')
        AND "metadata"::jsonb ->> 'worldId' = $2
        AND CASE WHEN "entityType" = 'loom_codex_assignment'
          THEN "metadata"::jsonb #>> '{outcome,key}' = $3
            AND ("metadata"::jsonb #>> '{workOrder,id}')::integer = $4
            AND ("metadata"::jsonb #>> '{grant,id}')::integer = $5
          ELSE "metadata"::jsonb ->> 'outcomeKey' = $3
            AND ("metadata"::jsonb ->> 'workOrderId')::integer = $4
            AND ("metadata"::jsonb ->> 'grantId')::integer = $5
        END
    ), terminal AS (
      SELECT event."id", event."eventType", event."entityType", event."entityId", event."metadata", event."createdAt"
      FROM "governance_event" event
      WHERE event."userId" = $1
        AND event."eventType" = 'LOOP_STOPPED'
        AND event."entityType" = 'loom_agent'
        AND event."entityId" IN (
          SELECT "entityId" FROM scoped WHERE "entityType" = 'loom_codex_assignment'
        )
    )
    SELECT * FROM scoped
    UNION ALL
    SELECT * FROM terminal
    ORDER BY "id" ASC`,
    [userId, worldId, String(row.outcomeKey), Number(row.workOrderId), Number(row.grantId)],
  )
  const evidenceEvents = (eventResult.rows as ReadonlyArray<Record<string, unknown>>)
    .map(codexContinuationEvidenceEvent)
  const { assignedPaths, completedPaths } = deriveCodexPathEvidence(evidenceEvents)
  const snapshot = typeof row.worldSnapshot === "string" ? row.worldSnapshot : JSON.stringify(row.worldSnapshot)
  return {
    snapshot,
    authorityVersion: authorityVersion(row),
    world: validateWorkingWorld(JSON.parse(snapshot)),
    outcomeKey: String(row.outcomeKey),
    workOrderId: Number(row.workOrderId),
    grantId: Number(row.grantId),
    title: String(row.workOrderTitle),
    objective: String(row.workOrderObjective),
    acceptanceCriteria: strings(row.acceptanceCriteria),
    validators: strings(row.validators),
    allowedPaths: strings(row.allowedFiles),
    completedPaths,
    assignedPaths,
  }
}

async function persist(input: Parameters<CodexContinuationDependencies["persist"]>[0]): Promise<"PERSISTED" | "STALE"> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const locked = await client.query(`${BINDING_SQL} FOR UPDATE OF world, outcome, work, grant_row`, [input.userId, input.worldId])
    const row = locked.rows[0] as BindingRow | undefined
    if (!row || locked.rows.length !== 1
      || String(row.worldSnapshot) !== input.expectedSnapshot
      || String(row.outcomeKey) !== input.outcomeKey
      || Number(row.workOrderId) !== input.workOrderId
      || Number(row.grantId) !== input.grantId
      || !validBinding(input.userId, input.worldId, row)
      || authorityVersion(row) !== input.authorityVersion) {
      await client.query("ROLLBACK")
      return "STALE"
    }
    const updated = await client.query(
      `UPDATE "working_world"
        SET "snapshot" = $3, "updatedAt" = clock_timestamp()
        WHERE "userId" = $1 AND "id" = $2 AND "snapshot" = $4
        RETURNING "id"`,
      [input.userId, input.worldId, input.nextSnapshot, input.expectedSnapshot],
    )
    if (updated.rows.length !== 1) {
      await client.query("ROLLBACK")
      return "STALE"
    }
    await client.query("COMMIT")
    return "PERSISTED"
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* preserve original */ }
    throw error
  } finally {
    client.release()
  }
}

async function inspectTarget(selectedPath: string): Promise<boolean> {
  try {
    await inspectCodexAssignmentTarget(PROJECT_ROOT, selectedPath)
    return true
  } catch {
    return false
  }
}

export const codexContinuationDependencies: CodexContinuationDependencies = { load, inspectTarget, persist }

/** Hold one process-crash-safe database-session claim for an automatic Space dispatch. */
export async function acquireCodexContinuationClaim(
  userId: string,
  worldId: string,
): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect()
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired",
      [`williamos-continuation:${userId}`, worldId],
    )
    if (result.rows[0]?.acquired !== true) {
      client.release()
      return null
    }
    let released = false
    return async () => {
      if (released) return
      released = true
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))",
          [`williamos-continuation:${userId}`, worldId],
        )
        client.release()
      } catch (error) {
        client.release(error instanceof Error ? error : new Error("CODEX_CONTINUATION_UNLOCK_FAILED"))
        throw error
      }
    }
  } catch (error) {
    client.release()
    throw error
  }
}
