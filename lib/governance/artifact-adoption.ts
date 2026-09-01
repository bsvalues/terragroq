import { createHash, sign } from "node:crypto"

import {
  ARTIFACT_ADOPTION_SEAL_VERSION,
  canonicalDeliverySealBytes,
  DeliverySealError,
  type DeliverySigningKey,
  type MeasuredDelivery,
  type WilliamOSDeliverySeal,
  verifyWilliamOSDeliverySeal,
} from "@/lib/governance/delivery-seal"

const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/

type Spine = Readonly<{
  owner: string; worldId: string; spaceRevision: number; workspace: string; repository: string
  pullRequest: number; admittedHeadSha: string
  outcome: Readonly<{ id: number; key: string; version: number }>
  workOrder: Readonly<{ id: number; ref: string | null; version: string }>
  grant: Readonly<{ id: number; ref: string | null; version: string; expiresAt: string | null }>
  reservation: Readonly<{ allowed: readonly string[]; forbidden: readonly string[]; version: string }>
}>

export type ArtifactAdoptionTarget = Readonly<{
  pullRequest: number
  expectedHeadSha: string
}>

export type ArtifactAdoptionDeliveryGrant = Readonly<{
  id: number
  ref: string | null
  version: string
  expiresAt: string | null
}>

type Identity = Readonly<{
  pullRequest: number; state: "OPEN" | "CLOSED" | "MERGED"; headSha: string
  pullRequestBaseSha: string; baseRefSha: string; baseSha: string; paths: readonly string[]
}>

export type ArtifactAdoptionAuthorization = Readonly<{
  adoptionHash: string; previewDigest: string; idempotencyKey: string
  context: Spine
  deliveryGrant: ArtifactAdoptionDeliveryGrant
  artifact: Readonly<{ pullRequest: number; headSha: string; pullRequestBaseSha: string; baseRefSha: string; baseSha: string; paths: readonly string[] }>
}>

export type ArtifactAdoptionEvidence = Readonly<{
  adoptionHash: string; pullRequest: number; state: "OPEN" | "CLOSED" | "MERGED"; headSha: string; paths: readonly string[]
  checksGreen: boolean; checksComplete: boolean; reviewed: boolean; reviewCompleted: boolean
  isDraft: boolean; reviewDecision: string
  unresolvedThreadCount: number; validationEvidenceDigest: string; reviewEvidenceDigest: string
}>

export type ArtifactAdoptionDependencies = Readonly<{
  loadContext(userId: string, worldId: string, target: ArtifactAdoptionTarget): Promise<Spine>
  inspectArtifactIdentity(context: Spine): Promise<Identity>
  recordAuthorization(userId: string, authorization: Omit<ArtifactAdoptionAuthorization, "deliveryGrant">): Promise<{ eventId: number; authorization: ArtifactAdoptionAuthorization }>
  loadAuthorization(userId: string, adoptionHash: string): Promise<{ eventId: number; authorization: ArtifactAdoptionAuthorization } | null>
  validateDeliveryGrant(userId: string, authorization: ArtifactAdoptionAuthorization): Promise<boolean>
  inspectAuthorizedEvidence(authorization: ArtifactAdoptionAuthorization): Promise<ArtifactAdoptionEvidence>
  recordEvidence(userId: string, authorizationEventId: number, authorization: ArtifactAdoptionAuthorization, evidence: ArtifactAdoptionEvidence): Promise<{ validationEventId: number; reviewEventId: number }>
  loadEvidence(userId: string, adoptionHash: string): Promise<{ validationEventId: number; reviewEventId: number; evidence: ArtifactAdoptionEvidence } | null>
  loadSeal?(userId: string, adoptionHash: string): Promise<WilliamOSDeliverySeal | null>
  inspectDelivery(root: string, baseSha: string, commitSha: string, paths: readonly string[]): Promise<MeasuredDelivery>
  signingKey: DeliverySigningKey | null
  recordSeal(userId: string, authorizationEventId: number, validationEventId: number, reviewEventId: number, seal: WilliamOSDeliverySeal): Promise<WilliamOSDeliverySeal>
  now(): Date
}>

function fail(code: DeliverySealError["code"], message: string): never { throw new DeliverySealError(code, message) }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex") }
function set(values: readonly string[]): string[] { return [...new Set(values.map((x) => x.trim().replace(/\\/g, "/")))].sort() }
function same(left: readonly string[], right: readonly string[]): boolean { return JSON.stringify(set(left)) === JSON.stringify(set(right)) }

function validSpine(userId: string, worldId: string, spine: Spine, now: Date): boolean {
  const expiry = spine.grant.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(spine.grant.expiresAt)
  return spine.owner === userId && spine.worldId === worldId && Number.isSafeInteger(spine.spaceRevision)
    && Number.isSafeInteger(spine.pullRequest) && spine.pullRequest > 0 && SHA.test(spine.admittedHeadSha)
    && DIGEST.test(spine.reservation.version) && spine.reservation.allowed.length > 0
    && (spine.grant.expiresAt === null || (Number.isFinite(expiry) && expiry > now.getTime()))
}

