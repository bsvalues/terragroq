import os from "node:os"
import path from "node:path"
import { createPublicKey, type KeyObject } from "node:crypto"

import {
  createDefaultSpace,
  browserSpaceStorageKey,
  createOwnedProjectSpace,
  listOwnedProjectSpaces,
  loadOrCreateOwnedSpace,
  saveOwnedSpace,
  type WorkspaceProject,
} from "@/lib/environment/space-persistence"
import { readBoundedJson } from "@/lib/environment/line-guard"
import { admitWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import {
  resolveCanonicalWorkspaceProjectBinding,
  type CanonicalWorkspaceProjectKey,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"
import { db, pool } from "@/lib/db"
import {
  authorityGrant,
  eventLog,
  evidenceRecord,
  governanceEvent,
  outcomeQueueItem,
  outcomeQueueMutationReceipt,
  workOrder,
  workingWorld,
} from "@/lib/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { hashRecord } from "@/lib/governance/hash"
import { reservationCoversRequestedPath } from "@/lib/governance/work-context-gate"
import {
  deliverySigningKeyFromBase64,
  verifyWilliamOSDeliverySeal,
  type WilliamOSDeliverySeal,
} from "@/lib/governance/delivery-seal"
import { transitionWorkOrderInTransaction } from "@/lib/work-orders/governed-transition"
import { validateWorkingWorld, withExecution } from "@/lib/environment/working-world"
import { createHermesRepositoryLifecycle } from "../../../../scripts/hermes-bridge/repository-lifecycle.mjs"
import { getSession } from "@/lib/session"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const CANONICAL_WILLIAMOS_URL = process.env.BETTER_AUTH_URL?.trim() || null
const MAX_SPACE_BYTES = 256_000
const FINALIZE_MERGED_EXTERNAL_DELIVERY = "space.external_work_order.finalize_merged_delivery"
const SHA = /^[0-9a-f]{40}$/
const EXTERNAL_QUEUE_BLOCKED_ACTIONS = ["production:mutate", "release:create", "secret:access", "spend:increase"] as const
const HERMES_LEGACY_TIME_ZONE = "America/Los_Angeles"

type MergedExternalContext = Readonly<{
  worldId: string
  outcomeKey: string
  outcomeId: number
  outcomeVersion: number
  workOrderId: number
  implementationGrantId: number
  queueGrantId: number
  deliveryGrantId: number
  repository: string
  pullRequest: number
  headSha: string
  paths: readonly string[]
  admissionDigest: string
  seal: WilliamOSDeliverySeal
  terminal: boolean
}>

type MergedExternalInspection = Readonly<{
  pullRequest: number
  state: string
  baseRefName: string
  unresolvedThreadCount: number
  headSha: string
  mergeSha: string
  paths: readonly string[]
  protectedMainContainsMerge: boolean
}>

type MergedExternalFinalizationDependencies = Readonly<{
  load(userId: string, worldId: string): Promise<MergedExternalContext>
  inspect(context: MergedExternalContext): Promise<MergedExternalInspection>
  complete(userId: string, context: MergedExternalContext, inspection: MergedExternalInspection): Promise<{ replayed: boolean }>
}>

function exactLiteralStrings(left: readonly string[], right: readonly string[]): boolean {
  const canonical = (values: readonly string[]) => values.length > 0
    && values.every((value) => value.length > 0 && value === value.trim())
    && new Set(values).size === values.length
  return canonical(left) && canonical(right) && JSON.stringify(left) === JSON.stringify(right)
}

function exactCanonicalPaths(left: readonly string[], right: readonly string[]): boolean {
  const canonical = (values: readonly string[]) => values.length > 0
    && values.every((value) => value.length > 0 && value === value.trim() && !value.includes("\\"))
    && new Set(values).size === values.length
    && JSON.stringify(values) === JSON.stringify([...values].sort())
  return canonical(left) && canonical(right) && JSON.stringify(left) === JSON.stringify(right)
}

function mergedExternalOutcomeVersionIsExact(input: Readonly<{
  signedVersion: number
  persistedVersion: number
  lifecycleState: unknown
  workOrderStatus: unknown
}>): boolean {
  if (input.lifecycleState === "active" && input.workOrderStatus === "active") {
    return input.persistedVersion === input.signedVersion
  }
  if (input.lifecycleState === "completed" && input.workOrderStatus === "closed") {
    return input.persistedVersion === input.signedVersion + 1
  }
  return false
}

function mergedExternalActiveAuthorityIsFresh(input: Readonly<{
  leaseHolder: unknown
  leaseToken: unknown
  leaseExpiresAt: unknown
  admittedExpiry: string
  expectedLeaseHolder: string
  expectedLeaseToken: string
  now: Date
  grants: readonly Readonly<{ status: string; revokedAt: unknown; expiresAt: unknown }>[]
}>): boolean {
  return input.leaseHolder === input.expectedLeaseHolder
    && input.leaseToken === input.expectedLeaseToken
    && input.leaseExpiresAt instanceof Date
    && input.leaseExpiresAt.getTime() > input.now.getTime()
    && input.admittedExpiry === input.leaseExpiresAt.toISOString()
    && input.grants.every((grant) => grant.status === "active" && grant.revokedAt === null
      && grant.expiresAt instanceof Date && grant.expiresAt.getTime() > input.now.getTime())
}

function mergedExternalDeliveryGrantExpiryIsExact(input: Readonly<{
  persistedExpiry: string | null
  signedDeliveryExpiry: unknown
  signedAnchorExpiry: unknown
  liveAnchorExpiry: string | null
}>): boolean {
  if (input.persistedExpiry === null) return false
  if (input.persistedExpiry === input.signedDeliveryExpiry) return true
  // Historical prospective-adoption evidence was written through raw node-pg on HERMES before
  // UTC-wall timestamps were normalized at that boundary. The inserted delivery grant retained the
  // authorization's exact anchor expiry, while RETURNING serialized the same wall clock through the
  // host offset before persisting it in deliveryGrant.expiresAt. Accept only that one recognizable
  // representation defect, and only while the complete live Space/Work Order/grant chain is fresh.
  // A widened/expired grant, a changed anchor, or any other timestamp remains fail-closed.
  if (typeof input.signedAnchorExpiry !== "string"
    || typeof input.signedDeliveryExpiry !== "string"
    || input.liveAnchorExpiry === null
    || input.persistedExpiry !== input.signedAnchorExpiry) return false
  return hermesLegacyRawPgExpiryProjection(input.liveAnchorExpiry) === input.signedAnchorExpiry
    && hermesLegacyRawPgExpiryProjection(input.persistedExpiry) === input.signedDeliveryExpiry
}

function hermesLegacyRawPgExpiryProjection(value: string): string | null {
  const wall = Date.parse(value)
  if (!Number.isFinite(wall)) return null
  const partsAt = (instant: number) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: HERMES_LEGACY_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]))
  const offsetAt = (instant: number) => {
    const parts = partsAt(instant)
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
      - Math.trunc(instant / 1_000) * 1_000
  }
  const wallDate = new Date(wall)
  const wallParts = {
    year: wallDate.getUTCFullYear(), month: wallDate.getUTCMonth() + 1, day: wallDate.getUTCDate(),
    hour: wallDate.getUTCHours(), minute: wallDate.getUTCMinutes(), second: wallDate.getUTCSeconds(),
  }
  const sameWall = (parts: Record<string, number>) => Object.entries(wallParts)
    .every(([key, value]) => parts[key] === value)
  const first = wall - offsetAt(wall)
  if (sameWall(partsAt(first))) return new Date(first).toISOString()
  const second = wall - offsetAt(first)
  if (sameWall(partsAt(second))) return new Date(second).toISOString()
  // JavaScript normalizes a nonexistent spring-forward wall clock to the first valid instant after
  // the gap. Reproduce that only when the two offset candidates bracket the requested wall time by
  // the same bounded DST gap; arbitrary non-round-tripping timestamps remain invalid.
  const localWall = (instant: number) => {
    const parts = partsAt(instant)
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
      + wallDate.getUTCMilliseconds()
  }
  const candidates = [first, second].map((instant) => ({ instant, local: localWall(instant) }))
    .sort((left, right) => left.local - right.local)
  const before = wall - candidates[0].local
  const after = candidates[1].local - wall
  return before > 0 && before === after && before <= 2 * 60 * 60 * 1_000
    ? new Date(candidates[1].instant).toISOString() : null
}

