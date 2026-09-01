import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
  verify,
  type KeyObject,
} from "node:crypto"

export const DELIVERY_SEAL_VERSION = "williamos-delivery-seal.v1" as const
export const ARTIFACT_ADOPTION_SEAL_VERSION = "williamos-delivery-seal.v2" as const

const DIGEST = /^[0-9a-f]{64}$/i
const COMMIT = /^[0-9a-f]{40}$/i

export type AssignmentDeliverySealPayload = Readonly<{
  version: typeof DELIVERY_SEAL_VERSION
  issuer: "WilliamOS"
  keyId: string
  issuedAt: string
  assignment: Readonly<{
    assignmentHash: string
    owner: string
    worldId: string
    spaceRevision: number
    outcome: Readonly<{ id: number; key: string; version: number }>
    workOrder: Readonly<{ id: number; ref: string | null; version: string }>
    grant: Readonly<{ id: number; ref: string | null; version: string }>
    reservation: Readonly<{ allowed: readonly string[]; forbidden: readonly string[]; version: string }>
    task: Readonly<{ digest: string; text: string }>
    session: Readonly<{ threadId: string; executionBindingHash: string }>
  }>
  delivery: Readonly<{
    repository: string
    baseSha: string
    commitSha: string
    paths: readonly string[]
    patchDigest: string
    contentDigest: string
  }>
}>

export type ArtifactAdoptionDeliverySealPayload = Readonly<{
  version: typeof ARTIFACT_ADOPTION_SEAL_VERSION
  authorityKind: "prospective_artifact_adoption"
  issuer: "WilliamOS"
  keyId: string
  issuedAt: string
  adoption: Readonly<{
    adoptionHash: string
    owner: string
    worldId: string
    spaceRevision: number
    outcome: Readonly<{ id: number; key: string; version: number }>
    workOrder: Readonly<{ id: number; ref: string | null; version: string }>
    grant: Readonly<{ id: number; ref: string | null; version: string }>
    reservation: Readonly<{ allowed: readonly string[]; forbidden: readonly string[]; version: string }>
    artifact: Readonly<{ pullRequest: number; headSha: string; paths: readonly string[] }>
    evidence: Readonly<{
      validationDigest: string
      reviewDigest: string
      validationHeadSha: string
      reviewHeadSha: string
    }>
  }>
  delivery: MeasuredDelivery
}>

export type WilliamOSDeliverySealPayload = AssignmentDeliverySealPayload | ArtifactAdoptionDeliverySealPayload

export type WilliamOSDeliverySeal = Readonly<{
  payload: WilliamOSDeliverySealPayload
  signature: string
}>

export type PersistedAssignmentEvent = Readonly<{ eventId: number; metadata: unknown }>
export type PersistedReadyEvent = Readonly<{ eventId: number; metadata: unknown }>

export type CurrentDeliveryAssignment = Readonly<{
  owner: string
  worldId: string
  projectRoot: string
  outcomeKey: string
  workOrderId: number
  grantId: number
  selectedPath: string
  allowed: readonly string[]
  forbidden: readonly string[]
  assignmentHash: string
  binding: Readonly<{
    spaceRevision: number
    outcomeId: number
    outcomeVersion: number
    workOrderRef: string | null
    workOrderVersion: string
    grantRef: string | null
    grantVersion: string
    reservationVersion: string
  }>
}>

export type MeasuredDelivery = Readonly<{
  repository: string
  baseSha: string
  commitSha: string
  paths: readonly string[]
  patchDigest: string
  contentDigest: string
}>

export type DeliverySigningKey = Readonly<{
  privateKey: KeyObject
  publicKey: KeyObject
  keyId: string
}>

