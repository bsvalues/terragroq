import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  authorityGrant,
  eventLog,
  evidenceRecord,
  governanceEvent,
  outcomeQueueItem,
  outcomeQueueMutationReceipt,
  project,
  projectResource,
  workingWorld,
  workOrder,
} from "@/lib/db/schema"
import {
  loadProtectedProductTerminalProof,
  WACO_PRODUCT_TERMINAL_BINDING,
  type ProtectedProductTerminalProof,
} from "@/lib/environment/external-product-terminal-receipt"
import { validateWorkingWorld, withExecution } from "@/lib/environment/working-world"
import { hashRecord } from "@/lib/governance/hash"
import { resolveTerraFusionWorkspaceBinding } from "@/lib/projects/workspace-project-binding"
import { transitionWorkOrderInTransaction } from "@/lib/work-orders/governed-transition"

export const EXTERNAL_PRODUCT_TERMINAL_SETTLEMENT_OPERATION = "space.external_product_terminal.finalize"
const ADMISSION_CONTRACT = "space-external-work-order-admission.v2"
const EXPECTED_OUTCOME_KEY = `external:${WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest}`

export type ExternalProductTerminalSettlementResult = Readonly<{
  status: "PRODUCT_TERMINAL_SETTLED"
  replayed: boolean
  worldId: string
  outcomeKey: string
  workOrderId: number
  terminalState: string
  releaseSha: string
  protectedCommit: string
}>

type ResolvedBinding = Readonly<{
  workspaceRoot: string
  repositoryIdentity: string
  repositoryResourceId: number | null
  projectId: number
}>

type SettlementInput = Readonly<{
  userId: string
  worldId: string
  projectId: number
  repositoryResourceId: number
  proof: ProtectedProductTerminalProof
}>

export type ExternalProductTerminalSettlementDependencies = Readonly<{
  resolveWorkspaceBinding: (userId: string) => Promise<
    | Readonly<{ ok: true; binding: ResolvedBinding }>
    | Readonly<{ ok: false; error: string }>
  >
  loadProof: typeof loadProtectedProductTerminalProof
  settle: (input: SettlementInput) => Promise<ExternalProductTerminalSettlementResult>
}>

function fail(code: string): never {
  throw new Error(code)
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && JSON.stringify(value.map(String).sort()) === JSON.stringify([...expected].sort())
}

function result(input: SettlementInput, workOrderId: number, replayed: boolean): ExternalProductTerminalSettlementResult {
  return {
    status: "PRODUCT_TERMINAL_SETTLED",
    replayed,
    worldId: input.worldId,
    outcomeKey: EXPECTED_OUTCOME_KEY,
    workOrderId,
    terminalState: input.proof.terminalState,
    releaseSha: input.proof.releaseSha,
    protectedCommit: input.proof.protectedCommit,
  }
}