function mergedExternalWorkOrderIsExact(input: Readonly<{
  persistedRef: unknown
  persistedUpdatedAt: unknown
  persistedClosedAt: unknown
  persistedCompletedAt: unknown
  signedRef: string | null
  signedVersion: string
  workOrderStatus: unknown
  outcomeLifecycleState: unknown
  outcomeTerminalAt: unknown
}>): boolean {
  if (input.persistedRef !== input.signedRef || !(input.persistedUpdatedAt instanceof Date)) return false
  if (input.workOrderStatus === "active" && input.outcomeLifecycleState === "active") {
    return input.persistedUpdatedAt.toISOString() === input.signedVersion
  }
  if (input.workOrderStatus === "closed" && input.outcomeLifecycleState === "completed") {
    return input.persistedClosedAt instanceof Date
      && input.persistedCompletedAt instanceof Date
      && input.outcomeTerminalAt instanceof Date
      && input.persistedUpdatedAt.getTime() === input.outcomeTerminalAt.getTime()
      && input.persistedClosedAt.getTime() === input.outcomeTerminalAt.getTime()
      && input.persistedCompletedAt.getTime() === input.outcomeTerminalAt.getTime()
  }
  return false
}

function mergedExternalSpaceRevisionIsExact(input: Readonly<{
  persistedRevision: unknown
  signedRevision: number
  lifecycleState: unknown
  workOrderStatus: unknown
}>): boolean {
  if (!Number.isSafeInteger(input.persistedRevision)) return false
  if (input.lifecycleState === "active" && input.workOrderStatus === "active") {
    return input.persistedRevision === input.signedRevision
  }
  if (input.lifecycleState === "completed" && input.workOrderStatus === "closed") {
    return Number(input.persistedRevision) >= input.signedRevision
  }
  return false
}

function configuredDeliveryVerificationKeys(): Readonly<Record<string, KeyObject>> {
  const keys: Record<string, KeyObject> = {}
  const raw = process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON?.trim()
  try {
    if (raw) {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid key ring")
      for (const [keyId, encoded] of Object.entries(parsed)) {
        if (!keyId || typeof encoded !== "string" || !encoded) throw new Error("invalid public key")
        const key = createPublicKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "spki" })
        if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid public key type")
        keys[keyId] = key
      }
    }
    const signingKey = deliverySigningKeyFromBase64(process.env.WILLIAMOS_DELIVERY_SEAL_PRIVATE_KEY_B64)
    if (signingKey && !keys[signingKey.keyId]) keys[signingKey.keyId] = signingKey.publicKey
  } catch {
    throw new Error("MERGED_EXTERNAL_DELIVERY_SEAL_INVALID")
  }
  return keys
}

if (process.env.NODE_ENV === "test") {
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalOutcomeVersionIsExact = mergedExternalOutcomeVersionIsExact
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalActiveAuthorityIsFresh = mergedExternalActiveAuthorityIsFresh
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalDeliveryGrantExpiryIsExact = mergedExternalDeliveryGrantExpiryIsExact
  ;(globalThis as Record<string, unknown>).__williamosHermesLegacyRawPgExpiryProjection = hermesLegacyRawPgExpiryProjection
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalWorkOrderIsExact = mergedExternalWorkOrderIsExact
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalExactLiteralStrings = exactLiteralStrings
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalSpaceRevisionIsExact = mergedExternalSpaceRevisionIsExact
  ;(globalThis as Record<string, unknown>).__williamosConfiguredDeliveryVerificationKeys = configuredDeliveryVerificationKeys
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalDeliveryPathsAreExact = mergedExternalDeliveryPathsAreExact
}

function canonicalRepository(value: unknown): string {
  return String(value ?? "").trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").toLowerCase()
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MERGED_EXTERNAL_DELIVERY_EVIDENCE_INVALID")
  return value as Record<string, unknown>
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return record(value)
  try {
    return record(JSON.parse(value))
  } catch {
    throw new Error("MERGED_EXTERNAL_DELIVERY_EVIDENCE_INVALID")
  }
}

function mergedExternalDeliveryPathsAreExact(input: Readonly<{
  anchorPaths: readonly string[]
  artifactPaths: readonly string[]
  reservationPaths: readonly string[]
  deliveryPaths: readonly string[]
}>): boolean {
  return exactCanonicalPaths(input.anchorPaths, input.anchorPaths)
    && exactCanonicalPaths(input.artifactPaths, input.reservationPaths)
    && exactCanonicalPaths(input.artifactPaths, input.deliveryPaths)
    && input.artifactPaths.every((artifactPath) => reservationCoversRequestedPath(artifactPath, input.anchorPaths).ok)
}

