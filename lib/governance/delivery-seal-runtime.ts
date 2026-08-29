import { pool } from "@/lib/db"
import {
  DeliverySealError,
  deliverySigningKeyFromBase64,
  issueLoomCodexDeliverySeal,
  type WilliamOSDeliverySeal,
} from "@/lib/governance/delivery-seal"
import { inspectGitDelivery } from "@/lib/governance/git-delivery"
import { deriveCodexAssignment } from "@/lib/loom/codex-assignment"

export { inspectGitDelivery } from "@/lib/governance/git-delivery"

type SealFenceClient = Readonly<{
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}>

type SealFenceDependencies = Readonly<{
  connect(): Promise<SealFenceClient>
}>

async function loadEvent(userId: string, threadId: string, assignmentHash: string, entityType: string) {
  const result = await pool.query(
    `SELECT "id", "metadata" FROM "governance_event"
      WHERE "userId" = $1 AND "entityType" = $2 AND "entityId" = $3
        AND "metadata"->>'assignmentHash' = $4
      ORDER BY "createdAt" DESC LIMIT 1`,
    [userId, entityType, threadId, assignmentHash],
  )
  const row = result.rows[0] as { id?: unknown; metadata?: unknown } | undefined
  return row && Number.isSafeInteger(Number(row.id)) ? { eventId: Number(row.id), metadata: row.metadata } : null
}

function normalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeliverySealError("DELIVERY_SEAL_ASSIGNMENT_STALE", "the locked assignment evidence is malformed")
  }
  return value as Record<string, unknown>
}

function exactLockedAuthority(
  assignmentMetadata: unknown,
  readyMetadata: unknown,
  locked: Record<string, unknown>,
  seal: WilliamOSDeliverySeal,
  threadId: string,
): boolean {
  const assignment = metadataObject(assignmentMetadata)
  const ready = metadataObject(readyMetadata)
  const outcome = metadataObject(assignment.outcome)
  const workOrder = metadataObject(assignment.workOrder)
  const grant = metadataObject(assignment.grant)
  const reservation = metadataObject(assignment.reservation)
  const task = metadataObject(assignment.task)
  const allowed = Array.isArray(reservation.allowed) ? reservation.allowed.filter((item): item is string => typeof item === "string") : []
  const forbidden = Array.isArray(reservation.forbidden) ? reservation.forbidden.filter((item): item is string => typeof item === "string") : []
  const signed = seal.payload.assignment
  const currentAllowed = Array.isArray(locked.currentAllowed) ? locked.currentAllowed.filter((item): item is string => typeof item === "string") : []
  const currentForbidden = Array.isArray(locked.currentForbidden) ? locked.currentForbidden.filter((item): item is string => typeof item === "string") : []
  const currentGrantAllowed = Array.isArray(locked.currentGrantAllowed) ? locked.currentGrantAllowed.filter((item): item is string => typeof item === "string") : []
  const currentGrantBlocked = Array.isArray(locked.currentGrantBlocked) ? locked.currentGrantBlocked.filter((item): item is string => typeof item === "string") : []
  const rawWorld = typeof locked.currentWorldSnapshot === "string" ? JSON.parse(locked.currentWorldSnapshot) : locked.currentWorldSnapshot
  const world = metadataObject(rawWorld)
  const space = metadataObject(world.space)
  const spine = metadataObject(world.spine)
  const panes = Array.isArray(space.panes) ? space.panes.filter((pane): pane is Record<string, unknown> => Boolean(pane && typeof pane === "object" && !Array.isArray(pane))) : []
  const selectedPane = panes.find((pane) => pane.id === space.activePaneId)
  const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? "")
  const currentGrantVersion = locked.currentGrantContentHash == null
    ? iso(locked.currentGrantCreatedAt)
    : String(locked.currentGrantContentHash)
  return assignment.assignmentVersion === "loom-codex-assignment.v1"
    && assignment.owner === signed.owner && assignment.threadId === threadId
    && assignment.worldId === signed.worldId && assignment.spaceRevision === signed.spaceRevision
    && assignment.assignmentHash === signed.assignmentHash
    && outcome.id === signed.outcome.id && outcome.key === signed.outcome.key && outcome.version === signed.outcome.version
    && workOrder.id === signed.workOrder.id && workOrder.ref === signed.workOrder.ref && workOrder.version === signed.workOrder.version
    && grant.id === signed.grant.id && grant.ref === signed.grant.ref && grant.version === signed.grant.version
    && reservation.version === signed.reservation.version
    && sameValues(allowed, signed.reservation.allowed) && sameValues(forbidden, signed.reservation.forbidden)
    && task.digest === signed.task.digest && task.text === signed.task.text
    && assignment.executionBindingHash === signed.session.executionBindingHash
    && assignment.promotionPath === seal.payload.delivery.paths[0] && seal.payload.delivery.paths.length === 1
    && ready.assignmentHash === signed.assignmentHash && ready.committed === true
    && ready.selectedPath === assignment.promotionPath && ready.taskDigest === task.digest
    && ready.executionBindingHash === assignment.executionBindingHash
    && ready.promotionDigest === seal.payload.delivery.contentDigest
    && ready.baseSha === seal.payload.delivery.baseSha
    && spine.outcomeKey === signed.outcome.key && spine.workOrderId === signed.workOrder.id
    && space.revision === signed.spaceRevision && selectedPane?.filePath === assignment.promotionPath
    && locked.currentOutcomeId === signed.outcome.id && locked.currentOutcomeKey === signed.outcome.key
    && locked.currentOutcomeVersion === signed.outcome.version && locked.currentOutcomeState === "active"
    && locked.currentActiveWorkOrderId === signed.workOrder.id
    && locked.currentWorkOrderId === signed.workOrder.id && locked.currentWorkOrderRef === signed.workOrder.ref
    && locked.currentWorkOrderStatus === "active" && iso(locked.currentWorkOrderUpdatedAt) === signed.workOrder.version
    && locked.currentWorkOrderGrantId === signed.grant.id && String(locked.currentWorkOrderAgent).toLowerCase() === "codex"
    && locked.currentGrantId === signed.grant.id && locked.currentGrantRef === signed.grant.ref
    && locked.currentGrantWorkOrderId === signed.workOrder.id && String(locked.currentGrantTo).trim().toLowerCase() === "codex"
    && locked.currentGrantStatus === "active" && locked.currentGrantRevokedAt == null
    && currentGrantVersion === signed.grant.version
    && sameValues(currentAllowed, signed.reservation.allowed) && sameValues(currentForbidden, signed.reservation.forbidden)
    && sameValues(currentGrantAllowed, signed.reservation.allowed) && sameValues(currentGrantBlocked, signed.reservation.forbidden)
}

