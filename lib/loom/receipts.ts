import { appendGovernanceEvent } from "@/lib/governance/events"
import { pool } from "@/lib/db"
import {
  verifyAssignmentContextManifest,
  type AssignmentContextManifest,
} from "@/lib/loom/assignment-context-manifest"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"
import type { ContractReservation, EnvironmentReservation } from "@/lib/loom/repository-reservations"

/**
 * Receipts for everything the workroom actually does.
 *
 * The workroom can run processes, write files and drive a model. Those are the capabilities this
 * product exists to provide -- but the doctrine it is built on does not forbid mutation, it forbids
 * mutation that leaves no trace: loops may plan and act, they may not *silently* mutate. Shipping the
 * capability without the record was the omission, not the capability.
 *
 * So every run is bracketed: one event when it starts, one when it ends carrying the outcome. The
 * provider and model are recorded on every model turn, because the provider doctrine requires
 * selection to be operator-visible and receipt-recorded -- an answer that cannot be traced to the
 * provider that produced it is exactly the "provider-derived authority" the doctrine rules out.
 */

export interface LoomRunReceipt {
  userId: string
  /** "operation" | "agent" | "edit" -- what kind of work this was. */
  kind: string
  /** The operation id, model name, or file path this run concerned. */
  subject: string
  metadata?: Record<string, unknown>
}

export interface LoomCodexAssignmentReceipt {
  userId: string
  threadId: string
  workspace: string
  worldId: string
  spaceRevision: number
  outcomeId: number
  outcomeKey: string
  outcomeVersion: number
  workOrderId: number
  workOrderRef: string | null
  workOrderVersion: string
  grantId: number
  grantRef: string | null
  grantVersion: string
  allowed: readonly string[]
  forbidden: readonly string[]
  contracts: readonly ContractReservation[]
  environments: readonly EnvironmentReservation[]
  reservationVersion: string
  selectedPath: string
  assignmentHash: string
  taskDigest: string
  taskText: string
  executionBindingHash: string
  isolatedBaseSha: string
  resumed: boolean
  repositoryResourceKey?: string
  repositoryIdentity?: string
  repositoryMountKey?: string
  observedRevision?: string | null
  contextManifest?: AssignmentContextManifest
}

function isDigest(value: string, length = 64): boolean {
  return new RegExp(`^[0-9a-f]{${length}}$`, "i").test(value)
}

type RepositoryReceiptIdentity = Readonly<{
  repositoryResourceKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
}>

/**
 * A completely absent repository identity is a legacy primary-repository receipt. Once any part of
 * the repository identity is present, all four immutable fields must match the server-owned catalog.
 * This keeps old primary sessions readable without letting a new secondary-repository session shed
 * the repository boundary that authorized it.
 */