function mergedExternalAuthorizationBindingIsExact(input: Readonly<{
  authorizationMetadata: Record<string, unknown> | null
  userId: string
  worldId: string
  repository: string
  pullRequest: number
  headSha: string
  spaceRevision: number
  outcome: Readonly<{ id: number; key: string; version: number }>
  workOrder: Readonly<{ id: number; ref: string | null; version: string }>
  implementationGrant: Readonly<{ id: number; ref: string | null; version: string | null }>
  anchorAllowed: readonly string[]
  anchorForbidden: readonly string[]
  admittedAllowed: readonly string[]
  admittedForbidden: readonly string[]
  implementationAllowed: readonly string[]
  implementationBlocked: readonly string[]
  signedAdoptionHash: string
  signedReservation: Readonly<{ allowed: readonly string[]; forbidden: readonly string[]; version: string }>
}>): boolean {
  try {
    if (!input.authorizationMetadata) return false
    const context = record(input.authorizationMetadata.context)
    const artifact = record(input.authorizationMetadata.artifact)
    const contextOutcome = record(context.outcome)
    const contextWorkOrder = record(context.workOrder)
    const contextGrant = record(context.grant)
    const anchorReservation = record(context.anchorReservation)
    const artifactReservation = record(context.reservation)
    const anchorAllowed = Array.isArray(anchorReservation.allowed) ? anchorReservation.allowed.map(String) : []
    const anchorForbidden = Array.isArray(anchorReservation.forbidden) ? anchorReservation.forbidden.map(String) : []
    const artifactAllowed = Array.isArray(artifactReservation.allowed) ? artifactReservation.allowed.map(String) : []
    const artifactForbidden = Array.isArray(artifactReservation.forbidden) ? artifactReservation.forbidden.map(String) : []
    const artifactPaths = Array.isArray(artifact.paths) ? artifact.paths.map(String) : []
    const previewDigest = hashRecord({
      version: "williamos-delivery-seal.v2",
      value: { context, artifact },
    })
    const adoptionHash = hashRecord({
      version: "williamos-delivery-seal.v2",
      authorityKind: "prospective_artifact_adoption",
      previewDigest,
      idempotencyKey: input.authorizationMetadata.idempotencyKey,
    })
    return input.authorizationMetadata.previewDigest === previewDigest
      && input.authorizationMetadata.adoptionHash === adoptionHash
      && adoptionHash === input.signedAdoptionHash
      && context.owner === input.userId && context.worldId === input.worldId
      && context.spaceRevision === input.spaceRevision
      && canonicalRepository(context.repository) === input.repository
      && context.pullRequest === input.pullRequest && context.admittedHeadSha === input.headSha
      && contextOutcome.id === input.outcome.id && contextOutcome.key === input.outcome.key
      && contextOutcome.version === input.outcome.version
      && contextWorkOrder.id === input.workOrder.id && contextWorkOrder.ref === input.workOrder.ref
      && contextWorkOrder.version === input.workOrder.version
      && contextGrant.id === input.implementationGrant.id && contextGrant.ref === input.implementationGrant.ref
      && contextGrant.version === input.implementationGrant.version
      && exactCanonicalPaths(anchorAllowed, input.anchorAllowed)
      && exactLiteralStrings(anchorForbidden, input.anchorForbidden)
      && exactCanonicalPaths(anchorAllowed, input.admittedAllowed)
      && exactLiteralStrings(anchorForbidden, input.admittedForbidden)
      && exactCanonicalPaths(anchorAllowed, input.implementationAllowed)
      && exactLiteralStrings(anchorForbidden, input.implementationBlocked)
      && exactCanonicalPaths(artifactAllowed, input.signedReservation.allowed)
      && exactLiteralStrings(artifactForbidden, input.signedReservation.forbidden)
      && artifactReservation.version === input.signedReservation.version
      && artifact.pullRequest === input.pullRequest && artifact.headSha === input.headSha
      && SHA.test(String(artifact.pullRequestBaseSha)) && SHA.test(String(artifact.baseRefSha))
      && SHA.test(String(artifact.baseSha))
      && exactCanonicalPaths(artifactPaths, input.signedReservation.allowed)
  } catch {
    return false
  }
}

if (process.env.NODE_ENV === "test") {
  ;(globalThis as Record<string, unknown>).__williamosMergedExternalAuthorizationBindingIsExact = mergedExternalAuthorizationBindingIsExact
}

async function reconcileMergedExternalAdoption(
  input: Readonly<{ userId: string; worldId: string }>,
  dependencies: MergedExternalFinalizationDependencies,
) {
  const context = await dependencies.load(input.userId, input.worldId)
  if (context.worldId !== input.worldId || !SHA.test(context.headSha) || context.paths.length === 0) {
    throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_INVALID")
  }
  const inspected = await dependencies.inspect(context)
  if (inspected.pullRequest !== context.pullRequest || inspected.state !== "MERGED"
    || inspected.baseRefName !== "main"
    || inspected.unresolvedThreadCount !== 0
    || inspected.headSha !== context.headSha || !SHA.test(inspected.mergeSha)
    || !exactCanonicalPaths(inspected.paths, context.paths) || !inspected.protectedMainContainsMerge) {
    throw new Error("MERGED_EXTERNAL_DELIVERY_NOT_PROVEN")
  }
  const completed = await dependencies.complete(input.userId, context, inspected)
  return {
    status: "FINALIZED" as const,
    replayed: completed.replayed,
    worldId: context.worldId,
    outcomeKey: context.outcomeKey,
    workOrderId: context.workOrderId,
    pullRequest: context.pullRequest,
    headSha: context.headSha,
    mergeSha: inspected.mergeSha,
    paths: [...context.paths],
  }
}

