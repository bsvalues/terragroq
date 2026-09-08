import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  outcomeQueueMutationReceipt,
  project,
  projectResource,
  workingWorld,
} from "@/lib/db/schema"
import { resolveSpaceRepositoryIdentities } from "@/lib/environment/space-outcome-assimilation"
import { validateWorkingWorld } from "@/lib/environment/working-world"
import { hashRecord } from "@/lib/governance/hash"
import {
  EXTERNAL_PARENT_MISSION_BINDING_VERSION,
  EXTERNAL_PARENT_MISSION_BIND_OPERATION,
  EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION,
  EXTERNAL_PARENT_MISSION_TERMINAL_VERSION,
  compareCanonicalStrings,
  isCanonicalGitHubRepositoryIdentity,
  isCanonicalNonemptyStringArray,
} from "@/lib/outcome-queue/contract.mjs"

export {
  EXTERNAL_PARENT_MISSION_BINDING_VERSION,
  EXTERNAL_PARENT_MISSION_BIND_OPERATION,
  EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION,
  EXTERNAL_PARENT_MISSION_TERMINAL_VERSION,
}

export type ExternalParentMission = Readonly<{
  source: "github"
  repository: string
  externalRef: string
  issueNumber: number
  goalRef: string
  loopRef: string
  objective: string
  terminalConditions: readonly string[]
  authorityEvidence: readonly string[]
}>

export type ExternalParentMissionAdmissionInput = Readonly<{
  mode: "ADMIT"
  worldId: string
  idempotencyKey: string
  confirmation: "ADMIT_EXTERNAL_PARENT_MISSION"
  confirmedProvenanceDigest: string
  externalParentMission: ExternalParentMission
}>

export type ExternalParentMissionPreviewInput = Readonly<{
  mode: "PREVIEW"
  worldId: string
  externalParentMission: ExternalParentMission
}>

export type ExternalParentMissionTerminalInput = Readonly<{
  mode: "TERMINAL"
  missionKey: string
  bindReceiptId: number
  bindReceiptHash: string
  terminalState: "SATISFIED" | "REVOKED"
  terminalEvidenceRefs: readonly string[]
  idempotencyKey: string
}>

export type ExternalParentMissionBinding = Readonly<{
  version: typeof EXTERNAL_PARENT_MISSION_BINDING_VERSION
  source: "github"
  repository: string
  externalRef: string
  issueNumber: number
  goalRef: string
  projectId: number
  objectiveDigest: string
  missionKey: string
}>

export type ExternalParentMissionAdmissionSuccess = Readonly<{
  status: "ADMITTED" | "ALREADY_ADMITTED"
  replayed: boolean
  receiptId: number
  bindReceiptHash: string
  binding: ExternalParentMissionBinding
  worldId: string
  repositoryResourceId: number
  loopRef: string
  terminalConditionsDigest: string
  provenanceDigest: string
}>

export type ExternalParentMissionTerminalSuccess = Readonly<{
  status: "TERMINAL_RECORDED" | "ALREADY_TERMINAL"
  replayed: boolean
  receiptId: number
  missionKey: string
  bindReceiptId: number
  bindReceiptHash: string
  terminalState: "SATISFIED" | "REVOKED"
  terminalEvidenceDigest: string
  terminalAt: string
}>

export type ExternalParentMissionState = Readonly<{
  integrity: "VERIFIED" | "BINDING_REQUIRED"
  unresolved: readonly Readonly<{
    missionKey: string
    externalRef: string
    goalRef: string
    worldId: string
    projectId: number
    repository: string
  }>[]
  resolved: readonly Readonly<{
    missionKey: string
    externalRef: string
    goalRef: string
    worldId: string
    projectId: number
    repository: string
    terminalState: string
  }>[]
}>

export type ExternalParentMissionAdmissionFailureCode =
  | "IDEMPOTENCY_CONFLICT"
  | "CONFIRMATION_STALE"
  | "WORLD_NOT_FOUND"
  | "PROJECT_REPOSITORY_MISMATCH"
  | "PARENT_MISSION_ALREADY_BOUND"
  | "PARENT_MISSION_BINDING_INVALID"
  | "PARENT_MISSION_AUTHORITY_REVOKED"
  | "PARENT_MISSION_ALREADY_TERMINAL"
  | "PARENT_MISSION_TERMINAL_EVIDENCE_UNVERIFIED"