function repositoryReceiptIdentity(input: Readonly<{
  repositoryResourceKey?: unknown
  repositoryIdentity?: unknown
  repositoryMountKey?: unknown
  observedRevision?: unknown
}>): RepositoryReceiptIdentity | null {
  const values = [
    input.repositoryResourceKey,
    input.repositoryIdentity,
    input.repositoryMountKey,
    input.observedRevision,
  ]
  if (values.every((value) => value === undefined || value === null)) return null
  if (typeof input.repositoryResourceKey !== "string"
    || typeof input.repositoryIdentity !== "string"
    || typeof input.repositoryMountKey !== "string"
    || typeof input.observedRevision !== "string"
    || !/^[a-f0-9]{40,64}$/.test(input.observedRevision)) {
    throw new Error("CODEX_RECEIPT_REPOSITORY_INVALID")
  }
  const selection = resolveWorkspaceRepositorySelection(
    input.repositoryResourceKey === "williamos" ? "williamos" : "terrafusion",
    input.repositoryResourceKey,
  )
  if (!selection.ok
    || selection.repository.identity !== input.repositoryIdentity
    || selection.repository.mountKey !== input.repositoryMountKey) {
    throw new Error("CODEX_RECEIPT_REPOSITORY_INVALID")
  }
  return {
    repositoryResourceKey: input.repositoryResourceKey,
    repositoryIdentity: input.repositoryIdentity,
    repositoryMountKey: input.repositoryMountKey,
    observedRevision: input.observedRevision,
  }
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function assignmentContextReceipt(input: Readonly<{
  threadId: string
  worldId: string
  workOrderId: number
  assignmentHash: string
  allowed: readonly string[]
  selectedPath: string
  baseSha: string
  repository: RepositoryReceiptIdentity | null
  contextManifest?: AssignmentContextManifest
}>): AssignmentContextManifest | null {
  if (!input.repository && input.contextManifest === undefined) return null
  const manifest = input.contextManifest
  if (!input.repository || !manifest || !verifyAssignmentContextManifest(manifest).ok
    || manifest.assignment.assignmentId !== input.threadId
    || manifest.assignment.worldId !== input.worldId
    || manifest.assignment.workOrderId !== input.workOrderId
    || manifest.assignment.assignmentHash !== input.assignmentHash
    || manifest.targetRepository.repositoryKey !== input.repository.repositoryResourceKey
    || manifest.targetRepository.repositoryIdentity !== input.repository.repositoryIdentity
    || manifest.checkout.repositoryMountKey !== input.repository.repositoryMountKey
    || manifest.checkout.baseRevision !== input.repository.observedRevision
    || manifest.checkout.baseRevision !== input.baseSha
    || manifest.mutationPosture.target.repositoryKey !== input.repository.repositoryResourceKey
    || manifest.mutationPosture.target.repositoryIdentity !== input.repository.repositoryIdentity
    || !exactStrings(manifest.mutationPosture.target.writablePaths, input.allowed)
    || !manifest.mutationPosture.target.writablePaths.includes(input.selectedPath)) {
    throw new Error("CODEX_ASSIGNMENT_RECEIPT_CONTEXT_INVALID")
  }
  return manifest
}

/** Persist the immutable, server-derived assignment before any provider turn can execute. */
export async function recordLoomCodexAssignment(input: LoomCodexAssignmentReceipt): Promise<void> {
  let repository: RepositoryReceiptIdentity | null
  try {
    repository = repositoryReceiptIdentity(input)
  } catch {
    throw new Error("CODEX_ASSIGNMENT_RECEIPT_REPOSITORY_INVALID")
  }
  const contextManifest = assignmentContextReceipt({
    threadId: input.threadId,
    worldId: input.worldId,
    workOrderId: input.workOrderId,
    assignmentHash: input.assignmentHash,
    allowed: input.allowed,
    selectedPath: input.selectedPath,
    baseSha: input.isolatedBaseSha,
    repository,
    contextManifest: input.contextManifest,
  })
  if (!input.userId || !input.threadId || !input.worldId || !input.outcomeKey
    || !input.selectedPath || !input.workspace || input.taskText.length > 32_000
    || !isDigest(input.assignmentHash) || !isDigest(input.taskDigest)
    || !isDigest(input.executionBindingHash) || !isDigest(input.reservationVersion)
    || !isDigest(input.isolatedBaseSha, 40)
    || !Number.isSafeInteger(input.spaceRevision) || input.spaceRevision < 0
    || !Number.isSafeInteger(input.outcomeId) || input.outcomeId <= 0
    || !Number.isSafeInteger(input.outcomeVersion) || input.outcomeVersion < 0
    || !Number.isSafeInteger(input.workOrderId) || input.workOrderId <= 0
    || !Number.isSafeInteger(input.grantId) || input.grantId <= 0
    || input.allowed.some((item) => !item) || input.forbidden.some((item) => !item)) {
    throw new Error("CODEX_ASSIGNMENT_RECEIPT_INVALID")
  }
  const metadata = {
    assignmentVersion: "loom-codex-assignment.v1",
    owner: input.userId,
    provider: "Codex",
    mode: "delegate",
    workspace: input.workspace,
    threadId: input.threadId,
    resumed: input.resumed,
    worldId: input.worldId,
    spaceRevision: input.spaceRevision,
    outcome: { id: input.outcomeId, key: input.outcomeKey, version: input.outcomeVersion },
    workOrder: {
      id: input.workOrderId,
      ref: input.workOrderRef,
      version: input.workOrderVersion,
    },
    grant: { id: input.grantId, ref: input.grantRef, version: input.grantVersion },
    reservation: {
      allowed: [...input.allowed],
      forbidden: [...input.forbidden],
      contracts: [...input.contracts],
      environments: [...input.environments],
      version: input.reservationVersion,
    },
    promotionPath: input.selectedPath,
    assignmentHash: input.assignmentHash,
    task: { digest: input.taskDigest, text: input.taskText },
    executionBindingHash: input.executionBindingHash,
    isolatedBaseSha: input.isolatedBaseSha,
    ...(repository ?? {}),
    ...(contextManifest ? { contextManifest } : {}),
  }
  const result = await pool.query(
    `INSERT INTO "governance_event"
      ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
      VALUES ($1, 'EVIDENCE_RECORDED', 'loom_codex_assignment', $2, 'loom',
        'Codex delegate assignment committed before execution', $3::jsonb)
      RETURNING "id"`,
    [input.userId, input.threadId, JSON.stringify(metadata)],
  )
  if (!result.rows[0]?.id) throw new Error("CODEX_ASSIGNMENT_RECEIPT_NOT_DURABLE")
}

/** Atomically persist the only receipt set that makes a Codex thread resumable. */
export async function commitLoomCodexSuccess(input: {
  userId: string
  threadId: string
  workspace: string
  resumed: boolean
  worldId: string
  outcomeKey: string
  workOrderId: number
  grantId: number
  assignmentHash: string
  selectedPath: string
  promotionDigest: string
  baseSha: string
  taskDigest: string
  executionBindingHash: string
  repositoryResourceKey?: string
  repositoryIdentity?: string
  repositoryMountKey?: string
  observedRevision?: string | null
  contextManifest?: AssignmentContextManifest
  promotionAudit: Readonly<{
    userId: string
    path: string
    bytes: number
    startedAuditId: number
    outcome: "SAVED"
    modifiedAt?: string
  }>
}): Promise<void> {
  let repository: RepositoryReceiptIdentity | null
  try {
    repository = repositoryReceiptIdentity(input)
  } catch {
    throw new Error("CODEX_SUCCESS_RECEIPT_REPOSITORY_INVALID")
  }
  const contextManifest = assignmentContextReceipt({
    threadId: input.threadId,
    worldId: input.worldId,
    workOrderId: input.workOrderId,
    assignmentHash: input.assignmentHash,
    allowed: input.contextManifest?.mutationPosture.target.writablePaths ?? [],
    selectedPath: input.selectedPath,
    baseSha: input.baseSha,
    repository,
    contextManifest: input.contextManifest,
  })
  if (input.promotionAudit.userId !== input.userId
    || input.promotionAudit.path !== input.selectedPath
    || input.promotionAudit.outcome !== "SAVED"
    || !Number.isSafeInteger(input.promotionAudit.startedAuditId) || input.promotionAudit.startedAuditId <= 0
    || !Number.isSafeInteger(input.promotionAudit.bytes) || input.promotionAudit.bytes < 0
    || typeof input.promotionAudit.modifiedAt !== "string"
    || !isDigest(input.assignmentHash) || !isDigest(input.promotionDigest)
    || !isDigest(input.baseSha, 40) || !isDigest(input.taskDigest)
    || !isDigest(input.executionBindingHash)) {
    throw new Error("PROMOTION_AUDIT_MISMATCH")
  }
  const client = await pool.connect()
  const identity = {
    provider: "Codex",
    mode: "delegate",
    workspace: input.workspace,
    resumed: input.resumed,
    external: true,
    metered: true,
    worldId: input.worldId,
    outcomeKey: input.outcomeKey,
    workOrderId: input.workOrderId,
    grantId: input.grantId,
    assignmentHash: input.assignmentHash,
    selectedPath: input.selectedPath,
    promotionDigest: input.promotionDigest,
    baseSha: input.baseSha,
    taskDigest: input.taskDigest,
    executionBindingHash: input.executionBindingHash,
    ...(repository ?? {}),
    ...(contextManifest ? { contextManifest } : {}),
  }
  try {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
        VALUES ($1, 'LOOP_STOPPED', 'loom_manual_file_write', $2, 'loom',
          'Codex delegate promotion completed', $3::jsonb)`,
      [input.userId, input.selectedPath, JSON.stringify({
        operation: "codex_delegate_promotion",
        path: input.selectedPath,
        bytes: input.promotionAudit.bytes,
        modifiedAt: input.promotionAudit.modifiedAt,
        startedAuditId: input.promotionAudit.startedAuditId,
        result: "SAVED",
        assignmentHash: input.assignmentHash,
        promotionDigest: input.promotionDigest,
        executionBindingHash: input.executionBindingHash,
        ...(repository ?? {}),
      })],
    )
    await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
        VALUES ($1, 'LOOP_STARTED', 'loom_agent', $2, 'loom',
          'workroom agent: Codex delegate', $3::jsonb)`,
      [input.userId, input.threadId, JSON.stringify(identity)],
    )
    await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
        VALUES ($1, 'LOOP_STOPPED', 'loom_agent', $2, 'loom',
          'workroom agent finished: Codex delegate', $3::jsonb)`,
      [input.userId, input.threadId, JSON.stringify({ ...identity, code: 0, reason: null })],
    )
    await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
        VALUES ($1, 'EVIDENCE_RECORDED', 'loom_codex_ready', $2, 'loom',
          'Codex delegate session committed ready', $3::jsonb)`,
      [input.userId, input.threadId, JSON.stringify({
        ...identity,
        committed: true,
      })],
    )
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* preserve the original failure */ }
    throw error
  } finally {
    client.release()
  }
}