function validIdentity(spine: Spine, identity: Identity): boolean {
  return identity.pullRequest === spine.pullRequest && identity.state === "OPEN"
    && identity.headSha === spine.admittedHeadSha && SHA.test(identity.pullRequestBaseSha)
    && SHA.test(identity.baseRefSha) && SHA.test(identity.baseSha)
    && same(identity.paths, spine.reservation.allowed)
}

async function snapshot(userId: string, worldId: string, target: ArtifactAdoptionTarget, deps: ArtifactAdoptionDependencies) {
  const context = await deps.loadContext(userId, worldId, target)
  if (!validSpine(userId, worldId, context, deps.now())) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "Space authority is missing, expired, or changed")
  const artifact = await deps.inspectArtifactIdentity(context)
  if (!validIdentity(context, artifact)) fail("DELIVERY_SEAL_DIFF_INVALID", "the exact admitted artifact changed")
  const value = { context, artifact: { pullRequest: artifact.pullRequest, headSha: artifact.headSha, pullRequestBaseSha: artifact.pullRequestBaseSha, baseRefSha: artifact.baseRefSha, baseSha: artifact.baseSha, paths: set(artifact.paths) } }
  return { ...value, previewDigest: hash({ version: ARTIFACT_ADOPTION_SEAL_VERSION, value }) }
}

export async function previewProspectiveArtifactAdoption(input: Readonly<{ userId: string; worldId: string; target: ArtifactAdoptionTarget }>, deps: ArtifactAdoptionDependencies) {
  const value = await snapshot(input.userId, input.worldId, input.target, deps)
  return { status: "READY_FOR_CONFIRMATION" as const, worldId: input.worldId, pullRequest: value.artifact.pullRequest, headSha: value.artifact.headSha, paths: value.artifact.paths, previewDigest: value.previewDigest }
}

export async function authorizeProspectiveArtifactAdoption(
  input: Readonly<{ userId: string; worldId: string; target: ArtifactAdoptionTarget; idempotencyKey: string; confirmedPreviewDigest: string }>,
  deps: ArtifactAdoptionDependencies,
) {
  if (!input.idempotencyKey || !DIGEST.test(input.confirmedPreviewDigest)) fail("DELIVERY_SEAL_REQUEST_INVALID", "confirmation is malformed")
  const value = await snapshot(input.userId, input.worldId, input.target, deps)
  if (value.previewDigest !== input.confirmedPreviewDigest) fail("DELIVERY_SEAL_CONFIRMATION_STALE", "the exact prospective artifact changed")
  const adoptionHash = hash({ version: ARTIFACT_ADOPTION_SEAL_VERSION, authorityKind: "prospective_artifact_adoption", previewDigest: value.previewDigest, idempotencyKey: input.idempotencyKey })
  const authorization: Omit<ArtifactAdoptionAuthorization, "deliveryGrant"> = {
    adoptionHash, previewDigest: value.previewDigest, idempotencyKey: input.idempotencyKey,
    context: value.context, artifact: value.artifact,
  }
  return deps.recordAuthorization(input.userId, authorization)
}

function validEvidence(auth: ArtifactAdoptionAuthorization, evidence: ArtifactAdoptionEvidence): boolean {
  return evidence.adoptionHash === auth.adoptionHash && evidence.pullRequest === auth.artifact.pullRequest
    && evidence.state === "OPEN" && evidence.headSha === auth.artifact.headSha
    && same(evidence.paths, auth.artifact.paths) && evidence.checksGreen && evidence.checksComplete
    && evidence.reviewed && evidence.reviewCompleted && !evidence.isDraft
    && evidence.reviewDecision !== "CHANGES_REQUESTED" && evidence.unresolvedThreadCount === 0
    && DIGEST.test(evidence.validationEvidenceDigest) && DIGEST.test(evidence.reviewEvidenceDigest)
}

export async function recordProspectiveArtifactAdoptionEvidence(
  input: Readonly<{ userId: string; authorizationEventId: number; authorization: ArtifactAdoptionAuthorization }>,
  deps: ArtifactAdoptionDependencies,
) {
  if (!Number.isSafeInteger(input.authorizationEventId) || input.authorizationEventId <= 0) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "durable prospective authorization is required before evidence")
  const persisted = await deps.loadAuthorization(input.userId, input.authorization.adoptionHash)
  if (!persisted) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "prospective authorization must be durably reloaded before evidence")
  if (persisted.eventId !== input.authorizationEventId || hash(persisted.authorization) !== hash(input.authorization)) {
    fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "prospective authorization changed before evidence")
  }
  const evidence = await deps.inspectAuthorizedEvidence(input.authorization)
  if (!validEvidence(input.authorization, evidence)) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "post-authorization validation or independent review is not exact and green")
  const ids = await deps.recordEvidence(input.userId, input.authorizationEventId, input.authorization, evidence)
  return { ...ids, evidence }
}