export class ExternalParentMissionAdmissionError extends Error {
  constructor(public readonly code: ExternalParentMissionAdmissionFailureCode) {
    super(code)
    this.name = "ExternalParentMissionAdmissionError"
  }
}

type ReceiptLike = Readonly<{
  id: number
  userId: string
  idempotencyKey: string
  operation: string
  outcomeKey: string | null
  requestHash: string
  requestBinding: unknown
  resultBinding: unknown
  createdAt: Date
}>

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], error: string): void {
  const keys = new Set(allowed)
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error(error)
}

function text(value: unknown, error: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(error)
  }
  return value.trim()
}

function strings(value: unknown, error: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) throw new Error(error)
  const normalized = value.map((entry) => text(entry, error, maxLength))
  const unique = [...new Set(normalized)].sort(compareCanonicalStrings)
  if (unique.length !== normalized.length) throw new Error(error)
  if (!isCanonicalNonemptyStringArray(unique)) throw new Error(error)
  return unique
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactRecord(left: unknown, right: unknown): boolean {
  return hashRecord(left) === hashRecord(right)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
}

function normalizeRepository(value: unknown): string {
  const repository = text(value, "EXTERNAL_PARENT_MISSION_INVALID", 200)
    .replace(/\.git$/i, "")
    .toLowerCase()
  if (!isCanonicalGitHubRepositoryIdentity(repository)) {
    throw new Error("EXTERNAL_PARENT_MISSION_INVALID")
  }
  return repository
}

export function normalizeExternalParentMission(raw: unknown): ExternalParentMission {
  const input = record(raw)
  if (!input) throw new Error("EXTERNAL_PARENT_MISSION_INVALID")
  exactKeys(input, [
    "source", "repository", "externalRef", "issueNumber", "goalRef", "loopRef", "objective",
    "terminalConditions", "authorityEvidence",
  ], "EXTERNAL_PARENT_MISSION_INVALID")
  if (input.source !== "github" || !Number.isSafeInteger(input.issueNumber) || Number(input.issueNumber) <= 0) {
    throw new Error("EXTERNAL_PARENT_MISSION_INVALID")
  }
  const repository = normalizeRepository(input.repository)
  const issueNumber = Number(input.issueNumber)
  const externalRef = text(input.externalRef, "EXTERNAL_PARENT_MISSION_INVALID", 300)
  if (externalRef !== `github:${repository}#${issueNumber}`) throw new Error("EXTERNAL_PARENT_MISSION_INVALID")
  return {
    source: "github",
    repository,
    externalRef,
    issueNumber,
    goalRef: text(input.goalRef, "EXTERNAL_PARENT_MISSION_INVALID", 200),
    loopRef: text(input.loopRef, "EXTERNAL_PARENT_MISSION_INVALID", 200),
    objective: text(input.objective, "EXTERNAL_PARENT_MISSION_INVALID", 4_000),
    terminalConditions: strings(input.terminalConditions, "EXTERNAL_PARENT_MISSION_INVALID", 32, 500),
    authorityEvidence: strings(input.authorityEvidence, "EXTERNAL_PARENT_MISSION_INVALID", 16, 500),
  }
}

export function externalParentMissionProvenanceDigest(mission: ExternalParentMission): string {
  return hashRecord({ version: EXTERNAL_PARENT_MISSION_BINDING_VERSION, externalParentMission: mission })
}

export function externalParentMissionIdentity(mission: ExternalParentMission): string {
  return `external-parent:${hashRecord({
    version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
    source: mission.source,
    repository: mission.repository,
    externalRef: mission.externalRef,
    issueNumber: mission.issueNumber,
    goalRef: mission.goalRef,
  })}`
}

export function previewExternalParentMissionAdmission(raw: unknown) {
  const input = record(raw)
  if (!input) throw new Error("REQUEST_FIELDS_INVALID")
  exactKeys(input, ["mode", "worldId", "externalParentMission"], "REQUEST_FIELDS_INVALID")
  if (input.mode !== "PREVIEW") throw new Error("REQUEST_FIELDS_INVALID")
  const worldId = text(input.worldId, "REQUEST_FIELDS_INVALID", 200)
  const externalParentMission = normalizeExternalParentMission(input.externalParentMission)
  return {
    status: "READY_FOR_CONFIRMATION" as const,
    worldId,
    missionKey: externalParentMissionIdentity(externalParentMission),
    provenanceDigest: externalParentMissionProvenanceDigest(externalParentMission),
    externalParentMission,
  }
}