async function loadMergedExternalContext(userId: string, worldId: string): Promise<MergedExternalContext> {
  const result = await pool.query(`
    SELECT receipt."resultBinding", receipt."requestBinding",
      world."snapshot", outcome."id" AS "outcomeId", outcome."outcomeKey", outcome."version" AS "outcomeVersion",
      outcome."lifecycleState", outcome."terminalResult", outcome."terminalEvidenceRefs",
      work."id" AS "workOrderId", work."status" AS "workOrderStatus",
      seal_event."metadata" AS "sealMetadata"
    FROM "outcome_queue_mutation_receipt" receipt
    JOIN "working_world" world ON world."userId"=receipt."userId" AND world."id"=$2
    JOIN "outcome_queue_item" outcome ON outcome."userId"=receipt."userId"
      AND outcome."outcomeKey"=receipt."resultBinding"->>'outcomeKey'
    JOIN "work_order" work ON work."userId"=receipt."userId"
      AND work."id"=(receipt."resultBinding"->>'workOrderId')::integer
    JOIN LATERAL (
      SELECT "metadata" FROM "governance_event"
      WHERE "userId"=receipt."userId" AND "eventType"='EVIDENCE_RECORDED'
        AND "entityType"='williamos_delivery_seal'
        AND "metadata"->'seal'->'payload'->>'version'='williamos-delivery-seal.v2'
        AND "metadata"->'seal'->'payload'->'adoption'->>'worldId'=$2
        AND ("metadata"->'seal'->'payload'->'adoption'->'artifact'->>'pullRequest')::integer
          =(receipt."requestBinding"->'externalWorkOrder'->'pullRequest'->>'number')::integer
        AND "metadata"->'seal'->'payload'->'adoption'->'artifact'->>'headSha'
          =receipt."requestBinding"->'externalWorkOrder'->'pullRequest'->>'headSha'
      ORDER BY "id" DESC LIMIT 2
    ) seal_event ON TRUE
    WHERE receipt."userId"=$1 AND receipt."operation"='space.external_work_order.admit'
      AND receipt."resultBinding"->>'worldId'=$2
    ORDER BY receipt."id" DESC LIMIT 2`, [userId, worldId])
  if (result.rows.length !== 1) throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_INVALID")
  const row = result.rows[0]
  const binding = record(row.resultBinding)
  const requestBinding = record(row.requestBinding)
  const external = record(requestBinding.externalWorkOrder)
  const externalPullRequest = record(external.pullRequest)
  const sealMetadata = record(row.sealMetadata)
  const seal = sealMetadata.seal as WilliamOSDeliverySeal
  const verificationKeys = configuredDeliveryVerificationKeys()
  if (Object.keys(verificationKeys).length === 0 || !verifyWilliamOSDeliverySeal(seal, verificationKeys)
    || seal.payload.version !== "williamos-delivery-seal.v2") {
    throw new Error("MERGED_EXTERNAL_DELIVERY_SEAL_INVALID")
  }
  const adoption = seal.payload.adoption
  const artifact = adoption.artifact
  const anchorPaths = Array.isArray(binding.reservedPaths) ? binding.reservedPaths.map(String) : []
  const artifactPaths = Array.isArray(artifact.paths) ? artifact.paths.map(String) : []
  const reservationPaths = Array.isArray(adoption.reservation.allowed) ? adoption.reservation.allowed.map(String) : []
  const deliveryPaths = Array.isArray(seal.payload.delivery.paths) ? seal.payload.delivery.paths.map(String) : []
  const world = record(JSON.parse(String(row.snapshot)))
  const spine = record(world.spine)
  const repository = canonicalRepository(binding.repository ?? external.repository)
  const outcomeVersionExact = mergedExternalOutcomeVersionIsExact({
    signedVersion: adoption.outcome.version,
    persistedVersion: Number(row.outcomeVersion),
    lifecycleState: row.lifecycleState,
    workOrderStatus: row.workOrderStatus,
  })
  const contextExact = adoption.worldId === worldId
    && adoption.owner === userId
    && adoption.outcome.key === String(row.outcomeKey)
    && adoption.outcome.id === Number(row.outcomeId)
    && outcomeVersionExact
    && adoption.workOrder.id === Number(row.workOrderId)
    && spine.outcomeKey === row.outcomeKey
    && spine.workOrderId === Number(row.workOrderId)
    && artifact.pullRequest === Number(externalPullRequest.number)
    && artifact.headSha === String(externalPullRequest.headSha)
    && mergedExternalDeliveryPathsAreExact({ anchorPaths, artifactPaths, reservationPaths, deliveryPaths })
    && canonicalRepository(seal.payload.delivery.repository) === repository
    && seal.payload.delivery.commitSha === artifact.headSha
  if (!contextExact) throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_INVALID")
  const terminalRefs = Array.isArray(row.terminalEvidenceRefs) ? row.terminalEvidenceRefs.map(String) : []
  const terminal = row.lifecycleState === "completed" && row.workOrderStatus === "closed"
    && row.terminalResult === "COMPLETE"
    && terminalRefs.includes(`pr:${artifact.pullRequest}`)
  if (!terminal && (row.lifecycleState !== "active" || row.workOrderStatus !== "active")) {
    throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
  }
  return {
    worldId,
    outcomeKey: String(row.outcomeKey),
    outcomeId: Number(row.outcomeId),
    outcomeVersion: Number(row.outcomeVersion),
    workOrderId: Number(row.workOrderId),
    implementationGrantId: Number(binding.implementationGrantId),
    queueGrantId: Number(binding.queueGrantId),
    deliveryGrantId: adoption.grant.id,
    repository,
    pullRequest: artifact.pullRequest,
    headSha: artifact.headSha,
    paths: artifactPaths,
    admissionDigest: hashRecord({ resultBinding: binding, requestBinding }),
    seal,
    terminal,
  }
}