export type DeliverySealIssuerDependencies = Readonly<{
  loadAssignment(userId: string, threadId: string, assignmentHash: string): Promise<PersistedAssignmentEvent | null>
  loadReady(userId: string, threadId: string, assignmentHash: string): Promise<PersistedReadyEvent | null>
  deriveCurrentAssignment(userId: string, worldId: string, projectRoot: string): Promise<CurrentDeliveryAssignment>
  inspectDelivery(projectRoot: string, baseSha: string, commitSha: string, paths: readonly string[]): Promise<MeasuredDelivery>
  signingKey: DeliverySigningKey | null
  recordSeal(userId: string, threadId: string, assignmentEventId: number, readyEventId: number, seal: WilliamOSDeliverySeal): Promise<void>
  now(): Date
}>

export class DeliverySealError extends Error {
  readonly code:
    | "DELIVERY_SEAL_REQUEST_INVALID"
    | "DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND"
    | "DELIVERY_SEAL_ASSIGNMENT_STALE"
    | "DELIVERY_SEAL_SUCCESS_NOT_FOUND"
    | "DELIVERY_SEAL_DIFF_INVALID"
    | "DELIVERY_SEAL_SIGNING_UNAVAILABLE"
    | "DELIVERY_SEAL_NOT_DURABLE"
    | "DELIVERY_SEAL_CONFIRMATION_STALE"
    | "DELIVERY_SEAL_EVIDENCE_INVALID"

  constructor(code: DeliverySealError["code"], message: string) {
    super(message)
    this.name = "DeliverySealError"
    this.code = code
  }
}

function fail(code: DeliverySealError["code"], detail: string): never {
  throw new DeliverySealError(code, detail)
}

export function canonicalDeliverySealBytes(payload: WilliamOSDeliverySealPayload): Buffer {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
  }
  return Buffer.from(canonical(payload), "utf8")
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
    ? value as string[]
    : null
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values.map((item) => item.replace(/\\/g, "/").trim()))].sort()
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

type AssignmentMetadata = {
  owner: string
  workspace: string
  threadId: string
  worldId: string
  spaceRevision: number
  outcome: { id: number; key: string; version: number }
  workOrder: { id: number; ref: string | null; version: string }
  grant: { id: number; ref: string | null; version: string }
  reservation: { allowed: string[]; forbidden: string[]; version: string }
  promotionPath: string
  assignmentHash: string
  task: { digest: string; text: string }
  executionBindingHash: string
  isolatedBaseSha: string
}

function parseAssignment(value: unknown): AssignmentMetadata {
  const row = value as Record<string, unknown> | null
  const outcome = row?.outcome as Record<string, unknown> | null
  const workOrder = row?.workOrder as Record<string, unknown> | null
  const grant = row?.grant as Record<string, unknown> | null
  const reservation = row?.reservation as Record<string, unknown> | null
  const task = row?.task as Record<string, unknown> | null
  const allowed = strings(reservation?.allowed)
  const forbidden = strings(reservation?.forbidden)
  if (!row || row.assignmentVersion !== "loom-codex-assignment.v1"
    || row.provider !== "Codex" || row.mode !== "delegate"
    || typeof row.owner !== "string" || typeof row.workspace !== "string"
    || typeof row.threadId !== "string" || typeof row.worldId !== "string"
    || !Number.isSafeInteger(row.spaceRevision)
    || !outcome || !Number.isSafeInteger(outcome.id) || typeof outcome.key !== "string" || !Number.isSafeInteger(outcome.version)
    || !workOrder || !Number.isSafeInteger(workOrder.id) || !(workOrder.ref === null || typeof workOrder.ref === "string") || typeof workOrder.version !== "string"
    || !grant || !Number.isSafeInteger(grant.id) || !(grant.ref === null || typeof grant.ref === "string") || typeof grant.version !== "string"
    || !reservation || !allowed || !forbidden || !DIGEST.test(String(reservation.version ?? ""))
    || typeof row.promotionPath !== "string" || !DIGEST.test(String(row.assignmentHash ?? ""))
    || !task || !DIGEST.test(String(task.digest ?? "")) || typeof task.text !== "string"
    || !DIGEST.test(String(row.executionBindingHash ?? "")) || !COMMIT.test(String(row.isolatedBaseSha ?? ""))) {
    fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "the persisted assignment record is incomplete or malformed")
  }
  return {
    owner: row.owner, workspace: row.workspace, threadId: row.threadId, worldId: row.worldId,
    spaceRevision: Number(row.spaceRevision),
    outcome: { id: Number(outcome.id), key: String(outcome.key), version: Number(outcome.version) },
    workOrder: { id: Number(workOrder.id), ref: workOrder.ref as string | null, version: String(workOrder.version) },
    grant: { id: Number(grant.id), ref: grant.ref as string | null, version: String(grant.version) },
    reservation: { allowed, forbidden, version: String(reservation.version) },
    promotionPath: row.promotionPath, assignmentHash: String(row.assignmentHash),
    task: { digest: String(task.digest), text: task.text },
    executionBindingHash: String(row.executionBindingHash), isolatedBaseSha: String(row.isolatedBaseSha),
  }
}