export function normalizeExternalParentMissionAdmissionInput(raw: unknown): ExternalParentMissionAdmissionInput {
  const input = record(raw)
  if (!input) throw new Error("REQUEST_FIELDS_INVALID")
  exactKeys(input, [
    "mode", "worldId", "idempotencyKey", "confirmation", "confirmedProvenanceDigest",
    "externalParentMission",
  ], "REQUEST_FIELDS_INVALID")
  if (input.mode !== "ADMIT") throw new Error("REQUEST_FIELDS_INVALID")
  const worldId = text(input.worldId, "REQUEST_FIELDS_INVALID", 200)
  const idempotencyKey = text(input.idempotencyKey, "REQUEST_FIELDS_INVALID", 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) throw new Error("REQUEST_FIELDS_INVALID")
  if (input.confirmation !== "ADMIT_EXTERNAL_PARENT_MISSION"
    || typeof input.confirmedProvenanceDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(input.confirmedProvenanceDigest)) {
    throw new Error("CONFIRMATION_REQUIRED")
  }
  const externalParentMission = normalizeExternalParentMission(input.externalParentMission)
  if (input.confirmedProvenanceDigest !== externalParentMissionProvenanceDigest(externalParentMission)) {
    throw new ExternalParentMissionAdmissionError("CONFIRMATION_STALE")
  }
  return {
    mode: "ADMIT",
    worldId,
    idempotencyKey,
    confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
    confirmedProvenanceDigest: input.confirmedProvenanceDigest,
    externalParentMission,
  }
}

export function normalizeExternalParentMissionTerminalInput(raw: unknown): ExternalParentMissionTerminalInput {
  const input = record(raw)
  if (!input) throw new Error("REQUEST_FIELDS_INVALID")
  exactKeys(input, [
    "mode", "missionKey", "bindReceiptId", "bindReceiptHash", "terminalState",
    "terminalEvidenceRefs", "idempotencyKey",
  ], "REQUEST_FIELDS_INVALID")
  if (input.mode !== "TERMINAL") throw new Error("REQUEST_FIELDS_INVALID")
  const missionKey = text(input.missionKey, "REQUEST_FIELDS_INVALID", 200)
  const idempotencyKey = text(input.idempotencyKey, "REQUEST_FIELDS_INVALID", 200)
  if (!/^external-parent:[0-9a-f]{64}$/.test(missionKey)
    || !Number.isSafeInteger(input.bindReceiptId) || Number(input.bindReceiptId) <= 0
    || typeof input.bindReceiptHash !== "string" || !/^[0-9a-f]{64}$/.test(input.bindReceiptHash)
    || (input.terminalState !== "SATISFIED" && input.terminalState !== "REVOKED")
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) {
    throw new Error("REQUEST_FIELDS_INVALID")
  }
  return {
    mode: "TERMINAL",
    missionKey,
    bindReceiptId: Number(input.bindReceiptId),
    bindReceiptHash: input.bindReceiptHash,
    terminalState: input.terminalState,
    terminalEvidenceRefs: strings(input.terminalEvidenceRefs, "REQUEST_FIELDS_INVALID", 64, 1_000),
    idempotencyKey,
  }
}

function terminalRequestBinding(input: ExternalParentMissionTerminalInput) {
  return {
    version: EXTERNAL_PARENT_MISSION_TERMINAL_VERSION,
    missionKey: input.missionKey,
    bindReceiptId: input.bindReceiptId,
    bindReceiptHash: input.bindReceiptHash,
    terminalState: input.terminalState,
    terminalEvidenceRefs: [...input.terminalEvidenceRefs],
    idempotencyKey: input.idempotencyKey,
  }
}