async function settleExternalProductTerminalOnce(input: SettlementInput): Promise<ExternalProductTerminalSettlementResult> {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      // Share the admission lock so settlement cannot race the graph that establishes its authority.
      // A second world-specific lock serializes retries without blocking unrelated owner activity.
      // eslint-disable-next-line drizzle/enforce-delete-with-where
      sql`SELECT
        pg_advisory_xact_lock(hashtext(${`${input.userId}:external-work-order-admission`})),
        pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.worldId}:external-product-terminal`}))`,
    )

    const admissionReceipts = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, input.userId),
      eq(outcomeQueueMutationReceipt.operation, WACO_PRODUCT_TERMINAL_BINDING.admissionOperation),
      eq(outcomeQueueMutationReceipt.outcomeKey, EXPECTED_OUTCOME_KEY),
    )).limit(2).for("update")
    if (admissionReceipts.length !== 1) fail("PRODUCT_TERMINAL_CONTEXT_STALE")
    const admission = admissionReceipts[0]
    const admissionRequest = object(admission.requestBinding)
    const packet = object(admissionRequest?.externalWorkOrder)
    const binding = object(admission.resultBinding)
    if (!admissionRequest || !packet || !binding
      || admissionRequest.provenanceDigest !== WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest
      || packet.source !== WACO_PRODUCT_TERMINAL_BINDING.admissionSource
      || packet.externalRef !== WACO_PRODUCT_TERMINAL_BINDING.externalRef
      || packet.repository !== WACO_PRODUCT_TERMINAL_BINDING.repository
      || binding.worldId !== input.worldId
      || binding.outcomeKey !== EXPECTED_OUTCOME_KEY
      || binding.source !== WACO_PRODUCT_TERMINAL_BINDING.admissionSource
      || binding.externalRef !== WACO_PRODUCT_TERMINAL_BINDING.externalRef
      || binding.repository !== WACO_PRODUCT_TERMINAL_BINDING.repository
      || binding.provenanceDigest !== WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest
      || binding.projectId !== input.projectId) {
      fail("PRODUCT_TERMINAL_CONTEXT_STALE")
    }
    const workOrderId = Number(binding.workOrderId)
    const implementationGrantId = Number(binding.implementationGrantId)
    const queueGrantId = Number(binding.queueGrantId)
    if (!Number.isSafeInteger(workOrderId) || workOrderId <= 0
      || !Number.isSafeInteger(implementationGrantId) || implementationGrantId <= 0
      || !Number.isSafeInteger(queueGrantId) || queueGrantId <= 0) {
      fail("PRODUCT_TERMINAL_CONTEXT_STALE")
    }

    // A transaction owns one PostgreSQL client. Keep all graph reads sequential so the
    // locked authority graph is observed through one ordered serializable snapshot.
    const worldRows = await transaction.select().from(workingWorld).where(and(
        eq(workingWorld.userId, input.userId), eq(workingWorld.id, input.worldId),
      )).limit(1).for("update")
    const outcomeRows = await transaction.select().from(outcomeQueueItem).where(and(
        eq(outcomeQueueItem.userId, input.userId), eq(outcomeQueueItem.outcomeKey, EXPECTED_OUTCOME_KEY),
      )).limit(1).for("update")
    const workRows = await transaction.select().from(workOrder).where(and(
        eq(workOrder.userId, input.userId), eq(workOrder.id, workOrderId),
      )).limit(1).for("update")
    const grantRows = await transaction.select().from(authorityGrant).where(and(
        eq(authorityGrant.userId, input.userId), eq(authorityGrant.workOrderId, workOrderId),
      )).for("update")
    const projectRows = await transaction.select().from(project).where(and(
        eq(project.userId, input.userId), eq(project.id, input.projectId),
      )).limit(1).for("update")
    const resourceRows = await transaction.select().from(projectResource).where(and(
        eq(projectResource.userId, input.userId),
        eq(projectResource.id, input.repositoryResourceId),
        eq(projectResource.projectId, input.projectId),
      )).limit(1).for("update")
    const priorRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
        eq(outcomeQueueMutationReceipt.userId, input.userId),
        eq(outcomeQueueMutationReceipt.operation, EXTERNAL_PRODUCT_TERMINAL_SETTLEMENT_OPERATION),
        eq(outcomeQueueMutationReceipt.outcomeKey, EXPECTED_OUTCOME_KEY),
      )).limit(2).for("update")
    const persistedWorld = worldRows[0]
    if (!persistedWorld) fail("WORLD_NOT_FOUND")
    const world = validateWorkingWorld(JSON.parse(persistedWorld.snapshot))
    const outcome = outcomeRows[0]
    const work = workRows[0]
    const persistedProject = projectRows[0]
    const resource = resourceRows[0]
    const implementationGrant = grantRows.find((grant) => grant.id === implementationGrantId)
    const queueGrant = grantRows.find((grant) => grant.id === queueGrantId)
    if (!outcome || !work || !persistedProject || !resource || !implementationGrant || !queueGrant
      || world.spine.projectId !== input.projectId
      || world.spine.threadId !== binding.threadId
      || world.spine.outcomeKey !== EXPECTED_OUTCOME_KEY
      || world.spine.workOrderId !== workOrderId
      || outcome.activeWorkOrderId !== workOrderId
      || outcome.goalId !== Number(binding.goalId)
      || outcome.goalRef !== binding.goalRef
      || !exactStrings(outcome.acceptedContractIds, [ADMISSION_CONTRACT])
      || outcome.approvalState !== "approved" || outcome.approvedBy !== input.userId
      || outcome.authorityLevel !== "A2_WRITE_OWN"
      || outcome.authorityGrantRef !== binding.queueGrantRef
      || outcome.executionBinding !== `space-external:${WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest}`
      || (outcome.lifecycleState === "active" && (
        outcome.leaseHolder !== `space:${input.worldId}`
        || outcome.leaseToken !== hashRecord({
          provenanceDigest: WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest,
          worldId: input.worldId,
          workOrderId,
        })
      ))
      || outcome.acquisitionKey !== binding.acquisitionKey
      || work.ref !== binding.workOrderRef || work.status === "aborted"
      || work.authorityGrantId !== implementationGrantId
      || implementationGrant.ref !== binding.implementationGrantRef
      || implementationGrant.grantedTo !== "codex"
      || queueGrant.ref !== binding.queueGrantRef
      || queueGrant.grantedTo !== "operator"
      || queueGrant.scope !== EXPECTED_OUTCOME_KEY
      || !exactStrings(queueGrant.allowedActions, ["outcome:execute"])
      || persistedProject.lifecycle !== "active"
      || resource.type !== "repo" || resource.relationship !== "primary-repo"
      || resource.canonicalIdentity !== WACO_PRODUCT_TERMINAL_BINDING.repository) {
      fail("PRODUCT_TERMINAL_CONTEXT_STALE")
    }

    const proofBinding = {
      operation: EXTERNAL_PRODUCT_TERMINAL_SETTLEMENT_OPERATION,
      worldId: input.worldId,
      outcomeKey: EXPECTED_OUTCOME_KEY,
      workOrderId,
      projectId: input.projectId,
      repositoryResourceId: input.repositoryResourceId,
      provenanceDigest: WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest,
      protectedCommit: input.proof.protectedCommit,
      catalog: { path: input.proof.catalogPath, sha256: input.proof.catalogSha256 },
      receipt: {
        path: input.proof.receiptPath, sha256: input.proof.receiptSha256,
        id: input.proof.receiptId, contentSha256: input.proof.contentSha256,
      },
      profile: { path: input.proof.profilePath, sha256: input.proof.profileSha256 },
      terminal: {
        productId: input.proof.productId, releaseId: input.proof.releaseId,
        terminalState: input.proof.terminalState, releaseSha: input.proof.releaseSha,
        deploymentId: input.proof.deploymentId, acceptedAt: input.proof.acceptedAt,
        limitations: [...input.proof.limitations],
      },
    }
    const evidenceHash = hashRecord(proofBinding)
    const terminalKey = `${EXTERNAL_PRODUCT_TERMINAL_SETTLEMENT_OPERATION}:${evidenceHash}`
    const evidenceRefs = [
      `protected-main:${input.proof.protectedCommit}`,
      `product-terminal-receipt:${input.proof.receiptId}`,
      `release:${input.proof.releaseSha}`,
    ]
    if (outcome.lifecycleState === "completed") {
      const prior = priorRows.length === 1 ? object(priorRows[0].resultBinding) : null
      const terminalEvidence = outcome.terminalEvidenceId === null ? null
        : (await transaction.select().from(evidenceRecord).where(and(
          eq(evidenceRecord.userId, input.userId), eq(evidenceRecord.id, outcome.terminalEvidenceId),
        )).limit(1).for("update"))[0]
      const exact = priorRows.length === 1 && prior?.evidenceHash === evidenceHash
        && prior?.terminalKey === terminalKey && prior?.protectedCommit === input.proof.protectedCommit
        && work.status === "closed" && outcome.terminalResult === "COMPLETE"
        && outcome.terminalKey === terminalKey && exactStrings(outcome.terminalEvidenceRefs, evidenceRefs)
        && terminalEvidence?.contentHash === evidenceHash && terminalEvidence.head === input.proof.releaseSha
        && grantRows.every((grant) => grant.status === "expired"
          || (grant.status === "revoked" && grant.revokeReason === "EXTERNAL_PRODUCT_TERMINAL_PROVEN"))
        && world.spine.execution === "complete"
      if (!exact) fail("PRODUCT_TERMINAL_CONFLICT")
      return result(input, workOrderId, true)
    }
    if (priorRows.length !== 0 || outcome.lifecycleState !== "active" || work.status !== "active") {
      fail("PRODUCT_TERMINAL_CONFLICT")
    }
    if (grantRows.some((grant) => grant.status === "revoked" || grant.revokedAt !== null)) {
      fail("PRODUCT_TERMINAL_AUTHORITY_REVOKED")
    }

    const nowResult = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const at = new Date(nowResult.rows[0]?.now as Date | string)
    const [evidence] = await transaction.insert(evidenceRecord).values({
      userId: input.userId,
      workOrderId,
      result: "PASS",
      repo: WACO_PRODUCT_TERMINAL_BINDING.repository,
      head: input.proof.releaseSha,
      filesChanged: [],
      validators: [
        "TerraFusion protected-history catalog binding",
        "TerraFusion native product-terminal receipt",
        "TerraCanon immutable release profile",
      ],
      knownFailures: [],
      outOfScopeChanges: [],
      deferredItems: [...input.proof.limitations],
      nextValidMove: "Release this Space and continue the next authorized WilliamOS outcome.",
      notes: JSON.stringify(proofBinding),
      contentHash: evidenceHash,
      artifactPath: `${input.proof.protectedCommit}:${input.proof.receiptPath}`,
      createdAt: at,
    }).returning({ id: evidenceRecord.id })
    for (const to of ["review", "closed"] as const) {
      const transitioned = await transitionWorkOrderInTransaction({
        transaction, userId: input.userId, workOrderId, to, now: at,
      })
      if (!transitioned.ok) fail("PRODUCT_TERMINAL_CONTEXT_STALE")
    }
    await transaction.update(workOrder).set({
      result: "PASS",
      commitRef: input.proof.releaseSha,
      evidence: [...new Set([...work.evidence, `evidence:${evidence.id}`, ...evidenceRefs])].sort(),
      updatedAt: at,
    }).where(and(eq(workOrder.userId, input.userId), eq(workOrder.id, workOrderId)))
    await transaction.update(outcomeQueueItem).set({
      lifecycleState: "completed",
      lifecycleReason: "EXTERNAL_PRODUCT_TERMINAL_PROVEN",
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "COMPLETE",
      terminalEvidenceId: evidence.id,
      terminalEvidenceRefs: evidenceRefs,
      terminalKey,
      terminalAt: at,
      updatedAt: at,
      version: outcome.version + 1,
    }).where(and(eq(outcomeQueueItem.userId, input.userId), eq(outcomeQueueItem.id, outcome.id)))
    await transaction.update(authorityGrant).set({
      status: "revoked",
      revokedAt: at,
      revokedBy: input.userId,
      revokeReason: "EXTERNAL_PRODUCT_TERMINAL_PROVEN",
    }).where(and(
      eq(authorityGrant.userId, input.userId),
      eq(authorityGrant.workOrderId, workOrderId),
      eq(authorityGrant.status, "active"),
    ))

    const completedWorld = withExecution(world, {
      execution: "complete",
      at: at.toISOString(),
      evidence: {
        kind: "validation",
        detail: `${input.proof.terminalState} at ${input.proof.releaseSha}`,
        result: "PASS",
        at: at.toISOString(),
      },
    })
    await transaction.update(workingWorld).set({
      snapshot: JSON.stringify(completedWorld), intent: completedWorld.intent, updatedAt: at,
    }).where(and(eq(workingWorld.userId, input.userId), eq(workingWorld.id, input.worldId)))
    const metadata = { ...proofBinding, evidenceId: evidence.id, evidenceHash, terminalKey }
    await transaction.insert(governanceEvent).values({
      userId: input.userId,
      eventType: "EXTERNAL_PRODUCT_TERMINAL_FINALIZED",
      entityType: "outcome_queue_item",
      entityId: String(outcome.id),
      actor: "williamos",
      reason: "WilliamOS independently verified the external product terminal receipt in protected history.",
      beforeHash: hashRecord({ lifecycleState: "active", version: outcome.version }),
      afterHash: hashRecord({ lifecycleState: "completed", version: outcome.version + 1, evidenceHash }),
      evidenceId: evidence.id,
      metadata,
      createdAt: at,
    })
    await transaction.insert(eventLog).values({
      userId: input.userId,
      type: "space.external_product_terminal.finalized",
      register: "work-orders",
      refId: workOrderId,
      summary: `${work.ref ?? `#${workOrderId}`}: ${input.proof.terminalState}`,
      metadata,
      createdAt: at,
    })
    await transaction.insert(outcomeQueueMutationReceipt).values({
      userId: input.userId,
      idempotencyKey: evidenceHash,
      operation: EXTERNAL_PRODUCT_TERMINAL_SETTLEMENT_OPERATION,
      outcomeKey: EXPECTED_OUTCOME_KEY,
      requestHash: hashRecord({ worldId: input.worldId }),
      requestBinding: { worldId: input.worldId },
      resultBinding: metadata,
      createdAt: at,
    })
    return result(input, workOrderId, false)
  }, { isolationLevel: "serializable" })
}

function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: unknown; cause?: unknown }
  if (candidate.code === "40001") return true
  return candidate.cause !== error && isSerializationFailure(candidate.cause)
}

async function settleExternalProductTerminal(input: SettlementInput): Promise<ExternalProductTerminalSettlementResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await settleExternalProductTerminalOnce(input)
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 2) throw error
    }
  }
  return fail("PRODUCT_TERMINAL_CONFLICT")
}

const defaultDependencies: ExternalProductTerminalSettlementDependencies = {
  async resolveWorkspaceBinding(userId) {
    const resolved = await resolveTerraFusionWorkspaceBinding(userId, undefined, "os-1", {
      includeRepositoryCatalog: false,
    })
    if (!resolved.ok) return resolved
    return {
      ok: true,
      binding: {
        workspaceRoot: resolved.binding.workspaceRoot,
        repositoryIdentity: resolved.binding.repositoryIdentity,
        repositoryResourceId: resolved.binding.repositoryResourceId,
        projectId: resolved.binding.projectId,
      },
    }
  },
  loadProof: loadProtectedProductTerminalProof,
  settle: settleExternalProductTerminal,
}

export async function finalizeExternalProductTerminalOutcome(
  input: Readonly<{ userId: string; worldId: string }>,
  dependencies: ExternalProductTerminalSettlementDependencies = defaultDependencies,
): Promise<ExternalProductTerminalSettlementResult> {
  const resolved = await dependencies.resolveWorkspaceBinding(input.userId)
  if (!resolved.ok) fail("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  const binding = resolved.binding
  if (binding.repositoryIdentity !== WACO_PRODUCT_TERMINAL_BINDING.repository
    || binding.repositoryResourceId === null) {
    fail("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  }
  const proof = await dependencies.loadProof({
    workspaceRoot: binding.workspaceRoot,
    repository: binding.repositoryIdentity,
  })
  return dependencies.settle({
    userId: input.userId,
    worldId: input.worldId,
    projectId: binding.projectId,
    repositoryResourceId: binding.repositoryResourceId,
    proof,
  })
}