function readyPromotionDigest(value: unknown, assignment: AssignmentMetadata): string | null {
  const row = value as Record<string, unknown> | null
  const matches = Boolean(row && row.committed === true && row.provider === "Codex" && row.mode === "delegate"
    && row.workspace === assignment.workspace && row.worldId === assignment.worldId
    && row.outcomeKey === assignment.outcome.key && row.workOrderId === assignment.workOrder.id
    && row.grantId === assignment.grant.id && row.assignmentHash === assignment.assignmentHash
    && row.selectedPath === assignment.promotionPath && row.taskDigest === assignment.task.digest
    && row.executionBindingHash === assignment.executionBindingHash && row.baseSha === assignment.isolatedBaseSha
    && DIGEST.test(String(row.promotionDigest ?? "")))
  return matches ? String(row!.promotionDigest) : null
}

function currentMatches(current: CurrentDeliveryAssignment, assignment: AssignmentMetadata): boolean {
  return current.owner === assignment.owner && current.worldId === assignment.worldId
    && current.projectRoot === assignment.workspace && current.outcomeKey === assignment.outcome.key
    && current.workOrderId === assignment.workOrder.id && current.grantId === assignment.grant.id
    && current.selectedPath === assignment.promotionPath && current.assignmentHash === assignment.assignmentHash
    && current.binding.spaceRevision === assignment.spaceRevision
    && current.binding.outcomeId === assignment.outcome.id && current.binding.outcomeVersion === assignment.outcome.version
    && current.binding.workOrderRef === assignment.workOrder.ref && current.binding.workOrderVersion === assignment.workOrder.version
    && current.binding.grantRef === assignment.grant.ref && current.binding.grantVersion === assignment.grant.version
    && current.binding.reservationVersion === assignment.reservation.version
    && exactSet(current.allowed, assignment.reservation.allowed)
    && exactSet(current.forbidden, assignment.reservation.forbidden)
}