function canonicalRequestBinding(input: ExternalParentMissionAdmissionInput) {
  const provenanceDigest = externalParentMissionProvenanceDigest(input.externalParentMission)
  const missionKey = externalParentMissionIdentity(input.externalParentMission)
  return {
    version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
    worldId: input.worldId,
    idempotencyKey: input.idempotencyKey,
    confirmation: input.confirmation,
    confirmedProvenanceDigest: input.confirmedProvenanceDigest,
    externalParentMission: input.externalParentMission,
    provenanceDigest,
    missionKey,
  }
}

function resultFromReceipt(receipt: ReceiptLike, replayed: boolean): ExternalParentMissionAdmissionSuccess {
  const result = receipt.resultBinding as Record<string, unknown>
  return {
    status: replayed ? "ALREADY_ADMITTED" : "ADMITTED",
    replayed,
    receiptId: receipt.id,
    bindReceiptHash: externalParentMissionBindReceiptHash(receipt),
    binding: result.binding as ExternalParentMissionBinding,
    worldId: String(result.worldId),
    repositoryResourceId: Number(result.repositoryResourceId),
    loopRef: String(result.loopRef),
    terminalConditionsDigest: String(result.terminalConditionsDigest),
    provenanceDigest: String(result.provenanceDigest),
  }
}

export function externalParentMissionBindReceiptHash(receipt: Pick<ReceiptLike,
  "operation" | "outcomeKey" | "requestHash" | "requestBinding" | "resultBinding">): string {
  return hashRecord({
    operation: receipt.operation,
    outcomeKey: receipt.outcomeKey,
    requestHash: receipt.requestHash,
    requestBinding: receipt.requestBinding,
    resultBinding: receipt.resultBinding,
  })
}

function validBindReceipt(receipt: ReceiptLike): boolean {
  const request = record(receipt.requestBinding)
  const result = record(receipt.resultBinding)
  const binding = record(result?.binding)
  if (!request || !result || !binding) return false
  const mission = (() => {
    try { return normalizeExternalParentMission(request.externalParentMission) } catch { return null }
  })()
  if (!mission) return false
  const provenanceDigest = externalParentMissionProvenanceDigest(mission)
  const missionKey = externalParentMissionIdentity(mission)
  const canonicalBinding = {
    version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
    source: mission.source,
    repository: mission.repository,
    externalRef: mission.externalRef,
    issueNumber: mission.issueNumber,
    goalRef: mission.goalRef,
    projectId: Number(binding.projectId),
    objectiveDigest: hashRecord(mission.objective),
    missionKey,
  }
  return receipt.operation === EXTERNAL_PARENT_MISSION_BIND_OPERATION
    && hasExactKeys(request, [
      "version", "worldId", "idempotencyKey", "confirmation", "confirmedProvenanceDigest",
      "externalParentMission", "provenanceDigest", "missionKey",
    ])
    && hasExactKeys(result, [
      "binding", "worldId", "repositoryResourceId", "loopRef", "terminalConditionsDigest",
      "authorityEvidenceDigest", "authorityEvidenceRole", "provenanceDigest", "state", "admittedBy",
      "authorityProvenance", "admittedAt",
    ])
    && receipt.outcomeKey === missionKey
    && request.version === EXTERNAL_PARENT_MISSION_BINDING_VERSION
    && request.provenanceDigest === provenanceDigest
    && request.missionKey === missionKey
    && request.confirmation === "ADMIT_EXTERNAL_PARENT_MISSION"
    && request.confirmedProvenanceDigest === provenanceDigest
    && receipt.requestHash === hashRecord(request)
    && exactRecord(binding, canonicalBinding)
    && result.worldId === request.worldId
    && result.loopRef === mission.loopRef
    && result.terminalConditionsDigest === hashRecord(mission.terminalConditions)
    && result.authorityEvidenceDigest === hashRecord(mission.authorityEvidence)
    && result.authorityEvidenceRole === "SUPPORTING_ONLY"
    && result.provenanceDigest === provenanceDigest
    && result.state === "ACTIVE"
    && result.admittedBy === receipt.userId
    && exactRecord(result.authorityProvenance, {
      kind: "AUTHENTICATED_CONFIGURED_OWNER_ADMISSION",
      ownerUserId: result.admittedBy,
      confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
      provenanceDigest,
    })
    && typeof result.admittedAt === "string"
    && Number.isFinite(Date.parse(result.admittedAt))
    && Number.isSafeInteger(Number(result.repositoryResourceId))
    && Number(result.repositoryResourceId) > 0
}

