import { hashRecord } from "@/lib/governance/hash"

export const WORKBENCH_OUTCOME_START_CONTRACT_VERSION = 1 as const

export type StartWorkbenchOutcomeInput = Readonly<{
  projectId: number
  intent: string
  idempotencyKey: string
}>

export type NormalizedOutcomeStartInput = Readonly<{
  projectId: number
  intent: string
  idempotencyKey: string
}>

type PersistedWorkbenchOutcomeStartEffects = Readonly<{
  intakeTruth: "persisted"
  approvalGrantedByIntake: false
  authorityGrantedByIntake: false
  executionAuthorizedByIntake: false
}>

export type AcceptedWorkbenchOutcomeStart = PersistedWorkbenchOutcomeStartEffects & Readonly<{
  status: "ACCEPTED" | "ALREADY_ACCEPTED"
  projectId: number
  threadId: string
  goalId: number
  outcomeKey: string
  root: Readonly<{ sourceType: "outcome"; sourceId: string }>
  ownershipTruth: "project_thread_bound"
}>

export type RefusedWorkbenchOutcomeStart = PersistedWorkbenchOutcomeStartEffects & Readonly<{
  status: "REFUSED"
  projectId: number
  threadId: null
  goalId: number
  outcomeKey: null
  root: null
  ownershipTruth: "unavailable"
}>

export type FailedWorkbenchOutcomeStart = Readonly<{
  status: "CONFLICT" | "INVALID_INTENT" | "PROJECT_NOT_FOUND"
  reason:
    | "IDEMPOTENCY_CONFLICT"
    | "CONTRACT_SINGLETON_CONFLICT"
    | "ROUTE_NOT_START_OUTCOME"
    | "PROJECT_NOT_FOUND"
  projectId: number
  threadId: null
  goalId: null
  outcomeKey: null
  root: null
  intakeTruth: "unknown"
  ownershipTruth: "unavailable"
  approvalGrantedByIntake: false
  authorityGrantedByIntake: false
  executionAuthorizedByIntake: false
}>

export type StartWorkbenchOutcomeResult =
  | AcceptedWorkbenchOutcomeStart
  | RefusedWorkbenchOutcomeStart
  | FailedWorkbenchOutcomeStart

export function normalizeOutcomeStartInput(
  input: StartWorkbenchOutcomeInput,
): NormalizedOutcomeStartInput {
  const intent = typeof input?.intent === "string" ? input.intent.trim() : ""
  const idempotencyKey = typeof input?.idempotencyKey === "string"
    ? input.idempotencyKey.trim()
    : ""
  if (
    !Number.isSafeInteger(input?.projectId)
    || input.projectId <= 0
    || intent.length === 0
    || intent.length > 2_000
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)
  ) {
    throw new Error("WORKBENCH_OUTCOME_START_INPUT_INVALID")
  }
  return { projectId: input.projectId, intent, idempotencyKey }
}

export function buildOutcomeStartRequestHash(input: StartWorkbenchOutcomeInput): string {
  const normalized = normalizeOutcomeStartInput(input)
  return hashRecord({
    contractVersion: WORKBENCH_OUTCOME_START_CONTRACT_VERSION,
    projectId: normalized.projectId,
    intent: normalized.intent,
    idempotencyKey: normalized.idempotencyKey,
  })
}

export function buildOutcomeStartResultDigest(input: Readonly<{
  requestHash: string
  goalId: number
  outcomeKey: string
  threadId: string
  rootSourceType: "outcome"
  rootSourceId: string
  acceptedContractIds?: readonly string[]
}>): string {
  const payload = {
    contractVersion: WORKBENCH_OUTCOME_START_CONTRACT_VERSION,
    requestHash: input.requestHash,
    goalId: input.goalId,
    outcomeKey: input.outcomeKey,
    threadId: input.threadId,
    root: { sourceType: input.rootSourceType, sourceId: input.rootSourceId },
    ...(input.acceptedContractIds?.length
      ? { acceptedContractIds: [...input.acceptedContractIds] }
      : {}),
  }
  return hashRecord(payload)
}

export function buildRefusedOutcomeStartResultDigest(input: Readonly<{
  requestHash: string
  goalId: number
  refusedBinding: string
  acceptedContractIds?: readonly string[]
}>): string {
  const payload = {
    contractVersion: WORKBENCH_OUTCOME_START_CONTRACT_VERSION,
    requestHash: input.requestHash,
    goalId: input.goalId,
    outcomeKey: input.refusedBinding,
    threadId: null,
    root: null,
    status: "REFUSED",
    ...(input.acceptedContractIds?.length
      ? { acceptedContractIds: [...input.acceptedContractIds] }
      : {}),
  }
  return hashRecord(payload)
}