const mergedExternalDependencies: MergedExternalFinalizationDependencies = {
  load: loadMergedExternalContext,
  inspect: async (context) => {
    const projectRoot = process.env.WILLIAMOS_PROJECT_ROOT?.trim()
    if (!projectRoot) throw new Error("WILLIAMOS_PROJECT_ROOT_REQUIRED")
    const lifecycle = createHermesRepositoryLifecycle({
      repositoryRoot: projectRoot,
      workspaceRoot: projectRoot,
      ownedWorktreeRoot: process.env.WILLIAMOS_HERMES_WORKTREE_ROOT?.trim()
        || path.join(os.homedir(), ".williamos", "loom", "codex-worktrees"),
      repository: context.repository,
    })
    const [pullRequest, paths] = await Promise.all([
      lifecycle.inspectPullRequest(context.pullRequest, { allowRemediationBranch: true }),
      lifecycle.inspectPullRequestFiles(context.pullRequest),
    ])
    const mergeSha = String(pullRequest.mergeCommit?.oid ?? "")
    return {
      pullRequest: Number(pullRequest.number), state: String(pullRequest.state),
      baseRefName: String(pullRequest.baseRefName),
      unresolvedThreadCount: Number(pullRequest.unresolvedThreadCount),
      headSha: String(pullRequest.headRefOid), mergeSha, paths,
      protectedMainContainsMerge: SHA.test(mergeSha) && await lifecycle.verifyOriginMainContains(mergeSha),
    }
  },
  complete: async (userId, expected, inspection) => db.transaction(async (transaction) => {
    if (expected.seal.payload.version !== "williamos-delivery-seal.v2") {
      throw new Error("MERGED_EXTERNAL_DELIVERY_SEAL_INVALID")
    }
    const signedAdoption = expected.seal.payload.adoption
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${FINALIZE_MERGED_EXTERNAL_DELIVERY}:${expected.worldId}`}))`)
    const [outcome] = await transaction.select().from(outcomeQueueItem).where(and(
      eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.id, expected.outcomeId),
    )).limit(1).for("update")
    const [work] = await transaction.select().from(workOrder).where(and(
      eq(workOrder.userId, userId), eq(workOrder.id, expected.workOrderId),
    )).limit(1).for("update")
    const grants = await transaction.select().from(authorityGrant).where(and(
      eq(authorityGrant.userId, userId),
      sql`${authorityGrant.id} IN (${expected.implementationGrantId}, ${expected.queueGrantId}, ${expected.deliveryGrantId})`,
    )).for("update")
    const [world] = await transaction.select({ snapshot: workingWorld.snapshot }).from(workingWorld).where(and(
      eq(workingWorld.userId, userId), eq(workingWorld.id, expected.worldId),
    )).limit(1).for("update")
    const admissionRows = await transaction.execute(sql`
      SELECT "resultBinding", "requestBinding" FROM "outcome_queue_mutation_receipt"
      WHERE "userId"=${userId} AND "operation"='space.external_work_order.admit'
        AND "resultBinding"->>'worldId'=${expected.worldId}
      ORDER BY "id" DESC LIMIT 2 FOR UPDATE`)
    const sealRows = await transaction.execute(sql`
      SELECT "metadata" FROM "governance_event"
      WHERE "userId"=${userId} AND "eventType"='EVIDENCE_RECORDED'
        AND "entityType"='williamos_delivery_seal'
        AND "metadata"->>'adoptionHash'=${expected.seal.payload.version === "williamos-delivery-seal.v2"
          ? expected.seal.payload.adoption.adoptionHash : "INVALID"}
      ORDER BY "id" DESC LIMIT 2 FOR UPDATE`)
    const persistedWorld = world ? record(JSON.parse(world.snapshot)) : null
    const persistedSpace = persistedWorld ? record(persistedWorld.space) : null
    const persistedSpine = persistedWorld ? record(persistedWorld.spine) : null
    const lockedAdmission = admissionRows.rows[0]
    const lockedBinding = lockedAdmission ? record(lockedAdmission.resultBinding) : null
    const lockedSealMetadata = sealRows.rows[0] ? record(sealRows.rows[0].metadata) : null
    const lockedSeal = lockedSealMetadata?.seal as WilliamOSDeliverySeal | undefined
    const authorizationEventId = Number(lockedSealMetadata?.authorizationEventId)
    const validationEventId = Number(lockedSealMetadata?.validationEventId)
    const reviewEventId = Number(lockedSealMetadata?.reviewEventId)
    const authorityEvidenceRows = Number.isSafeInteger(authorizationEventId)
      && Number.isSafeInteger(validationEventId) && Number.isSafeInteger(reviewEventId)
      ? await transaction.execute(sql`
          SELECT "id", "eventType", "metadata" FROM "governance_event"
          WHERE "userId"=${userId} AND "id" IN (${authorizationEventId}, ${validationEventId}, ${reviewEventId})
          ORDER BY "id" FOR UPDATE`)
      : { rows: [] }
    const authorityEvidence = new Map(authorityEvidenceRows.rows.map((row) => [Number(row.id), row]))
    const authorizationMetadata = authorityEvidence.get(authorizationEventId)
      ? record(authorityEvidence.get(authorizationEventId)!.metadata) : null
    const validationMetadata = authorityEvidence.get(validationEventId)
      ? record(authorityEvidence.get(validationEventId)!.metadata) : null
    const reviewMetadata = authorityEvidence.get(reviewEventId)
      ? record(authorityEvidence.get(reviewEventId)!.metadata) : null
    const validationEvidence = validationMetadata ? record(validationMetadata.evidence) : null
    const reviewEvidence = reviewMetadata ? record(reviewMetadata.evidence) : null
    const authorizationContext = authorizationMetadata ? record(authorizationMetadata.context) : null
    const anchorGrant = authorizationContext ? record(authorizationContext.grant) : null
    const deliveryGrantBinding = authorizationMetadata ? record(authorizationMetadata.deliveryGrant) : null
    const lockedAdmissionDigest = lockedAdmission
      ? hashRecord({ resultBinding: lockedAdmission.resultBinding, requestBinding: lockedAdmission.requestBinding })
      : null
    const expectedGrantIds = new Set([
      expected.implementationGrantId, expected.queueGrantId, expected.deliveryGrantId,
    ])
    const grantsById = new Map(grants.map((grant) => [grant.id, grant]))
    const implementationGrant = grantsById.get(expected.implementationGrantId)
    const queueGrant = grantsById.get(expected.queueGrantId)
    const deliveryGrant = grantsById.get(expected.deliveryGrantId)
    const deliveryScope = deliveryGrant ? jsonRecord(deliveryGrant.scope) : null
    const implementationExpiry = implementationGrant?.expiresAt instanceof Date
      ? implementationGrant.expiresAt.toISOString() : null
    const deliveryExpiry = deliveryGrant?.expiresAt instanceof Date ? deliveryGrant.expiresAt.toISOString() : null
    const transactionTimeResult = await transaction.execute(sql`SELECT clock_timestamp() AS "now"`)
    const at = new Date(transactionTimeResult.rows[0]?.now as Date | string)
    const provenanceDigest = String(lockedBinding?.provenanceDigest ?? "")
    const admittedExpiry = String(lockedBinding?.expiresAt ?? "")
    const expectedLeaseToken = hashRecord({
      provenanceDigest, worldId: expected.worldId, workOrderId: expected.workOrderId,
    })
    const activeAuthorityFresh = mergedExternalActiveAuthorityIsFresh({
      leaseHolder: outcome?.leaseHolder,
      leaseToken: outcome?.leaseToken,
      leaseExpiresAt: outcome?.leaseExpiresAt,
      admittedExpiry,
      expectedLeaseHolder: `space:${expected.worldId}`,
      expectedLeaseToken,
      now: at,
      grants,
    })
    const implementationExact = Boolean(implementationGrant
      && mergedExternalWorkOrderIsExact({
        persistedRef: work?.ref,
        persistedUpdatedAt: work?.updatedAt,
        persistedClosedAt: work?.closedAt,
        persistedCompletedAt: work?.completedAt,
        signedRef: signedAdoption.workOrder.ref,
        signedVersion: signedAdoption.workOrder.version,
        workOrderStatus: work?.status,
        outcomeLifecycleState: outcome?.lifecycleState,
        outcomeTerminalAt: outcome?.terminalAt,
      })
      && work?.authorityGrantId === implementationGrant.id
      && implementationGrant.ref === anchorGrant?.ref
      && implementationGrant.contentHash === anchorGrant?.version
      && implementationGrant.workOrderId === expected.workOrderId
      && implementationGrant.grantedBy === userId && implementationGrant.grantedTo === "codex"
      && implementationGrant.authorityLevel === "A2_WRITE_OWN"
      && exactCanonicalPaths(work?.allowedFiles ?? [], implementationGrant.allowedActions)
      && exactLiteralStrings(work?.forbiddenFiles ?? [], implementationGrant.blockedActions))
    const queueExact = Boolean(queueGrant
      && queueGrant.ref === lockedBinding?.queueGrantRef
      && queueGrant.workOrderId === expected.workOrderId
      && queueGrant.grantedBy === userId && queueGrant.grantedTo === "operator"
      && queueGrant.authorityLevel === "A2_WRITE_OWN" && queueGrant.scope === expected.outcomeKey
      && exactLiteralStrings(queueGrant.allowedActions, ["outcome:execute"])
      && exactLiteralStrings(queueGrant.blockedActions, EXTERNAL_QUEUE_BLOCKED_ACTIONS))
    const deliveryExact = Boolean(deliveryGrant
      && deliveryGrant.ref === signedAdoption.grant.ref
      && deliveryGrant.ref === deliveryGrantBinding?.ref
      && deliveryGrant.contentHash === signedAdoption.grant.version
      && deliveryGrant.contentHash === deliveryGrantBinding?.version
      && deliveryGrant.workOrderId === expected.workOrderId
      && deliveryGrant.grantedBy === userId && deliveryGrant.grantedTo === "williamos-delivery"
      && deliveryGrant.authorityLevel === "A8_PUSH"
      && mergedExternalDeliveryGrantExpiryIsExact({
        persistedExpiry: deliveryExpiry,
        signedDeliveryExpiry: deliveryGrantBinding?.expiresAt,
        signedAnchorExpiry: anchorGrant?.expiresAt,
        liveAnchorExpiry: implementationExpiry,
      })
      && canonicalRepository(deliveryScope?.repository) === expected.repository
      && Number(deliveryScope?.pullRequest) === expected.pullRequest
      && deliveryScope?.headSha === expected.headSha
      && exactCanonicalPaths(deliveryGrant.allowedActions, expected.paths)
      && exactLiteralStrings(deliveryGrant.blockedActions, ["implementation:mutate", "authority:widen", "artifact:retarget"]))
    const authorizationExact = Boolean(outcome && work && implementationGrant
      && mergedExternalAuthorizationBindingIsExact({
        authorizationMetadata,
        userId,
        worldId: expected.worldId,
        repository: expected.repository,
        pullRequest: expected.pullRequest,
        headSha: expected.headSha,
        spaceRevision: signedAdoption.spaceRevision,
        outcome: { id: expected.outcomeId, key: expected.outcomeKey, version: signedAdoption.outcome.version },
        workOrder: {
          id: expected.workOrderId,
          ref: signedAdoption.workOrder.ref,
          version: signedAdoption.workOrder.version,
        },
        implementationGrant: {
          id: expected.implementationGrantId,
          ref: implementationGrant.ref,
          version: implementationGrant.contentHash,
        },
        anchorAllowed: work.allowedFiles,
        anchorForbidden: work.forbiddenFiles,
        admittedAllowed: Array.isArray(lockedBinding?.reservedPaths) ? lockedBinding.reservedPaths.map(String) : [],
        admittedForbidden: Array.isArray(lockedBinding?.forbiddenPaths) ? lockedBinding.forbiddenPaths.map(String) : [],
        implementationAllowed: implementationGrant.allowedActions,
        implementationBlocked: implementationGrant.blockedActions,
        signedAdoptionHash: signedAdoption.adoptionHash,
        signedReservation: signedAdoption.reservation,
      }))
    const exact = outcome?.outcomeKey === expected.outcomeKey && work?.id === expected.workOrderId
      && mergedExternalSpaceRevisionIsExact({
        persistedRevision: persistedSpace?.revision,
        signedRevision: signedAdoption.spaceRevision,
        lifecycleState: outcome?.lifecycleState,
        workOrderStatus: work?.status,
      })
      && persistedSpine?.outcomeKey === expected.outcomeKey && persistedSpine?.workOrderId === expected.workOrderId
      && admissionRows.rows.length === 1 && lockedAdmissionDigest === expected.admissionDigest
      && sealRows.rows.length === 1 && lockedSeal?.signature === expected.seal.signature
      && lockedSeal?.payload.version === "williamos-delivery-seal.v2"
      && lockedSeal.payload.adoption.workOrder.id === expected.workOrderId
      && lockedSeal.payload.adoption.grant.id === expected.deliveryGrantId
      && exactCanonicalPaths(lockedSeal.payload.adoption.artifact.paths, expected.paths)
      && authorityEvidenceRows.rows.length === 3
      && authorityEvidence.get(authorizationEventId)?.eventType === "ARTIFACT_ADOPTION_AUTHORIZED"
      && authorityEvidence.get(validationEventId)?.eventType === "ARTIFACT_ADOPTION_VALIDATED"
      && authorityEvidence.get(reviewEventId)?.eventType === "ARTIFACT_ADOPTION_REVIEWED"
      && authorizationMetadata?.adoptionHash === lockedSeal.payload.adoption.adoptionHash
      && validationMetadata?.adoptionHash === lockedSeal.payload.adoption.adoptionHash
      && reviewMetadata?.adoptionHash === lockedSeal.payload.adoption.adoptionHash
      && validationEvidence?.validationEvidenceDigest === lockedSeal.payload.adoption.evidence.validationDigest
      && reviewEvidence?.reviewEvidenceDigest === lockedSeal.payload.adoption.evidence.reviewDigest
      && validationEvidence?.headSha === expected.headSha && reviewEvidence?.headSha === expected.headSha
      && grants.length === expectedGrantIds.size
      && grants.every((grant) => expectedGrantIds.has(grant.id) && grant.workOrderId === expected.workOrderId)
      && authorizationExact && implementationExact && queueExact && deliveryExact
    if (!exact) throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
    const refs = [`pr:${expected.pullRequest}`, `head:${expected.headSha}`, `merge:${inspection.mergeSha}`]
    const evidenceHash = hashRecord({
      operation: FINALIZE_MERGED_EXTERNAL_DELIVERY, worldId: expected.worldId,
      outcomeKey: expected.outcomeKey, workOrderId: expected.workOrderId,
      pullRequest: expected.pullRequest, headSha: expected.headSha, mergeSha: inspection.mergeSha,
      paths: [...expected.paths], admissionDigest: expected.admissionDigest,
      sealSignature: expected.seal.signature,
    })
    const terminalKey = `${FINALIZE_MERGED_EXTERNAL_DELIVERY}:${evidenceHash}`
    const priorRows = await transaction.execute(sql`
      SELECT "resultBinding" FROM "outcome_queue_mutation_receipt"
      WHERE "userId"=${userId} AND "operation"=${FINALIZE_MERGED_EXTERNAL_DELIVERY}
        AND "outcomeKey"=${expected.outcomeKey}
      ORDER BY "id" DESC LIMIT 2 FOR UPDATE`)
    if (outcome.lifecycleState === "completed") {
      const prior = priorRows.rows.length === 1 ? record(priorRows.rows[0].resultBinding) : null
      const [terminalEvidence] = outcome.terminalEvidenceId === null ? []
        : await transaction.select().from(evidenceRecord).where(and(
          eq(evidenceRecord.userId, userId), eq(evidenceRecord.id, outcome.terminalEvidenceId),
        )).limit(1).for("update")
      const replayExact = work.status === "closed" && outcome.terminalResult === "COMPLETE"
        && outcome.terminalKey === terminalKey && exactLiteralStrings(outcome.terminalEvidenceRefs, refs)
        && terminalEvidence?.contentHash === evidenceHash && terminalEvidence.head === inspection.mergeSha
        && prior?.evidenceHash === evidenceHash && prior?.terminalKey === terminalKey
        && prior?.headSha === expected.headSha && prior?.mergeSha === inspection.mergeSha
        && exactCanonicalPaths(Array.isArray(prior?.paths) ? prior.paths.map(String) : [], expected.paths)
        && grants.every((grant) => grant.status === "revoked" && grant.revokedAt !== null)
        && persistedSpine?.execution === "complete"
      if (!replayExact) throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
      return { replayed: true }
    }
    if (priorRows.rows.length !== 0 || outcome.lifecycleState !== "active" || outcome.version !== expected.outcomeVersion
      || work.status !== "active" || !activeAuthorityFresh) {
      throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
    }
    const [evidence] = await transaction.insert(evidenceRecord).values({
      userId, workOrderId: expected.workOrderId, result: "PASS", repo: expected.repository,
      head: inspection.mergeSha, filesChanged: [...expected.paths],
      validators: ["signed exact-head adoption seal", "GitHub merged PR", "protected main contains merge"],
      notes: `WilliamOS proved merged delivery for PR #${expected.pullRequest} at ${expected.headSha}.`,
      contentHash: evidenceHash, createdAt: at,
    }).returning({ id: evidenceRecord.id })
    for (const to of ["review", "closed"] as const) {
      const transitioned = await transitionWorkOrderInTransaction({
        transaction, userId, workOrderId: expected.workOrderId, to, now: at,
      })
      if (!transitioned.ok) throw new Error("MERGED_EXTERNAL_DELIVERY_WORK_ORDER_TRANSITION_REFUSED")
    }
    await transaction.update(workOrder).set({
      result: "PASS", commitRef: inspection.mergeSha,
      evidence: [...new Set([...work.evidence, `evidence:${evidence.id}`, ...refs])].sort(),
      updatedAt: at,
    }).where(and(eq(workOrder.userId, userId), eq(workOrder.id, expected.workOrderId)))
    await transaction.update(outcomeQueueItem).set({
      lifecycleState: "completed", lifecycleReason: "MERGED_EXTERNAL_DELIVERY_PROVEN",
      activeWorkOrderId: expected.workOrderId, leaseHolder: null, leaseToken: null, leaseExpiresAt: null,
      terminalResult: "COMPLETE", terminalEvidenceId: evidence.id, terminalEvidenceRefs: refs,
      terminalKey,
      terminalAt: at, updatedAt: at, version: expected.outcomeVersion + 1,
    }).where(and(eq(outcomeQueueItem.userId, userId), eq(outcomeQueueItem.id, expected.outcomeId)))
    const revokedGrants = await transaction.update(authorityGrant).set({
      status: "revoked", revokedAt: at, revokedBy: userId,
      revokeReason: "MERGED_EXTERNAL_DELIVERY_PROVEN",
    }).where(and(eq(authorityGrant.userId, userId), sql`${authorityGrant.id} IN (${expected.implementationGrantId}, ${expected.queueGrantId}, ${expected.deliveryGrantId})`)).returning()
    if (revokedGrants.length !== expectedGrantIds.size) {
      throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
    }
    for (const grant of grants) {
      const revoked = revokedGrants.find((candidate) => candidate.id === grant.id)
      if (!revoked || revoked.status !== "revoked" || revoked.revokedAt?.getTime() !== at.getTime()) {
        throw new Error("MERGED_EXTERNAL_DELIVERY_CONTEXT_STALE")
      }
      await transaction.insert(governanceEvent).values({
        userId, eventType: "AUTHORITY_REVOKED", entityType: "authority_grant",
        entityId: String(grant.id), actor: "williamos",
        reason: "Merged external delivery proven.",
        beforeHash: grant.contentHash,
        afterHash: hashRecord({
          status: "revoked", revokedAt: at.toISOString(), revokedBy: userId,
          revokeReason: "MERGED_EXTERNAL_DELIVERY_PROVEN",
        }),
        metadata: {
          grantRef: grant.ref, outcomeKey: expected.outcomeKey,
          workOrderId: expected.workOrderId, evidenceHash,
        },
        createdAt: at,
      })
      await transaction.insert(eventLog).values({
        userId, type: "authority.revoked", register: "authority", refId: grant.id,
        summary: `${grant.ref ?? `#${grant.id}`}: REVOKED — merged external delivery proven`,
        metadata: { outcomeKey: expected.outcomeKey, workOrderId: expected.workOrderId, evidenceHash },
        createdAt: at,
      })
    }
    const metadata = {
      operation: FINALIZE_MERGED_EXTERNAL_DELIVERY, worldId: expected.worldId,
      outcomeKey: expected.outcomeKey, workOrderId: expected.workOrderId,
      pullRequest: expected.pullRequest, headSha: expected.headSha, mergeSha: inspection.mergeSha,
      paths: [...expected.paths], evidenceId: evidence.id, evidenceHash, terminalKey,
    }
    const completedWorld = withExecution(validateWorkingWorld(persistedWorld), {
      execution: "complete", at: at.toISOString(),
      evidence: {
        kind: "delivery", detail: `PR #${expected.pullRequest} merged as ${inspection.mergeSha}`,
        result: "PASS", at: at.toISOString(),
      },
    })
    await transaction.update(workingWorld).set({
      snapshot: JSON.stringify(completedWorld), intent: completedWorld.intent, updatedAt: at,
    }).where(and(eq(workingWorld.userId, userId), eq(workingWorld.id, expected.worldId)))
    await transaction.insert(governanceEvent).values({
      userId, eventType: "MERGED_EXTERNAL_DELIVERY_FINALIZED", entityType: "outcome_queue_item",
      entityId: String(expected.outcomeId), actor: "williamos",
      reason: "WilliamOS proved the exact sealed external artifact was merged into protected main.",
      beforeHash: hashRecord({ lifecycleState: "active", version: expected.outcomeVersion }),
      afterHash: hashRecord({ lifecycleState: "completed", version: expected.outcomeVersion + 1, evidenceHash }),
      evidenceId: evidence.id, metadata, createdAt: at,
    })
    await transaction.insert(eventLog).values({
      userId, type: "space.external_work_order.finalized", register: "work-orders",
      refId: expected.workOrderId,
      summary: `PR #${expected.pullRequest}: merged external delivery finalized`, metadata, createdAt: at,
    })
    await transaction.insert(outcomeQueueMutationReceipt).values({
      userId, idempotencyKey: evidenceHash, operation: FINALIZE_MERGED_EXTERNAL_DELIVERY,
      outcomeKey: expected.outcomeKey,
      requestHash: hashRecord({ worldId: expected.worldId }),
      requestBinding: { worldId: expected.worldId }, resultBinding: metadata, createdAt: at,
    })
    return { replayed: false }
  }, { isolationLevel: "serializable" }),
}

