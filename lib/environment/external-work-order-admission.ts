import { randomUUID } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  authorityGrant,
  decision,
  eventLog,
  goal,
  governanceEvent,
  outcomeQueueAcquisitionReceipt,
  outcomeQueueItem,
  outcomeQueueMutationReceipt,
  project,
  projectResource,
  workbenchThread,
  workbenchThreadSource,
  workingWorld,
  workOrder,
} from "@/lib/db/schema"
import { grantCovers, isGrantActive } from "@/lib/governance/authority"
import { createAuthorityGrantInTransaction, writeAuthorityGrantArtifact } from "@/lib/governance/authority-grant-write"
import { hashRecord } from "@/lib/governance/hash"
import { transitionWorkOrderInTransaction } from "@/lib/work-orders/governed-transition"
import {
  authorityGrantFactsFromNormalizedRow,
  resolveSpaceRepositoryIdentities,
} from "@/lib/environment/space-outcome-assimilation"
import { validateWorkingWorld, withBoundOutcome } from "@/lib/environment/working-world"

export const EXTERNAL_WORK_ORDER_ADMISSION_OPERATION = "space.external_work_order.admit"
export const EXTERNAL_WORK_ORDER_ADMISSION_VERSION = "space-external-work-order-admission.v1"
const GRANT_HOURS = 72
const FIXED_BLOCKED_ACTIONS = ["production:mutate", "release:create", "secret:access", "spend:increase"] as const
const SAFE_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "DrizzleQueryError", "DatabaseError"])
const DATABASE_CODE = /^[0-9A-Z]{5}$/

export function boundedExternalWorkOrderFailureMetadata(
  error: unknown,
): Readonly<{ classification: string; name?: string; databaseCode?: string }> {
  const candidate = error instanceof Error ? error : undefined
  const cause = candidate?.cause instanceof Error ? candidate.cause : undefined
  const rawCode = (candidate as (Error & { code?: unknown }) | undefined)?.code
    ?? (cause as (Error & { code?: unknown }) | undefined)?.code
  return {
    classification: "EXTERNAL_WORK_ORDER_ADMISSION_INTERNAL_FAILURE",
    ...(candidate && SAFE_ERROR_NAMES.has(candidate.name) ? { name: candidate.name } : {}),
    ...(typeof rawCode === "string" && DATABASE_CODE.test(rawCode) ? { databaseCode: rawCode } : {}),
  }
}

export type ExternalWorkOrderPacket = Readonly<{
  source: "github" | "other"
  externalRef: string
  title: string
  objective: string
  repository: string
  authorityEvidence: readonly string[]
  reservedPaths: readonly string[]
  forbiddenPaths: readonly string[]
  validators: readonly string[]
  acceptanceCriteria: readonly string[]
  pullRequest?: Readonly<{ number: number; headSha: string }>
}>

export type ExternalWorkOrderAdmissionInput = Readonly<{
  mode: "ADMIT"
  worldId: string
  idempotencyKey: string
  confirmation: "ADMIT_EXTERNAL_WORK_ORDER"
  confirmedProvenanceDigest: string
  externalWorkOrder: ExternalWorkOrderPacket
}>

export type ExternalWorkOrderPreviewInput = Readonly<{
  mode: "PREVIEW"
  worldId: string
  externalWorkOrder: ExternalWorkOrderPacket
}>

export type ExternalWorkOrderPreview = Readonly<{
  status: "READY_FOR_CONFIRMATION"
  worldId: string
  provenanceDigest: string
  externalWorkOrder: ExternalWorkOrderPacket
}>

export type ExternalWorkOrderAdmissionSuccess = Readonly<{
  status: "ADMITTED" | "ALREADY_ADMITTED"
  replayed: boolean
  worldId: string
  outcomeKey: string
  workOrder: Readonly<{ id: number; ref: string; externalRef: string }>
  authority: Readonly<{ level: "A2_WRITE_OWN"; grantRef: string }>
  reservedPaths: readonly string[]
  provenanceDigest: string
}>

export type ExternalWorkOrderAdmissionFailureCode =
  | "IDEMPOTENCY_CONFLICT"
  | "CONFIRMATION_STALE"
  | "WORLD_NOT_FOUND"
  | "SPACE_ALREADY_BOUND"
  | "ACTIVE_OUTCOME_CONFLICT"
  | "EXTERNAL_WORK_ORDER_ALREADY_ADMITTED"
  | "PROJECT_REPOSITORY_MISMATCH"
  | "PERSISTED_BINDING_INVALID"
  | "DOCTRINE_FORBIDDEN"
  | "WORK_ORDER_GOVERNANCE_REFUSED"