export async function recordLoomStart({ userId, kind, subject, metadata }: LoomRunReceipt): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "LOOP_STARTED",
    entityType: `loom_${kind}`,
    entityId: subject,
    actor: "loom",
    reason: `workroom ${kind}: ${subject}`,
    after: { kind, subject, ...metadata },
    metadata,
  })
}

export async function recordLoomEnd({
  userId,
  kind,
  subject,
  outcome,
  metadata,
}: LoomRunReceipt & { outcome: Record<string, unknown> }): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "LOOP_STOPPED",
    entityType: `loom_${kind}`,
    entityId: subject,
    actor: "loom",
    reason: `workroom ${kind} finished: ${subject}`,
    after: { kind, subject, ...outcome },
    metadata: { ...metadata, ...outcome },
  })
}

/**
 * Record what a model attempt actually did to the workspace.
 *
 * Kept distinct from the start/stop pair because this one carries the adapter's own verdict --
 * whether edits verified, how many attempts it took, and whether the workspace was restored. That is
 * the evidence a reader needs to decide whether to trust the change, and it is worth being able to
 * find on its own rather than buried inside a stop event.
 */
export async function recordLoomEvidence({
  userId,
  subject,
  receipt,
}: {
  userId: string
  subject: string
  receipt: Record<string, unknown> | null
}): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "EVIDENCE_RECORDED",
    entityType: "loom_edit",
    entityId: subject,
    actor: "loom",
    // An unreadable receipt is recorded as unreadable rather than omitted: a missing evidence row
    // would read as "no edit happened", which is the one thing it does not mean.
    reason: receipt === null ? `structured edit on ${subject}: receipt unreadable` : `structured edit on ${subject}`,
    after: receipt ?? { unreadable: true },
    metadata: receipt ?? { unreadable: true },
  })
}