export async function issueLoomCodexDeliverySeal(
  input: Readonly<{ userId: string; threadId: string; assignmentHash: string; commitSha: string }>,
  dependencies: DeliverySealIssuerDependencies,
): Promise<WilliamOSDeliverySeal> {
  if (!input.userId || !input.threadId || !DIGEST.test(input.assignmentHash) || !COMMIT.test(input.commitSha)) {
    fail("DELIVERY_SEAL_REQUEST_INVALID", "owner, assignment session, assignment hash, and commit are required")
  }
  if (!dependencies.signingKey) fail("DELIVERY_SEAL_SIGNING_UNAVAILABLE", "the WilliamOS delivery signing key is unavailable")
  const persisted = await dependencies.loadAssignment(input.userId, input.threadId, input.assignmentHash)
  if (!persisted) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "no matching owned Space assignment exists")
  const assignment = parseAssignment(persisted.metadata)
  if (assignment.owner !== input.userId || assignment.threadId !== input.threadId
    || assignment.assignmentHash !== input.assignmentHash) {
    fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "the persisted assignment does not belong to this owner and session")
  }
  const ready = await dependencies.loadReady(input.userId, input.threadId, input.assignmentHash)
  const promotionDigest = ready ? readyPromotionDigest(ready.metadata, assignment) : null
  if (!ready || !promotionDigest) {
    fail("DELIVERY_SEAL_SUCCESS_NOT_FOUND", "the exact assignment has no matching durable successful result")
  }
  const current = await dependencies.deriveCurrentAssignment(input.userId, assignment.worldId, assignment.workspace)
  if (!currentMatches(current, assignment)) {
    fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the Space assignment or its authority snapshot changed before delivery")
  }
  const measured = await dependencies.inspectDelivery(
    assignment.workspace, assignment.isolatedBaseSha, input.commitSha, [assignment.promotionPath],
  )
  if (measured.baseSha !== assignment.isolatedBaseSha || measured.commitSha !== input.commitSha
    || !DIGEST.test(measured.patchDigest) || measured.contentDigest !== promotionDigest
    || !exactSet(measured.paths, [assignment.promotionPath])) {
    fail("DELIVERY_SEAL_DIFF_INVALID", "the delivered commit does not contain the exact assignment patch")
  }
  const payload: WilliamOSDeliverySealPayload = {
    version: DELIVERY_SEAL_VERSION,
    issuer: "WilliamOS",
    keyId: dependencies.signingKey.keyId,
    issuedAt: dependencies.now().toISOString(),
    assignment: {
      assignmentHash: assignment.assignmentHash,
      owner: assignment.owner,
      worldId: assignment.worldId,
      spaceRevision: assignment.spaceRevision,
      outcome: assignment.outcome,
      workOrder: assignment.workOrder,
      grant: assignment.grant,
      reservation: assignment.reservation,
      task: assignment.task,
      session: { threadId: assignment.threadId, executionBindingHash: assignment.executionBindingHash },
    },
    delivery: measured,
  }
  const seal: WilliamOSDeliverySeal = {
    payload,
    signature: sign(null, canonicalDeliverySealBytes(payload), dependencies.signingKey.privateKey).toString("base64url"),
  }
  try {
    await dependencies.recordSeal(input.userId, input.threadId, persisted.eventId, ready.eventId, seal)
  } catch (error) {
    if (error instanceof DeliverySealError) throw error
    fail("DELIVERY_SEAL_NOT_DURABLE", "the signed delivery seal could not be recorded durably")
  }
  return seal
}

export function verifyWilliamOSDeliverySeal(
  seal: WilliamOSDeliverySeal,
  publicKeys: Readonly<Record<string, KeyObject | string>>,
): boolean {
  const configured = publicKeys[seal?.payload?.keyId]
  if (!configured || ![DELIVERY_SEAL_VERSION, ARTIFACT_ADOPTION_SEAL_VERSION].includes(seal.payload.version)
    || seal.payload.issuer !== "WilliamOS") return false
  try {
    const key = typeof configured === "string" ? createPublicKey(configured) : configured
    return key.asymmetricKeyType === "ed25519"
      && verify(null, canonicalDeliverySealBytes(seal.payload), key, Buffer.from(seal.signature, "base64url"))
  } catch {
    return false
  }
}

export function deliverySigningKeyFromBase64(value: string | undefined): DeliverySigningKey | null {
  if (!value?.trim()) return null
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "pkcs8" })
    if (privateKey.asymmetricKeyType !== "ed25519") return null
    const publicKey = createPublicKey(privateKey)
    const publicDer = publicKey.export({ format: "der", type: "spki" })
    return {
      privateKey,
      publicKey,
      keyId: createHash("sha256").update(publicDer).digest("hex").slice(0, 24),
    }
  } catch {
    return null
  }
}