export class ExternalWorkOrderAdmissionError extends Error {
  constructor(public readonly code: ExternalWorkOrderAdmissionFailureCode) {
    super(code)
    this.name = "ExternalWorkOrderAdmissionError"
  }
}

function text(value: unknown, error: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(error)
  }
  return value.trim()
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], error: string): void {
  const keys = new Set(allowed)
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error(error)
}

function stringList(value: unknown, error: string, maxItems = 64, maxLength = 1_000): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) throw new Error(error)
  const normalized = value.map((item) => text(item, error, maxLength).replace(/\\/g, "/"))
  const unique = [...new Set(normalized)].sort()
  if (unique.length !== normalized.length) throw new Error(error)
  return unique
}

function optionalStringList(value: unknown, error: string): string[] {
  if (value === undefined) return []
  return stringList(value, error)
}

function reservationPath(value: string): boolean {
  return !value.startsWith("/") && !value.startsWith("//") && !/^[A-Za-z]:/.test(value)
    && !value.split("/").some((segment) => segment === "..")
}

function normalizeExternalWorkOrderPacket(raw: unknown): ExternalWorkOrderPacket {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("EXTERNAL_PROVENANCE_INVALID")
  }
  const packet = raw as Record<string, unknown>
  exactKeys(packet, [
    "source", "externalRef", "title", "objective", "repository", "authorityEvidence",
    "reservedPaths", "forbiddenPaths", "validators", "acceptanceCriteria", "pullRequest",
  ], "EXTERNAL_PROVENANCE_INVALID")
  if (packet.source !== "github" && packet.source !== "other") throw new Error("EXTERNAL_PROVENANCE_INVALID")
  const repository = text(packet.repository, "EXTERNAL_PROVENANCE_INVALID", 200)
    .replace(/\.git$/i, "").toLowerCase()
  if (!/^[^/:\s]+\/[^/\s]+$/.test(repository)) throw new Error("EXTERNAL_PROVENANCE_INVALID")
  const reservedPaths = stringList(packet.reservedPaths, "EXTERNAL_PROVENANCE_INVALID")
  const forbiddenPaths = optionalStringList(packet.forbiddenPaths, "EXTERNAL_PROVENANCE_INVALID")
  if (![...reservedPaths, ...forbiddenPaths].every(reservationPath)) throw new Error("EXTERNAL_PROVENANCE_INVALID")
  if (forbiddenPaths.some((path) => reservedPaths.includes(path))) throw new Error("EXTERNAL_PROVENANCE_INVALID")
  const validators = stringList(packet.validators, "EXTERNAL_PROVENANCE_INVALID", 32, 500)
  const acceptanceCriteria = stringList(packet.acceptanceCriteria, "EXTERNAL_PROVENANCE_INVALID", 32, 1_000)
  const authorityEvidence = stringList(packet.authorityEvidence, "EXTERNAL_PROVENANCE_INVALID", 32, 1_000)
  let pullRequest: ExternalWorkOrderPacket["pullRequest"]
  if (packet.pullRequest !== undefined) {
    if (!packet.pullRequest || typeof packet.pullRequest !== "object" || Array.isArray(packet.pullRequest)) {
      throw new Error("EXTERNAL_PROVENANCE_INVALID")
    }
    const pr = packet.pullRequest as Record<string, unknown>
    exactKeys(pr, ["number", "headSha"], "EXTERNAL_PROVENANCE_INVALID")
    if (!Number.isSafeInteger(pr.number) || Number(pr.number) <= 0
      || typeof pr.headSha !== "string" || !/^[0-9a-f]{40}$/.test(pr.headSha)) {
      throw new Error("EXTERNAL_PROVENANCE_INVALID")
    }
    pullRequest = { number: Number(pr.number), headSha: pr.headSha }
  }
  return {
    source: packet.source,
    externalRef: text(packet.externalRef, "EXTERNAL_PROVENANCE_INVALID", 200),
    title: text(packet.title, "EXTERNAL_PROVENANCE_INVALID", 500),
    objective: text(packet.objective, "EXTERNAL_PROVENANCE_INVALID", 4_000),
    repository,
    authorityEvidence,
    reservedPaths,
    forbiddenPaths,
    validators,
    acceptanceCriteria,
    ...(pullRequest ? { pullRequest } : {}),
  }
}