export async function issueProspectiveArtifactAdoptionSeal(
  input: Readonly<{ userId: string; adoptionHash: string }>, deps: ArtifactAdoptionDependencies,
): Promise<WilliamOSDeliverySeal> {
  if (!DIGEST.test(input.adoptionHash)) fail("DELIVERY_SEAL_REQUEST_INVALID", "adoption hash is malformed")
  if (!deps.signingKey) fail("DELIVERY_SEAL_SIGNING_UNAVAILABLE", "the WilliamOS delivery signing key is unavailable")
  const persisted = await deps.loadAuthorization(input.userId, input.adoptionHash)
  if (!persisted || persisted.authorization.adoptionHash !== input.adoptionHash) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "prospective authorization is not durable")
  const auth = persisted.authorization
  const current = await snapshot(input.userId, auth.context.worldId, {
    pullRequest: auth.artifact.pullRequest,
    expectedHeadSha: auth.artifact.headSha,
  }, deps)
  if (current.previewDigest !== auth.previewDigest) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "Space authority or exact artifact changed")
  if (!await deps.validateDeliveryGrant(input.userId, auth)) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "prospective delivery grant is missing, expired, or changed")
  const proof = await deps.loadEvidence(input.userId, input.adoptionHash)
  if (!proof || !validEvidence(auth, proof.evidence)) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "post-authorization exact-head validation and independent review evidence is required")
  const delivery = await deps.inspectDelivery(auth.context.workspace, auth.artifact.baseSha, auth.artifact.headSha, auth.artifact.paths)
  if (delivery.repository !== auth.context.repository || delivery.baseSha !== auth.artifact.baseSha
    || delivery.commitSha !== auth.artifact.headSha || !same(delivery.paths, auth.artifact.paths)
    || !DIGEST.test(delivery.patchDigest) || !DIGEST.test(delivery.contentDigest)) fail("DELIVERY_SEAL_DIFF_INVALID", "measured delivery differs from the authorized artifact")
  const exactExisting = (existing: WilliamOSDeliverySeal): boolean => {
    const payload = existing.payload
    const adoption = payload.version === ARTIFACT_ADOPTION_SEAL_VERSION ? payload.adoption : null
    return verifyWilliamOSDeliverySeal(existing, { [deps.signingKey!.keyId]: deps.signingKey!.publicKey })
      && payload.version === ARTIFACT_ADOPTION_SEAL_VERSION
      && payload.authorityKind === "prospective_artifact_adoption"
      && payload.keyId === deps.signingKey!.keyId
      && adoption?.adoptionHash === auth.adoptionHash
      && adoption.worldId === auth.context.worldId
      && adoption.artifact.headSha === auth.artifact.headSha
      && same(adoption.artifact.paths, auth.artifact.paths)
      && adoption.evidence.validationDigest === proof.evidence.validationEvidenceDigest
      && adoption.evidence.reviewDigest === proof.evidence.reviewEvidenceDigest
      && delivery.repository === payload.delivery.repository
      && delivery.baseSha === payload.delivery.baseSha
      && delivery.commitSha === payload.delivery.commitSha
      && same(delivery.paths, payload.delivery.paths)
      && delivery.patchDigest === payload.delivery.patchDigest
      && delivery.contentDigest === payload.delivery.contentDigest
  }
  const existing = await deps.loadSeal?.(input.userId, input.adoptionHash)
  if (existing) {
    if (!exactExisting(existing)) {
      fail("DELIVERY_SEAL_EVIDENCE_INVALID", "the persisted prospective delivery seal no longer matches exact authority and evidence")
    }
    return existing
  }
  const payload = {
    version: ARTIFACT_ADOPTION_SEAL_VERSION, authorityKind: "prospective_artifact_adoption" as const,
    issuer: "WilliamOS" as const, keyId: deps.signingKey.keyId, issuedAt: deps.now().toISOString(),
    adoption: {
      adoptionHash: auth.adoptionHash, owner: auth.context.owner, worldId: auth.context.worldId, spaceRevision: auth.context.spaceRevision,
      outcome: auth.context.outcome, workOrder: auth.context.workOrder,
      grant: { id: auth.deliveryGrant.id, ref: auth.deliveryGrant.ref, version: auth.deliveryGrant.version },
      reservation: auth.context.reservation,
      artifact: { pullRequest: auth.artifact.pullRequest, headSha: auth.artifact.headSha, paths: auth.artifact.paths },
      evidence: { validationDigest: proof.evidence.validationEvidenceDigest, reviewDigest: proof.evidence.reviewEvidenceDigest, validationHeadSha: proof.evidence.headSha, reviewHeadSha: proof.evidence.headSha },
    }, delivery,
  }
  const seal: WilliamOSDeliverySeal = { payload, signature: sign(null, canonicalDeliverySealBytes(payload), deps.signingKey.privateKey).toString("base64url") }
  const recorded = await deps.recordSeal(input.userId, persisted.eventId, proof.validationEventId, proof.reviewEventId, seal)
  if (!exactExisting(recorded)) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "the recorded prospective delivery seal does not match exact authority and evidence")
  return recorded
}