function finalizationDependencies(): MergedExternalFinalizationDependencies {
  if (process.env.NODE_ENV === "test") {
    const injected = (globalThis as typeof globalThis & {
      __williamosMergedExternalFinalizationDependencies?: MergedExternalFinalizationDependencies
    }).__williamosMergedExternalFinalizationDependencies
    if (injected) return injected
  }
  return mergedExternalDependencies
}

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0")
}

function canonicalProjectKey(value: unknown): CanonicalWorkspaceProjectKey | null {
  if (value === undefined || value === null) return "terrafusion"
  return value === "terrafusion" || value === "williamos" ? value : null
}

async function admittedAppUrl(request: Request, binding: WorkspaceProjectBinding): Promise<string | null> {
  const admission = await admitWorkspaceApp(
    binding.workspaceAppUrl,
    williamOsOrigin(CANONICAL_WILLIAMOS_URL, request.url),
  )
  return admission.ok ? admission.url : null
}

async function collectionMetadata(input: Readonly<{
  userId: string
  project: WorkspaceProject
  workspaceAppUrl: string | null
  current: { worldId: string; name: string; space: unknown }
}>) {
  try {
    return {
      spaces: await listOwnedProjectSpaces({
        userId: input.userId, project: input.project,
        workspaceAppUrl: input.workspaceAppUrl, current: input.current,
      }),
      collectionAvailable: true as const,
    }
  } catch {
    return {
      spaces: [{ ...input.current, updatedAt: new Date(0).toISOString() }],
      collectionAvailable: false as const,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE" as const,
    }
  }
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const requested = new URL(request.url).searchParams.get("worldId")
  if (requested !== null && !validWorldId(requested)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  const projectKey = canonicalProjectKey(new URL(request.url).searchParams.get("projectKey"))
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)

  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding

  const workspaceAppUrl = await admittedAppUrl(request, binding)
  try {
    const result = await loadOrCreateOwnedSpace({
      userId: session.user.id,
      worldId: requested,
      workspaceAppUrl,
      project: binding.project,
      newWorldId: crypto.randomUUID,
    })
    if (!result) return reply({ error: "WORLD_NOT_FOUND" }, 404)
    const collection = await collectionMetadata({ userId: session.user.id, project: binding.project, workspaceAppUrl, current: result })
    return reply({
      ...result,
      storage: "server",
      ...collection,
      multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "SPACE_PERSISTENCE_UNAVAILABLE"
    if (reason === "SPACE_PROJECT_MISMATCH") return reply({ error: reason }, 400)
    if (requested !== null) return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
    // A missing optional persistence relation must not strand the primary browser experience.
    // The client persists this truthful, project-bound fallback in browser storage and labels it.
    const fallback = createDefaultSpace(workspaceAppUrl, binding.project.name)
    return reply({
      worldId: "browser-local",
      name: binding.project.name,
      space: fallback,
      project: binding.project,
      storage: "browser",
      browserStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
      spaces: [{ worldId: "browser-local", name: binding.project.name, space: fallback, updatedAt: new Date(0).toISOString() }],
      multiSpaceAvailable: false,
    })
  }
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { name?: unknown; projectKey?: unknown }
  const projectKey = canonicalProjectKey(body.projectKey)
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding
  try {
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await createOwnedProjectSpace({
      userId: session.user.id,
      project: binding.project,
      name: body.name,
      workspaceAppUrl,
      newWorldId: crypto.randomUUID,
    })
    const collection = await collectionMetadata({ userId: session.user.id, project: binding.project, workspaceAppUrl, current: result })
    return reply({
      ...result, storage: "server", ...collection, multiSpaceAvailable: true,
      preferenceStorageKey: browserSpaceStorageKey(session.user.id, binding.project.identity),
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "SPACE_NAME_INVALID") return reply({ error: message }, 400)
    if (message === "SPACE_LIMIT_REACHED") return reply({ error: message }, 409)
    return reply({ error: "SPACE_PERSISTENCE_UNAVAILABLE" }, 503)
  }
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, MAX_SPACE_BYTES)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  const body = parsed.value as { worldId?: unknown; space?: unknown; projectKey?: unknown }
  if (!validWorldId(body.worldId)) return reply({ error: "WORLD_ID_INVALID" }, 400)
  const projectKey = canonicalProjectKey(body.projectKey)
  if (!projectKey) return reply({ error: "SPACE_PROJECT_INVALID" }, 400)

  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  const binding = projectBinding.binding

  try {
    const workspaceAppUrl = await admittedAppUrl(request, binding)
    const result = await saveOwnedSpace({
      userId: session.user.id,
      worldId: body.worldId,
      space: body.space,
      workspaceAppUrl,
      project: binding.project,
    })
    return result ? reply(result) : reply({ error: "WORLD_NOT_FOUND" }, 404)
  } catch (error) {
    const reason = error instanceof Error && /^(SPACE_|WORLD_)/.test(error.message)
      ? error.message
      : "SPACE_PERSISTENCE_UNAVAILABLE"
    return reply({ error: reason }, reason === "SPACE_PERSISTENCE_UNAVAILABLE" ? 503 : 400)
  }
}

export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const parsed = await readBoundedJson(request, 2_000)
  if (!parsed.ok) return reply({ error: parsed.error }, parsed.status)
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return reply({ error: "MERGED_EXTERNAL_DELIVERY_REQUEST_INVALID" }, 400)
  }
  const body = parsed.value as { mode?: unknown; worldId?: unknown; projectKey?: unknown }
  if (Object.keys(body).sort().join("\0") !== "mode\0projectKey\0worldId"
    || body.mode !== "FINALIZE_MERGED_EXTERNAL_DELIVERY"
    || !validWorldId(body.worldId)) {
    return reply({ error: "MERGED_EXTERNAL_DELIVERY_REQUEST_INVALID" }, 400)
  }
  const projectKey = canonicalProjectKey(body.projectKey)
  if (projectKey !== "williamos") return reply({ error: "SPACE_PROJECT_INVALID" }, 400)
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  const owner = assertOwner(session.user.id, ownerId)
  if (!owner.ok) return reply({ error: owner.failure, detail: owner.detail }, owner.failure === "NOT_OWNER" ? 403 : 409)
  const projectBinding = await resolveCanonicalWorkspaceProjectBinding(session.user.id, projectKey)
  if (!projectBinding.ok) return reply({ error: projectBinding.error }, 503)
  try {
    return reply(await reconcileMergedExternalAdoption({
      userId: session.user.id,
      worldId: body.worldId,
    }, finalizationDependencies()))
  } catch (error) {
    const code = error instanceof Error && /^MERGED_EXTERNAL_DELIVERY_|^WILLIAMOS_PROJECT_ROOT_/.test(error.message)
      ? error.message
      : "MERGED_EXTERNAL_DELIVERY_UNAVAILABLE"
    const status = code === "MERGED_EXTERNAL_DELIVERY_NOT_PROVEN" || code.endsWith("_STALE") ? 409
      : code.endsWith("_INVALID") ? 400 : 503
    return reply({ error: code }, status)
  }
}