export function externalWorkOrderProvenanceDigest(packet: ExternalWorkOrderPacket): string {
  return hashRecord({ version: EXTERNAL_WORK_ORDER_ADMISSION_VERSION, packet })
}

export function previewExternalWorkOrderAdmission(raw: unknown): ExternalWorkOrderPreview {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("REQUEST_FIELDS_INVALID")
  const input = raw as Record<string, unknown>
  exactKeys(input, ["mode", "worldId", "externalWorkOrder"], "REQUEST_FIELDS_INVALID")
  if (input.mode !== "PREVIEW") throw new Error("REQUEST_FIELDS_INVALID")
  const worldId = text(input.worldId, "REQUEST_FIELDS_INVALID", 200)
  const externalWorkOrder = normalizeExternalWorkOrderPacket(input.externalWorkOrder)
  return {
    status: "READY_FOR_CONFIRMATION",
    worldId,
    provenanceDigest: externalWorkOrderProvenanceDigest(externalWorkOrder),
    externalWorkOrder,
  }
}

export function normalizeExternalWorkOrderAdmissionInput(raw: unknown): ExternalWorkOrderAdmissionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("REQUEST_FIELDS_INVALID")
  const input = raw as Record<string, unknown>
  exactKeys(input, [
    "mode", "worldId", "idempotencyKey", "confirmation", "confirmedProvenanceDigest", "externalWorkOrder",
  ], "REQUEST_FIELDS_INVALID")
  if (input.mode !== "ADMIT") throw new Error("REQUEST_FIELDS_INVALID")
  const worldId = text(input.worldId, "REQUEST_FIELDS_INVALID", 200)
  const idempotencyKey = text(input.idempotencyKey, "REQUEST_FIELDS_INVALID", 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) throw new Error("REQUEST_FIELDS_INVALID")
  if (input.confirmation !== "ADMIT_EXTERNAL_WORK_ORDER"
    || typeof input.confirmedProvenanceDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(input.confirmedProvenanceDigest)) {
    throw new Error("CONFIRMATION_REQUIRED")
  }
  const externalWorkOrder = normalizeExternalWorkOrderPacket(input.externalWorkOrder)
  if (input.confirmedProvenanceDigest !== externalWorkOrderProvenanceDigest(externalWorkOrder)) {
    throw new ExternalWorkOrderAdmissionError("CONFIRMATION_STALE")
  }
  return {
    mode: "ADMIT",
    worldId,
    idempotencyKey,
    confirmation: "ADMIT_EXTERNAL_WORK_ORDER",
    confirmedProvenanceDigest: input.confirmedProvenanceDigest,
    externalWorkOrder,
  }
}

export function externalWorkOrderAdmissionDigests(input: ExternalWorkOrderAdmissionInput) {
  const provenanceDigest = externalWorkOrderProvenanceDigest(input.externalWorkOrder)
  return {
    provenanceDigest,
    requestHash: hashRecord({
      version: EXTERNAL_WORK_ORDER_ADMISSION_VERSION,
      worldId: input.worldId,
      idempotencyKey: input.idempotencyKey,
      confirmation: input.confirmation,
      confirmedProvenanceDigest: input.confirmedProvenanceDigest,
      provenanceDigest,
    }),
  }
}

function resultFromBinding(
  status: "ADMITTED" | "ALREADY_ADMITTED",
  replayed: boolean,
  binding: Record<string, unknown>,
): ExternalWorkOrderAdmissionSuccess {
  return {
    status,
    replayed,
    worldId: String(binding.worldId),
    outcomeKey: String(binding.outcomeKey),
    workOrder: {
      id: Number(binding.workOrderId),
      ref: String(binding.workOrderRef),
      externalRef: String(binding.externalRef),
    },
    authority: { level: "A2_WRITE_OWN", grantRef: String(binding.implementationGrantRef) },
    reservedPaths: [...(binding.reservedPaths as string[])],
    provenanceDigest: String(binding.provenanceDigest),
  }
}