/** Final authority fence: lock the exact assignment spine, revalidate, and insert the seal atomically. */
export async function recordDeliverySealWithAuthorityFence(
  input: Readonly<{
    userId: string
    threadId: string
    assignmentEventId: number
    readyEventId: number
    seal: WilliamOSDeliverySeal
  }>,
  dependencies: SealFenceDependencies = {
    connect: () => pool.connect() as unknown as Promise<SealFenceClient>,
  },
): Promise<void> {
  const client = await dependencies.connect()
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
    const locked = await client.query(
      `SELECT assignment_event."metadata" AS "assignmentMetadata",
          ready_event."metadata" AS "readyMetadata", world."snapshot" AS "currentWorldSnapshot",
          outcome."id" AS "currentOutcomeId", outcome."outcomeKey" AS "currentOutcomeKey",
          outcome."version" AS "currentOutcomeVersion", outcome."lifecycleState" AS "currentOutcomeState",
          outcome."activeWorkOrderId" AS "currentActiveWorkOrderId",
          work."id" AS "currentWorkOrderId", work."ref" AS "currentWorkOrderRef",
          work."status" AS "currentWorkOrderStatus", work."updatedAt" AS "currentWorkOrderUpdatedAt",
          work."authorityGrantId" AS "currentWorkOrderGrantId", work."agent" AS "currentWorkOrderAgent",
          work."allowedFiles" AS "currentAllowed", work."forbiddenFiles" AS "currentForbidden",
          authority_row."id" AS "currentGrantId", authority_row."ref" AS "currentGrantRef",
          authority_row."workOrderId" AS "currentGrantWorkOrderId", authority_row."grantedTo" AS "currentGrantTo",
          authority_row."status" AS "currentGrantStatus", authority_row."revokedAt" AS "currentGrantRevokedAt",
          authority_row."contentHash" AS "currentGrantContentHash", authority_row."createdAt" AS "currentGrantCreatedAt",
          authority_row."allowedActions" AS "currentGrantAllowed", authority_row."blockedActions" AS "currentGrantBlocked"
        FROM "governance_event" assignment_event
        JOIN "governance_event" ready_event
          ON ready_event."id" = $4 AND ready_event."userId" = $1
          AND ready_event."entityType" = 'loom_codex_ready' AND ready_event."entityId" = $2
        JOIN "working_world" world
          ON world."userId" = $1 AND world."id" = assignment_event."metadata"->>'worldId'
        JOIN "outcome_queue_item" outcome
          ON outcome."userId" = $1 AND outcome."id" = (assignment_event."metadata"#>>'{outcome,id}')::integer
        JOIN "work_order" work
          ON work."userId" = $1 AND work."id" = (assignment_event."metadata"#>>'{workOrder,id}')::integer
        JOIN "authority_grant" authority_row
          ON authority_row."userId" = $1 AND authority_row."id" = (assignment_event."metadata"#>>'{grant,id}')::integer
        WHERE assignment_event."id" = $3 AND assignment_event."userId" = $1
          AND assignment_event."entityType" = 'loom_codex_assignment' AND assignment_event."entityId" = $2
          AND assignment_event."metadata"->>'assignmentHash' = $5
          AND ready_event."metadata"->>'assignmentHash' = $5
          AND authority_row."revokedAt" IS NULL
          AND authority_row."status" = 'active'
          AND (authority_row."expiresAt" IS NULL OR authority_row."expiresAt" > CURRENT_TIMESTAMP)
        FOR UPDATE OF assignment_event, ready_event, world, outcome, work, authority_row`,
      [input.userId, input.threadId, input.assignmentEventId, input.readyEventId, input.seal.payload.assignment.assignmentHash],
    )
    const row = locked.rows[0]
    if (!row) throw new DeliverySealError("DELIVERY_SEAL_ASSIGNMENT_STALE", "the assignment authority changed before the delivery seal was recorded")
    const assignment = metadataObject(row.assignmentMetadata)
    if (typeof assignment.workspace !== "string") {
      throw new DeliverySealError("DELIVERY_SEAL_ASSIGNMENT_STALE", "the locked assignment workspace is unavailable")
    }
    if (!exactLockedAuthority(row.assignmentMetadata, row.readyMetadata, row, input.seal, input.threadId)) {
      throw new DeliverySealError("DELIVERY_SEAL_ASSIGNMENT_STALE", "the assignment authority changed before the delivery seal was recorded")
    }
    const inserted = await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
        VALUES ($1, 'EVIDENCE_RECORDED', 'williamos_delivery_seal', $2, 'williamos',
          'WilliamOS sealed an existing Space assignment for delivery', $3::jsonb)
        RETURNING "id"`,
      [input.userId, input.seal.signature, JSON.stringify({
        assignmentEventId: input.assignmentEventId,
        readyEventId: input.readyEventId,
        threadId: input.threadId,
        assignmentHash: input.seal.payload.assignment.assignmentHash,
        seal: input.seal,
      })],
    )
    if (!inserted.rows[0]?.id) throw new Error("DELIVERY_SEAL_NOT_DURABLE")
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* preserve the original failure */ }
    throw error
  } finally {
    client.release()
  }
}

export async function issuePersistedCodexDeliverySeal(input: Readonly<{
  userId: string
  threadId: string
  assignmentHash: string
  commitSha: string
}>): Promise<WilliamOSDeliverySeal> {
  const signingKey = deliverySigningKeyFromBase64(process.env.WILLIAMOS_DELIVERY_SEAL_PRIVATE_KEY_B64)
  return issueLoomCodexDeliverySeal(input, {
    loadAssignment: (userId, threadId, assignmentHash) => loadEvent(userId, threadId, assignmentHash, "loom_codex_assignment"),
    loadReady: (userId, threadId, assignmentHash) => loadEvent(userId, threadId, assignmentHash, "loom_codex_ready"),
    deriveCurrentAssignment: async (userId, worldId, projectRoot) => deriveCodexAssignment({ userId, worldId, projectRoot }),
    inspectDelivery: inspectGitDelivery,
    signingKey,
    recordSeal: (userId, threadId, assignmentEventId, readyEventId, seal) => recordDeliverySealWithAuthorityFence({
      userId, threadId, assignmentEventId, readyEventId, seal,
    }),
    now: () => new Date(),
  })
}