function terminalState(receipt: ReceiptLike, bind: ReceiptLike): string | null {
  const request = record(receipt.requestBinding)
  const result = record(receipt.resultBinding)
  if (!request || !result || receipt.operation !== EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION
    || !hasExactKeys(request, [
      "version", "missionKey", "bindReceiptId", "bindReceiptHash", "terminalState",
      "terminalEvidenceRefs", "idempotencyKey",
    ])
    || !hasExactKeys(result, [
      "version", "missionKey", "bindReceiptId", "bindReceiptHash", "state",
      "terminalEvidenceDigest", "terminalAt",
    ])
    || receipt.outcomeKey !== bind.outcomeKey
    || request.version !== EXTERNAL_PARENT_MISSION_TERMINAL_VERSION
    || request.missionKey !== bind.outcomeKey
    || Number(request.bindReceiptId) !== bind.id
    || request.bindReceiptHash !== externalParentMissionBindReceiptHash(bind)
    || (request.terminalState !== "SATISFIED" && request.terminalState !== "REVOKED")
    || !isCanonicalNonemptyStringArray(request.terminalEvidenceRefs)
    || typeof request.idempotencyKey !== "string"
    || request.idempotencyKey !== receipt.idempotencyKey
    || receipt.requestHash !== hashRecord(request)
    || result.version !== EXTERNAL_PARENT_MISSION_TERMINAL_VERSION
    || result.missionKey !== bind.outcomeKey
    || Number(result.bindReceiptId) !== bind.id
    || result.bindReceiptHash !== externalParentMissionBindReceiptHash(bind)
    || result.state !== request.terminalState
    || result.terminalEvidenceDigest !== hashRecord(request.terminalEvidenceRefs)
    || typeof result.terminalAt !== "string"
    || !Number.isFinite(Date.parse(result.terminalAt))) return null
  return result.state as string
}

export function resolveExternalParentMissionReceipts(
  receipts: readonly ReceiptLike[],
  scope?: Readonly<{ worldId?: string; projectId?: number }>,
): ExternalParentMissionState {
  const binds = receipts.filter((receipt) => receipt.operation === EXTERNAL_PARENT_MISSION_BIND_OPERATION)
  const terminals = receipts.filter((receipt) => receipt.operation === EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION)
  if (binds.some((receipt) => !validBindReceipt(receipt))) {
    return { integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] }
  }
  const byMission = new Map<string, ReceiptLike[]>()
  for (const bind of binds) {
    const rows = byMission.get(bind.outcomeKey ?? "") ?? []
    rows.push(bind)
    byMission.set(bind.outcomeKey ?? "", rows)
  }
  if ([...byMission.values()].some((rows) => rows.length !== 1)) {
    return { integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] }
  }
  if (terminals.some((terminal) => !byMission.has(terminal.outcomeKey ?? ""))) {
    return { integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] }
  }
  const unresolved: Array<{
    missionKey: string; externalRef: string; goalRef: string; worldId: string; projectId: number; repository: string
  }> = []
  const resolved: Array<{
    missionKey: string; externalRef: string; goalRef: string; worldId: string; projectId: number; repository: string
    terminalState: string
  }> = []
  for (const bind of binds) {
    const binding = (bind.resultBinding as { binding: ExternalParentMissionBinding }).binding
    const result = bind.resultBinding as { worldId: string }
    if ((scope?.worldId !== undefined && result.worldId !== scope.worldId)
      || (scope?.projectId !== undefined && binding.projectId !== scope.projectId)) continue
    const identity = {
      missionKey: binding.missionKey,
      externalRef: binding.externalRef,
      goalRef: binding.goalRef,
      worldId: result.worldId,
      projectId: binding.projectId,
      repository: binding.repository,
    }
    const candidates = terminals.filter((receipt) => receipt.outcomeKey === bind.outcomeKey)
    if (candidates.length > 1) return { integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] }
    if (candidates.length === 0) {
      unresolved.push(identity)
      continue
    }
    const state = terminalState(candidates[0], bind)
    if (!state) return { integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] }
    resolved.push({
      ...identity,
      terminalState: state,
    })
  }
  unresolved.sort((left, right) => compareCanonicalStrings(left.missionKey, right.missionKey))
  resolved.sort((left, right) => compareCanonicalStrings(left.missionKey, right.missionKey))
  return { integrity: "VERIFIED", unresolved, resolved }
}