function exactStrings(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

export async function admitExternalWorkOrder(
  userId: string,
  rawInput: unknown,
): Promise<ExternalWorkOrderAdmissionSuccess> {
  const input = normalizeExternalWorkOrderAdmissionInput(rawInput)
  const { provenanceDigest, requestHash } = externalWorkOrderAdmissionDigests(input)
  const suffix = provenanceDigest.slice(0, 24).toUpperCase()
  const refs = {
    goal: `GOAL-EXT-${suffix}`,
    outcome: `external:${provenanceDigest}`,
    workOrder: `WO-EXT-${suffix}`,
    decision: `EXT-WO-DEC-${suffix}`,
  }
  const packet = input.externalWorkOrder
  const decisionEvidence = [...packet.authorityEvidence, `external-provenance-digest:${provenanceDigest}`]
  const workOrderEvidence = [
    ...packet.authorityEvidence,
    `external-ref:${packet.externalRef}`,
    `external-provenance-digest:${provenanceDigest}`,
  ]

  // Canonical authority rows and the Space binding commit as one unit.
  const committed = await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:external-work-order-admission`}))`)
    const receipts = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.idempotencyKey, input.idempotencyKey),
    )).limit(2)
    if (receipts.length > 1) throw new ExternalWorkOrderAdmissionError("PERSISTED_BINDING_INVALID")
    if (receipts[0]) {
      const receipt = receipts[0]
      if (receipt.operation !== EXTERNAL_WORK_ORDER_ADMISSION_OPERATION || receipt.requestHash !== requestHash
        || hashRecord(receipt.requestBinding) !== hashRecord({ ...input, provenanceDigest })) {
        throw new ExternalWorkOrderAdmissionError("IDEMPOTENCY_CONFLICT")
      }
      const binding = receipt.resultBinding as Record<string, unknown>
      // A PostgreSQL transaction owns one client; keep replay reads sequential so the
      // full persisted graph is observed through that single serialized snapshot.
      const worlds = await transaction.select({ snapshot: workingWorld.snapshot }).from(workingWorld).where(and(
          eq(workingWorld.userId, userId), eq(workingWorld.id, input.worldId),
        )).limit(1)
      const outcomes = await transaction.select().from(outcomeQueueItem).where(and(
          eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.outcomeKey, String(binding.outcomeKey)),
        )).limit(1)
      const goals = await transaction.select().from(goal).where(and(
          eq(goal.userId, userId), eq(goal.id, Number(binding.goalId)),
        )).limit(1)
      const works = await transaction.select().from(workOrder).where(and(
          eq(workOrder.userId, userId), eq(workOrder.id, Number(binding.workOrderId)),
        )).limit(1)
      const implementationGrants = await transaction.select().from(authorityGrant).where(and(
          eq(authorityGrant.userId, userId), eq(authorityGrant.id, Number(binding.implementationGrantId)),
        )).limit(1)
      const queueGrants = await transaction.select().from(authorityGrant).where(and(
          eq(authorityGrant.userId, userId), eq(authorityGrant.id, Number(binding.queueGrantId)),
        )).limit(1)
      const acquisitionReceipts = await transaction.select().from(outcomeQueueAcquisitionReceipt).where(and(
          eq(outcomeQueueAcquisitionReceipt.userId, userId),
          eq(outcomeQueueAcquisitionReceipt.acquisitionKey, String(binding.acquisitionKey)),
        )).limit(1)
      const approvals = await transaction.select().from(decision).where(and(
          eq(decision.userId, userId), eq(decision.id, Number(binding.approvalDecisionId)),
        )).limit(1)
      const projects = await transaction.select().from(project).where(and(
          eq(project.userId, userId), eq(project.id, Number(binding.projectId)),
        )).limit(1)
      const threads = await transaction.select().from(workbenchThread).where(and(
          eq(workbenchThread.userId, userId), eq(workbenchThread.id, String(binding.threadId)),
        )).limit(1)
      const roots = await transaction.select().from(workbenchThreadSource).where(and(
          eq(workbenchThreadSource.userId, userId),
          eq(workbenchThreadSource.threadId, String(binding.threadId)),
          eq(workbenchThreadSource.sourceType, "outcome"),
          eq(workbenchThreadSource.sourceId, String(binding.outcomeKey)),
          eq(workbenchThreadSource.role, "root"),
        )).limit(2)
      const resources = await transaction.select().from(projectResource).where(and(
          eq(projectResource.userId, userId), eq(projectResource.projectId, Number(binding.projectId)),
          eq(projectResource.type, "repo"), eq(projectResource.relationship, "primary-repo"),
      )).limit(2)
      const world = worlds[0] ? validateWorkingWorld(JSON.parse(worlds[0].snapshot)) : null
      const worldRepositories = world ? await resolveSpaceRepositoryIdentities(world.resources) : []
      const outcome = outcomes[0]
      const persistedGoal = goals[0]
      const implementationGrant = implementationGrants[0]
      const queueGrant = queueGrants[0]
      const implementationLive = implementationGrant
        ? isGrantActive(authorityGrantFactsFromNormalizedRow(implementationGrant)).ok
          && grantCovers(authorityGrantFactsFromNormalizedRow(implementationGrant), "A2_WRITE_OWN").ok
        : false
      const queueLive = queueGrant
        ? isGrantActive(authorityGrantFactsFromNormalizedRow(queueGrant)).ok
          && grantCovers(authorityGrantFactsFromNormalizedRow(queueGrant), "A2_WRITE_OWN", "outcome:execute").ok
        : false
      if (!world || world.spine.projectId !== Number(binding.projectId)
        || world.spine.projectName !== String(binding.projectName)
        || world.spine.threadId !== String(binding.threadId)
        || world.spine.outcomeKey !== String(binding.outcomeKey)
        || world.spine.workOrderId !== Number(binding.workOrderId)
        || worldRepositories.length !== 1 || worldRepositories[0] !== packet.repository
        || receipt.outcomeKey !== String(binding.outcomeKey)
        || binding.worldId !== input.worldId || binding.provenanceDigest !== provenanceDigest
        || binding.source !== packet.source || binding.externalRef !== packet.externalRef
        || binding.repository !== packet.repository
        || binding.goalRef !== refs.goal || binding.decisionRef !== refs.decision
        || persistedGoal?.ref !== refs.goal || persistedGoal?.status !== "converted"
        || persistedGoal?.linkedWorkOrderId !== Number(binding.workOrderId)
        || !exactStrings(persistedGoal?.acceptedContractIds, [EXTERNAL_WORK_ORDER_ADMISSION_VERSION])
        || outcome?.lifecycleState !== "active" || outcome?.activeWorkOrderId !== Number(binding.workOrderId)
        || outcome?.goalId !== Number(binding.goalId) || outcome?.goalRef !== refs.goal
        || outcome?.approvalDecisionId !== Number(binding.approvalDecisionId)
        || !exactStrings(outcome?.acceptedContractIds, [EXTERNAL_WORK_ORDER_ADMISSION_VERSION])
        || outcome?.approvalState !== "approved" || outcome?.approvedBy !== userId
        || outcome?.authorityState !== "matched" || outcome?.authorityLevel !== "A2_WRITE_OWN"
        || outcome?.authorityGrantRef !== String(binding.queueGrantRef)
        || outcome?.authoritySubject !== "operator" || outcome?.authorityAction !== "outcome:execute"
        || outcome?.executionBinding !== `space-external:${provenanceDigest}`
        || outcome?.leaseHolder !== `space:${input.worldId}`
        || outcome?.leaseToken !== hashRecord({
          provenanceDigest, worldId: input.worldId, workOrderId: Number(binding.workOrderId),
        })
        || outcome?.acquisitionKey !== String(binding.acquisitionKey) || outcome?.fencingToken !== 1
        || outcome?.version !== 1
        || works[0]?.status !== "active" || works[0]?.ref !== String(binding.workOrderRef)
        || works[0]?.ref !== refs.workOrder || works[0]?.agent !== "codex"
        || works[0]?.authorityLevel !== "A2_WRITE_OWN"
        || works[0]?.authorityGranted !== "A2_WRITE_OWN"
        || works[0]?.linkedDecisionId !== Number(binding.approvalDecisionId)
        || works[0]?.goal !== refs.goal || !exactStrings(works[0]?.evidence, workOrderEvidence)
        || works[0]?.authorityGrantId !== Number(binding.implementationGrantId)
        || !implementationLive || implementationGrant?.workOrderId !== Number(binding.workOrderId)
        || implementationGrant?.grantedTo !== "codex"
        || implementationGrant?.ref !== String(binding.implementationGrantRef)
        || !queueLive || queueGrant?.workOrderId !== Number(binding.workOrderId)
        || queueGrant?.grantedTo !== "operator" || queueGrant?.scope !== String(binding.outcomeKey)
        || queueGrant?.ref !== String(binding.queueGrantRef)
        || !exactStrings(queueGrant?.allowedActions, ["outcome:execute"])
        || acquisitionReceipts[0]?.outcomeKey !== String(binding.outcomeKey)
        || acquisitionReceipts[0]?.firstFencingToken !== 1
        || acquisitionReceipts[0]?.latestFencingToken !== outcome?.fencingToken
        || approvals[0]?.status !== "accepted" || approvals[0]?.locked !== true
        || approvals[0]?.ref !== refs.decision || approvals[0]?.decision !== "APPROVE"
        || approvals[0]?.authority !== "binding" || approvals[0]?.owner !== userId
        || approvals[0]?.scope !== refs.outcome || !exactStrings(approvals[0]?.evidence, decisionEvidence)
        || projects[0]?.lifecycle !== "active" || projects[0]?.name !== String(binding.projectName)
        || threads[0]?.projectId !== Number(binding.projectId) || roots.length !== 1
        || resources.length !== 1 || resources[0]?.canonicalIdentity !== packet.repository
        || !exactStrings(works[0]?.allowedFiles, packet.reservedPaths)
        || !exactStrings(implementationGrant?.allowedActions, packet.reservedPaths)
        || !exactStrings(works[0]?.forbiddenFiles, packet.forbiddenPaths.length
          ? packet.forbiddenPaths : FIXED_BLOCKED_ACTIONS)
        || !exactStrings(implementationGrant?.blockedActions, packet.forbiddenPaths.length
          ? packet.forbiddenPaths : FIXED_BLOCKED_ACTIONS)) {
        throw new ExternalWorkOrderAdmissionError("PERSISTED_BINDING_INVALID")
      }
      return {
        result: resultFromBinding("ALREADY_ADMITTED", true, binding),
        grants: [implementationGrant, queueGrant] as const,
      }
    }

    const worlds = await transaction.select({ snapshot: workingWorld.snapshot, intent: workingWorld.intent })
      .from(workingWorld).where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, input.worldId)))
      .limit(1).for("update")
    if (worlds.length !== 1) throw new ExternalWorkOrderAdmissionError("WORLD_NOT_FOUND")
    const world = validateWorkingWorld(JSON.parse(worlds[0].snapshot))
    if (world.spine.outcomeKey !== null || world.spine.workOrderId !== null) {
      throw new ExternalWorkOrderAdmissionError("SPACE_ALREADY_BOUND")
    }
    const repositoryIdentities = await resolveSpaceRepositoryIdentities(world.resources)
    if (repositoryIdentities.length !== 1 || repositoryIdentities[0] !== packet.repository) {
      throw new ExternalWorkOrderAdmissionError("PROJECT_REPOSITORY_MISMATCH")
    }
    const projects = await transaction.select({ id: project.id, name: project.name, lifecycle: project.lifecycle })
      .from(project).innerJoin(projectResource, and(
        eq(projectResource.userId, project.userId), eq(projectResource.projectId, project.id),
      )).where(and(
        eq(project.userId, userId), eq(project.lifecycle, "active"),
        eq(projectResource.type, "repo"), eq(projectResource.relationship, "primary-repo"),
        eq(projectResource.canonicalIdentity, packet.repository),
      )).limit(2)
    if (projects.length !== 1) throw new ExternalWorkOrderAdmissionError("PROJECT_REPOSITORY_MISMATCH")
    const active = await transaction.select({ id: outcomeQueueItem.id }).from(outcomeQueueItem).where(and(
      eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.lifecycleState, "active"),
    )).limit(1)
    if (active.length > 0) throw new ExternalWorkOrderAdmissionError("ACTIVE_OUTCOME_CONFLICT")
    const priorExternal = await transaction.select({ resultBinding: outcomeQueueMutationReceipt.resultBinding })
      .from(outcomeQueueMutationReceipt).where(and(
        eq(outcomeQueueMutationReceipt.userId, userId),
        eq(outcomeQueueMutationReceipt.operation, EXTERNAL_WORK_ORDER_ADMISSION_OPERATION),
      ))
    if (priorExternal.some((row) => {
      const prior = row.resultBinding as Record<string, unknown>
      return prior?.provenanceDigest === provenanceDigest
        || (prior?.source === packet.source && prior?.externalRef === packet.externalRef
          && prior?.repository === packet.repository)
    })) {
      throw new ExternalWorkOrderAdmissionError("EXTERNAL_WORK_ORDER_ALREADY_ADMITTED")
    }

    const nowRows = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const admittedAt = new Date(nowRows.rows[0]?.now as Date | string)
    const expiresAt = new Date(admittedAt.getTime() + GRANT_HOURS * 60 * 60 * 1000)
    const [createdGoal] = await transaction.insert(goal).values({
      userId, ref: refs.goal, command: packet.objective, lane: "external-work-order",
      mode: "implement", risk: "R1", authority: "A2_WRITE_OWN", verdict: "requires_approval",
      rationale: `Owner-admitted external Work Order ${packet.externalRef}.`, requiresApproval: true,
      status: "converted", acceptedContractIds: [EXTERNAL_WORK_ORDER_ADMISSION_VERSION],
      recommendedMove: "Execute only through the bound Space and exact reservation.",
      createdAt: admittedAt, updatedAt: admittedAt,
    }).returning({ id: goal.id })
    const [approval] = await transaction.insert(decision).values({
      userId, ref: refs.decision, title: `Admit external Work Order ${packet.externalRef}`,
      context: JSON.stringify({ worldId: input.worldId, externalRef: packet.externalRef, provenanceDigest }),
      decision: "APPROVE", rationale: "Authenticated owner explicitly admitted the immutable external packet.",
      consequences: "Authority is limited to the exact Space, repository, Work Order, and reservations.",
      status: "accepted", authority: "binding", owner: userId, scope: refs.outcome,
      evidence: decisionEvidence,
      tags: ["external-work-order", packet.source], locked: true,
      decidedAt: admittedAt, createdAt: admittedAt, updatedAt: admittedAt,
    }).returning({ id: decision.id })
    const [createdWork] = await transaction.insert(workOrder).values({
      userId, ref: refs.workOrder, title: packet.title, description: packet.objective,
      goal: refs.goal, scope: packet.objective, lane: "external-work-order", status: "draft",
      assignee: "space-owner", agent: "codex", allowedFiles: [...packet.reservedPaths],
      forbiddenFiles: packet.forbiddenPaths.length ? [...packet.forbiddenPaths] : [...FIXED_BLOCKED_ACTIONS],
      validators: [...packet.validators], acceptanceCriteria: [...packet.acceptanceCriteria],
      stopConditions: ["Stop on authority, reservation, task-digest, review, or delivery-seal mismatch."],
      authorityLevel: "A2_WRITE_OWN", linkedDecisionId: approval.id,
      evidence: workOrderEvidence,
      createdAt: admittedAt, updatedAt: admittedAt,
    }).returning({ id: workOrder.id })
    await transaction.update(goal).set({ linkedWorkOrderId: createdWork.id, updatedAt: admittedAt })
      .where(and(eq(goal.userId, userId), eq(goal.id, createdGoal.id)))

    for (const to of ["proposed", "approved"] as const) {
      const transitioned = await transitionWorkOrderInTransaction({
        transaction, userId, workOrderId: createdWork.id, to, now: admittedAt,
        grantAuthority: to === "approved", grantExpiresAt: expiresAt,
      })
      if (!transitioned.ok) throw new ExternalWorkOrderAdmissionError("WORK_ORDER_GOVERNANCE_REFUSED")
    }
    const activated = await transitionWorkOrderInTransaction({
      transaction, userId, workOrderId: createdWork.id, to: "active", now: admittedAt,
      approveDoctrine: true,
    })
    if (!activated.ok) {
      throw new ExternalWorkOrderAdmissionError(
        activated.verdict?.verdict === "forbidden" ? "DOCTRINE_FORBIDDEN" : "WORK_ORDER_GOVERNANCE_REFUSED",
      )
    }
    const implementationGrantId = activated.workOrder.authorityGrantId
    if (!implementationGrantId) throw new ExternalWorkOrderAdmissionError("PERSISTED_BINDING_INVALID")
    const [implementationGrant] = await transaction.select().from(authorityGrant).where(and(
      eq(authorityGrant.userId, userId), eq(authorityGrant.id, implementationGrantId),
    )).limit(1)
    if (!implementationGrant) throw new ExternalWorkOrderAdmissionError("PERSISTED_BINDING_INVALID")
    const queueGrant = (await createAuthorityGrantInTransaction(transaction, userId, {
      workOrderId: createdWork.id, bindToWorkOrder: false, grantedTo: "operator",
      authorityLevel: "A2_WRITE_OWN", scope: refs.outcome, allowedActions: ["outcome:execute"],
      blockedActions: FIXED_BLOCKED_ACTIONS,
      reason: `External Work Order admission ${provenanceDigest}.`, expiresAt,
    }, admittedAt)).grant

    const threadId = randomUUID()
    await transaction.insert(workbenchThread).values({
      id: threadId, userId, projectId: projects[0].id, title: packet.title,
      createdAt: admittedAt, updatedAt: admittedAt,
    })
    await transaction.insert(workbenchThreadSource).values({
      userId, threadId, sourceType: "outcome", sourceId: refs.outcome, role: "root", createdAt: admittedAt,
    })
    const leaseToken = hashRecord({ provenanceDigest, worldId: input.worldId, workOrderId: createdWork.id })
    const executionBinding = `space-external:${provenanceDigest}`
    const acquisitionKey = `external:${provenanceDigest}`
    await transaction.insert(outcomeQueueItem).values({
      userId, outcomeKey: refs.outcome, goalId: createdGoal.id, goalRef: refs.goal,
      title: packet.title, objective: packet.objective, acceptedContractIds: [EXTERNAL_WORK_ORDER_ADMISSION_VERSION],
      riskClass: "R1", approvalState: "approved", approvedBy: userId, approvedAt: admittedAt,
      approvalDecisionId: approval.id, authorityState: "matched", authorityLevel: "A2_WRITE_OWN",
      authorityGrantRef: queueGrant.ref, authoritySubject: "operator", authorityAction: "outcome:execute",
      lifecycleState: "active", lifecycleReason: "OWNER_ADMITTED_EXTERNAL_WORK_ORDER",
      activeWorkOrderId: createdWork.id, executionBinding, leaseHolder: `space:${input.worldId}`,
      leaseToken, leaseExpiresAt: expiresAt, fencingToken: 1, version: 1,
      acquisitionKey, activatedAt: admittedAt,
      suggestedAt: admittedAt, createdAt: admittedAt, updatedAt: admittedAt,
    })
    await transaction.insert(outcomeQueueAcquisitionReceipt).values({
      userId, acquisitionKey, outcomeKey: refs.outcome,
      firstFencingToken: 1, latestFencingToken: 1, createdAt: admittedAt, updatedAt: admittedAt,
    })
    const bound = validateWorkingWorld(withBoundOutcome(world, {
      projectId: projects[0].id, projectName: projects[0].name, threadId,
      outcomeKey: refs.outcome, outcomeTitle: packet.title, activeWorkOrderId: createdWork.id,
    }))
    await transaction.update(workingWorld).set({
      snapshot: JSON.stringify(bound), intent: bound.intent, updatedAt: admittedAt,
    }).where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, input.worldId)))

    const resultBinding = {
      worldId: input.worldId, projectId: projects[0].id, projectName: projects[0].name,
      threadId, goalId: createdGoal.id, goalRef: refs.goal,
      outcomeKey: refs.outcome, workOrderId: createdWork.id, workOrderRef: refs.workOrder,
      source: packet.source, externalRef: packet.externalRef, repository: packet.repository,
      approvalDecisionId: approval.id, decisionRef: refs.decision,
      queueGrantId: queueGrant.id, queueGrantRef: queueGrant.ref,
      implementationGrantId: implementationGrant.id, implementationGrantRef: implementationGrant.ref,
      acquisitionKey,
      reservedPaths: [...packet.reservedPaths], forbiddenPaths: [...implementationGrant.blockedActions],
      doctrineVerdict: activated.doctrineVerdict?.verdict ?? "unspecified",
      provenanceDigest, admittedAt: admittedAt.toISOString(), expiresAt: expiresAt.toISOString(),
    }
    await transaction.insert(outcomeQueueMutationReceipt).values({
      userId, idempotencyKey: input.idempotencyKey, operation: EXTERNAL_WORK_ORDER_ADMISSION_OPERATION,
      outcomeKey: refs.outcome, requestHash, requestBinding: { ...input, provenanceDigest },
      resultBinding, createdAt: admittedAt,
    })
    await transaction.insert(governanceEvent).values([
      {
        userId, ref: `GEV-${refs.decision}`, eventType: "EXTERNAL_WORK_ORDER_ADMITTED",
        entityType: "work_order", entityId: String(createdWork.id), actor: userId,
        reason: "Owner admitted an immutable external Work Order packet into an owned Space.",
        afterHash: hashRecord(resultBinding), metadata: resultBinding, createdAt: admittedAt,
      },
    ])
    await transaction.insert(eventLog).values([
      {
        userId, type: "space.external_work_order.admitted",
        summary: `${refs.workOrder}: admitted ${packet.externalRef} into Space ${input.worldId}`,
        register: "work-orders", refId: createdWork.id,
        metadata: { worldId: input.worldId, outcomeKey: refs.outcome, provenanceDigest }, createdAt: admittedAt,
      },
    ])
    return {
      result: resultFromBinding("ADMITTED", false, resultBinding),
      grants: [implementationGrant, queueGrant] as const,
    }
  })
  // Git-backed authority exports are derived, best-effort evidence. Persist the
  // canonical graph atomically first, then export both grants; exact replay
  // retries the exports without changing the database binding.
  await Promise.allSettled(committed.grants.map((grant) => writeAuthorityGrantArtifact(grant)))
  return committed.result
}