export async function readExternalParentMissionState(
  userId: string,
  scope?: Readonly<{ worldId?: string; projectId?: number }>,
): Promise<ExternalParentMissionState> {
  const receipts = await db.select().from(outcomeQueueMutationReceipt).where(and(
    eq(outcomeQueueMutationReceipt.userId, userId),
    sql`${outcomeQueueMutationReceipt.operation} IN (${EXTERNAL_PARENT_MISSION_BIND_OPERATION}, ${EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION})`,
  ))
  // Validate the complete owner ledger before applying a caller scope. A malformed mission in a
  // different Space is still an integrity failure; scoping may select, never hide, bad authority.
  return resolveExternalParentMissionReceipts(receipts, scope)
}

function terminalResultFromReceipt(
  receipt: ReceiptLike,
  replayed: boolean,
): ExternalParentMissionTerminalSuccess {
  const result = receipt.resultBinding as Record<string, unknown>
  return {
    status: replayed ? "ALREADY_TERMINAL" : "TERMINAL_RECORDED",
    replayed,
    receiptId: receipt.id,
    missionKey: String(result.missionKey),
    bindReceiptId: Number(result.bindReceiptId),
    bindReceiptHash: String(result.bindReceiptHash),
    terminalState: result.state as "SATISFIED" | "REVOKED",
    terminalEvidenceDigest: String(result.terminalEvidenceDigest),
    terminalAt: String(result.terminalAt),
  }
}

async function terminalExternalParentMissionOnce(
  userId: string,
  input: ExternalParentMissionTerminalInput,
): Promise<ExternalParentMissionTerminalSuccess> {
  const requestBinding = terminalRequestBinding(input)
  const requestHash = hashRecord(requestBinding)
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      pg_advisory_xact_lock(hashtext(${`${userId}:external-parent-mission`})),
      pg_advisory_xact_lock(hashtext(${`${userId}:${input.missionKey}`}))`)
    const idempotencyRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.idempotencyKey, input.idempotencyKey),
    )).limit(2).for("update")
    const bindRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.id, input.bindReceiptId),
      eq(outcomeQueueMutationReceipt.operation, EXTERNAL_PARENT_MISSION_BIND_OPERATION),
      eq(outcomeQueueMutationReceipt.outcomeKey, input.missionKey),
    )).limit(2).for("update")
    const terminalRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.operation, EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION),
      eq(outcomeQueueMutationReceipt.outcomeKey, input.missionKey),
    )).limit(2).for("update")
    if (idempotencyRows.length > 1 || bindRows.length !== 1 || terminalRows.length > 1) {
      throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
    }
    const bind = bindRows[0]
    if (!validBindReceipt(bind)
      || bind.userId !== userId
      || externalParentMissionBindReceiptHash(bind) !== input.bindReceiptHash) {
      throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
    }
    if (idempotencyRows[0]) {
      const receipt = idempotencyRows[0]
      if (receipt.operation !== EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION
        || receipt.outcomeKey !== input.missionKey
        || receipt.requestHash !== requestHash
        || !exactRecord(receipt.requestBinding, requestBinding)) {
        throw new ExternalParentMissionAdmissionError("IDEMPOTENCY_CONFLICT")
      }
      if (terminalRows.length !== 1 || terminalRows[0].id !== receipt.id || !terminalState(receipt, bind)) {
        throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
      }
      return terminalResultFromReceipt(receipt, true)
    }
    if (terminalRows[0]) {
      const state = terminalState(terminalRows[0], bind)
      if (!state) throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
      throw new ExternalParentMissionAdmissionError(
        state === "REVOKED" ? "PARENT_MISSION_AUTHORITY_REVOKED" : "PARENT_MISSION_ALREADY_TERMINAL",
      )
    }

    const nowRows = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const terminalAt = new Date(nowRows.rows[0]?.now as Date | string)
    const resultBinding = {
      version: EXTERNAL_PARENT_MISSION_TERMINAL_VERSION,
      missionKey: input.missionKey,
      bindReceiptId: bind.id,
      bindReceiptHash: input.bindReceiptHash,
      state: input.terminalState,
      terminalEvidenceDigest: hashRecord(input.terminalEvidenceRefs),
      terminalAt: terminalAt.toISOString(),
    }
    const [receipt] = await transaction.insert(outcomeQueueMutationReceipt).values({
      userId,
      idempotencyKey: input.idempotencyKey,
      operation: EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION,
      outcomeKey: input.missionKey,
      requestHash,
      requestBinding,
      resultBinding,
      createdAt: terminalAt,
    }).returning()
    return terminalResultFromReceipt(receipt, false)
  }, { isolationLevel: "serializable" })
}

export async function terminalExternalParentMission(
  userId: string,
  rawInput: unknown,
): Promise<ExternalParentMissionTerminalSuccess> {
  const input = normalizeExternalParentMissionTerminalInput(rawInput)
  // A configured owner may revoke authority, but owner authentication plus caller-authored strings
  // cannot prove that every product predicate of a parent mission is satisfied. A future SATISFIED
  // issuer must validate the mission's authoritative terminal evidence server-side before invoking
  // the exact receipt contract read above.
  if (input.terminalState === "SATISFIED") {
    throw new ExternalParentMissionAdmissionError("PARENT_MISSION_TERMINAL_EVIDENCE_UNVERIFIED")
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await terminalExternalParentMissionOnce(userId, input)
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 2) throw error
    }
  }
  throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
}

async function admitExternalParentMissionOnce(
  userId: string,
  input: ExternalParentMissionAdmissionInput,
): Promise<ExternalParentMissionAdmissionSuccess> {
  const requestBinding = canonicalRequestBinding(input)
  const requestHash = hashRecord(requestBinding)
  const mission = input.externalParentMission
  const missionKey = requestBinding.missionKey

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      pg_advisory_xact_lock(hashtext(${`${userId}:external-parent-mission`})),
      pg_advisory_xact_lock(hashtext(${`${userId}:${missionKey}`}))`)

    const idempotencyRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.idempotencyKey, input.idempotencyKey),
    )).limit(2).for("update")
    const missionRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.operation, EXTERNAL_PARENT_MISSION_BIND_OPERATION),
      eq(outcomeQueueMutationReceipt.outcomeKey, missionKey),
    )).limit(2).for("update")
    const terminalRows = await transaction.select().from(outcomeQueueMutationReceipt).where(and(
      eq(outcomeQueueMutationReceipt.userId, userId),
      eq(outcomeQueueMutationReceipt.operation, EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION),
      eq(outcomeQueueMutationReceipt.outcomeKey, missionKey),
    )).limit(2).for("update")
    if (idempotencyRows.length > 1 || missionRows.length > 1 || terminalRows.length > 1) {
      throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
    }
    const replayReceipt = idempotencyRows[0]
    if (replayReceipt
      && (replayReceipt.operation !== EXTERNAL_PARENT_MISSION_BIND_OPERATION
        || replayReceipt.requestHash !== requestHash
        || !exactRecord(replayReceipt.requestBinding, requestBinding))) {
      throw new ExternalParentMissionAdmissionError("IDEMPOTENCY_CONFLICT")
    }
    if (terminalRows[0]) {
      const bound = missionRows[0] ?? idempotencyRows.find((row) =>
        row.operation === EXTERNAL_PARENT_MISSION_BIND_OPERATION && row.outcomeKey === missionKey)
      if (!bound || !validBindReceipt(bound)) {
        throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
      }
      const state = terminalState(terminalRows[0], bound)
      if (!state) throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
      throw new ExternalParentMissionAdmissionError(
        state === "REVOKED" ? "PARENT_MISSION_AUTHORITY_REVOKED" : "PARENT_MISSION_ALREADY_TERMINAL",
      )
    }
    if (replayReceipt) {
      const result = record(replayReceipt.resultBinding)
      if (replayReceipt.outcomeKey !== missionKey
        || !validBindReceipt(replayReceipt)
        || !result
        || result.worldId !== input.worldId
        || result.admittedBy !== userId) {
        throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
      }
      return resultFromReceipt(replayReceipt, true)
    }

    const worlds = await transaction.select().from(workingWorld).where(and(
      eq(workingWorld.userId, userId), eq(workingWorld.id, input.worldId),
    )).limit(1).for("update")
    if (worlds.length !== 1) throw new ExternalParentMissionAdmissionError("WORLD_NOT_FOUND")
    const world = validateWorkingWorld(JSON.parse(worlds[0].snapshot))
    const worldRepositories = await resolveSpaceRepositoryIdentities(world.resources)
    if (!worldRepositories.includes(mission.repository)) {
      throw new ExternalParentMissionAdmissionError("PROJECT_REPOSITORY_MISMATCH")
    }

    const projectRows = world.spine.projectId === null
      ? await transaction.select({ id: project.id, lifecycle: project.lifecycle }).from(project)
          .innerJoin(projectResource, and(
            eq(projectResource.userId, project.userId),
            eq(projectResource.projectId, project.id),
          )).where(and(
            eq(project.userId, userId),
            eq(project.lifecycle, "active"),
            eq(projectResource.type, "repo"),
            eq(projectResource.canonicalIdentity, mission.repository),
          )).limit(2).for("update")
      : await transaction.select({ id: project.id, lifecycle: project.lifecycle }).from(project).where(and(
          eq(project.userId, userId),
          eq(project.id, world.spine.projectId),
          eq(project.lifecycle, "active"),
        )).limit(1).for("update")
    if (projectRows.length !== 1) throw new ExternalParentMissionAdmissionError("PROJECT_REPOSITORY_MISMATCH")
    const projectId = projectRows[0].id
    const resourceRows = await transaction.select({ id: projectResource.id }).from(projectResource).where(and(
      eq(projectResource.userId, userId),
      eq(projectResource.projectId, projectId),
      eq(projectResource.type, "repo"),
      eq(projectResource.canonicalIdentity, mission.repository),
    )).limit(2).for("update")
    if (resourceRows.length !== 1) throw new ExternalParentMissionAdmissionError("PROJECT_REPOSITORY_MISMATCH")

    const canonicalBinding: ExternalParentMissionBinding = {
      version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
      source: mission.source,
      repository: mission.repository,
      externalRef: mission.externalRef,
      issueNumber: mission.issueNumber,
      goalRef: mission.goalRef,
      projectId,
      objectiveDigest: hashRecord(mission.objective),
      missionKey,
    }
    if (missionRows[0]) throw new ExternalParentMissionAdmissionError("PARENT_MISSION_ALREADY_BOUND")

    const nowRows = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const admittedAt = new Date(nowRows.rows[0]?.now as Date | string)
    const resultBinding = {
      binding: canonicalBinding,
      worldId: input.worldId,
      repositoryResourceId: resourceRows[0].id,
      loopRef: mission.loopRef,
      terminalConditionsDigest: hashRecord(mission.terminalConditions),
      authorityEvidenceDigest: hashRecord(mission.authorityEvidence),
      authorityEvidenceRole: "SUPPORTING_ONLY",
      provenanceDigest: requestBinding.provenanceDigest,
      state: "ACTIVE",
      admittedBy: userId,
      authorityProvenance: {
        kind: "AUTHENTICATED_CONFIGURED_OWNER_ADMISSION",
        ownerUserId: userId,
        confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
        provenanceDigest: requestBinding.provenanceDigest,
      },
      admittedAt: admittedAt.toISOString(),
    }
    const [receipt] = await transaction.insert(outcomeQueueMutationReceipt).values({
      userId,
      idempotencyKey: input.idempotencyKey,
      operation: EXTERNAL_PARENT_MISSION_BIND_OPERATION,
      outcomeKey: missionKey,
      requestHash,
      requestBinding,
      resultBinding,
      createdAt: admittedAt,
    }).returning()
    return resultFromReceipt(receipt, false)
  }, { isolationLevel: "serializable" })
}

function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: unknown; cause?: unknown }
  if (candidate.code === "40001" || candidate.code === "40P01") return true
  return candidate.cause !== error && isSerializationFailure(candidate.cause)
}

export async function admitExternalParentMission(
  userId: string,
  rawInput: unknown,
): Promise<ExternalParentMissionAdmissionSuccess> {
  const input = normalizeExternalParentMissionAdmissionInput(rawInput)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await admitExternalParentMissionOnce(userId, input)
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 2) throw error
    }
  }
  throw new ExternalParentMissionAdmissionError("PARENT_MISSION_BINDING_INVALID")
}
