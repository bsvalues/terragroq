import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { pool } from "@/lib/db"
import { validateWorkingWorld } from "@/lib/environment/working-world"
import { workspaceProjectFromRoot } from "@/lib/environment/space-persistence"
import {
  authorizeProspectiveArtifactAdoption,
  issueProspectiveArtifactAdoptionSeal,
  previewProspectiveArtifactAdoption,
  recordProspectiveArtifactAdoptionEvidence,
  type ArtifactAdoptionAuthorization,
  type ArtifactAdoptionDependencies,
  type ArtifactAdoptionEvidence,
  type ArtifactAdoptionTarget,
} from "@/lib/governance/artifact-adoption"
import { DeliverySealError, deliverySigningKeyFromBase64, type DeliverySigningKey, type WilliamOSDeliverySeal } from "@/lib/governance/delivery-seal"
import { inspectGitDelivery } from "@/lib/governance/git-delivery"
import { hashRecord } from "@/lib/governance/hash"
import { createHermesRepositoryLifecycle } from "../../scripts/hermes-bridge/repository-lifecycle.mjs"

const runFile = promisify(execFile)
const SHA = /^[0-9a-f]{40}$/
const WORKSPACE_RESOURCE = "williamos-workspace-root:v1:"
const SUPPORTED_REPOSITORY = "bsvalues/terragroq"
const DELIVERY_SEAL_CHECK = "WilliamOS assignment delivery seal"
const DELIVERY_GRANTEE = "williamos-delivery"

type CommandRunner = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ encoding?: "utf8"; windowsHide: true }>,
) => Promise<Readonly<{ stdout: string }>>

type QueryResult = { rows: Record<string, unknown>[] }
type Queryable = { query(sql: string, values?: readonly unknown[]): Promise<QueryResult> }
type Client = Queryable & { release(): void }
type Database = Queryable & { connect(): Promise<Client> }
type Lifecycle = Readonly<{
  inspectPullRequest(number: number, options?: { allowRemediationBranch?: boolean }): Promise<Record<string, unknown>>
  inspectPullRequestFiles(number: number): Promise<readonly string[]>
}>

export type ArtifactAdoptionRuntimeOptions = Readonly<{
  database: Database
  workspaceExists(root: string): Promise<boolean>
  createLifecycle(root: string, repository: string): Lifecycle
  deriveBaseSha(root: string, repository: string, pullRequest: number, headSha: string): Promise<Readonly<{ pullRequestBaseSha: string; baseRefSha: string; mergeBaseSha: string }>>
  inspectDelivery: ArtifactAdoptionDependencies["inspectDelivery"]
  signingKey: DeliverySigningKey | null
  now(): Date
}>

type Context = Awaited<ReturnType<ArtifactAdoptionDependencies["loadContext"]>>

function fail(code: ConstructorParameters<typeof DeliverySealError>[0], message: string): never {
  throw new DeliverySealError(code, message)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "persisted authority metadata is malformed") }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "persisted authority metadata is malformed")
  return value as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : []
}

function exactPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/")
  return value === normalized && value.length > 0 && value.trim() === value
    && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.endsWith("/")
    && !value.includes("*") && !value.includes("?") && !value.includes("[")
    && !value.split("/").some((part) => !part || part === "." || part === "..")
}

function exactPaths(value: unknown): string[] {
  const values = strings(value)
  if (values.length === 0 || values.length > 3_000 || values.some((item) => !exactPath(item))
    || new Set(values).size !== values.length) {
    fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the persisted reservation is not an exact canonical path set")
  }
  return [...values].sort()
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function checkRows(value: unknown): ReadonlyArray<Readonly<{ name: string; state: string }>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    return typeof row.name === "string" && typeof row.state === "string"
      ? [{ name: row.name, state: row.state }]
      : []
  })
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "")
}

function parseBaseContextRow(userId: string, worldId: string, row: Record<string, unknown>) {
  const world = validateWorkingWorld(object(row.worldSnapshot))
  if (!world.space) {
    fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the persisted Space has no durable spatial state")
  }
  const allowed = exactPaths(row.allowedFiles)
  const grantAllowed = exactPaths(row.grantAllowed)
  const forbidden = strings(row.forbiddenFiles).sort()
  const grantBlocked = strings(row.grantBlocked).sort()
  const repository = String(row.repository ?? "").trim().toLowerCase()
  const resource = world.resources.filter((value) => value.startsWith(WORKSPACE_RESOURCE))
  const workspace = resource.length === 1 ? resource[0].slice(WORKSPACE_RESOURCE.length) : ""
  const grantExpiry = row.grantExpiresAt == null ? null : iso(row.grantExpiresAt)
  if (world.spine.outcomeKey !== row.outcomeKey
    || world.spine.workOrderId !== Number(row.workOrderId) || world.space.revision < 0
    || row.outcomeState !== "active" || Number(row.activeWorkOrderId) !== Number(row.workOrderId)
    || row.workOrderStatus !== "active" || Number(row.workOrderGrantId) !== Number(row.grantId)
    || String(row.workOrderAgent).toLowerCase() !== "codex"
    || row.grantStatus !== "active" || row.grantRevokedAt != null
    || Number(row.grantWorkOrderId) !== Number(row.workOrderId) || String(row.grantTo).toLowerCase() !== "codex"
    || !same(allowed, grantAllowed) || !same(forbidden, grantBlocked)
    || repository !== SUPPORTED_REPOSITORY
    || !workspace || workspaceProjectFromRoot(workspace).identity !== workspace) {
    fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the Space, Work Order, grant, or workspace binding is inconsistent")
  }
  return {
    owner: userId,
    worldId,
    spaceRevision: world.space.revision,
    workspace: path.resolve(workspace),
    repository: `https://github.com/${repository}`,
    outcome: { id: Number(row.outcomeId), key: String(row.outcomeKey), version: Number(row.outcomeVersion) },
    workOrder: { id: Number(row.workOrderId), ref: row.workOrderRef == null ? null : String(row.workOrderRef), version: iso(row.workOrderVersion) },
    grant: { id: Number(row.grantId), ref: row.grantRef == null ? null : String(row.grantRef), version: String(row.grantVersion ?? iso(row.grantCreatedAt)), expiresAt: grantExpiry },
    anchorReservation: { allowed, forbidden },
  }
}

function contextForTarget(
  base: ReturnType<typeof parseBaseContextRow>,
  target: ArtifactAdoptionTarget,
  paths: readonly string[],
): Context {
  const reservation = {
    allowed: [...paths].sort(),
    forbidden: [...base.anchorReservation.forbidden],
    version: hashRecord({
      kind: "prospective-artifact-reservation.v1", owner: base.owner, worldId: base.worldId,
      outcome: base.outcome, workOrder: base.workOrder, anchorGrant: base.grant,
      pullRequest: target.pullRequest, headSha: target.expectedHeadSha, paths: [...paths].sort(),
    }),
  }
  return {
    ...base,
    pullRequest: target.pullRequest,
    admittedHeadSha: target.expectedHeadSha,
    reservation,
  }
}

function validDeliveryGrantRow(userId: string, authorization: ArtifactAdoptionAuthorization, row: Record<string, unknown>): boolean {
  const scope = object(row.scope)
  return Number(row.id) === authorization.deliveryGrant.id
    && (row.ref == null ? null : String(row.ref)) === authorization.deliveryGrant.ref
    && Number(row.workOrderId) === authorization.context.workOrder.id
    && String(row.grantedBy) === userId && String(row.grantedTo) === DELIVERY_GRANTEE
    && String(row.authorityLevel) === "A8_PUSH" && String(row.status) === "active" && row.revokedAt == null
    && String(row.contentHash) === authorization.deliveryGrant.version
    && (row.expiresAt == null ? null : iso(row.expiresAt)) === authorization.deliveryGrant.expiresAt
    && String(scope.repository) === authorization.context.repository
    && Number(scope.pullRequest) === authorization.artifact.pullRequest
    && String(scope.headSha) === authorization.artifact.headSha
    && same(exactPaths(row.allowedActions), authorization.artifact.paths)
    && same(strings(row.blockedActions), ["implementation:mutate", "authority:widen", "artifact:retarget"])
}

const CONTEXT_SQL = `SELECT world."snapshot" AS "worldSnapshot",
    outcome."id" AS "outcomeId", outcome."outcomeKey" AS "outcomeKey", outcome."version" AS "outcomeVersion",
    outcome."lifecycleState" AS "outcomeState", outcome."activeWorkOrderId" AS "activeWorkOrderId",
    work."id" AS "workOrderId", work."ref" AS "workOrderRef", work."status" AS "workOrderStatus",
    work."updatedAt" AS "workOrderVersion", work."authorityGrantId" AS "workOrderGrantId",
    work."agent" AS "workOrderAgent", work."allowedFiles" AS "allowedFiles", work."forbiddenFiles" AS "forbiddenFiles",
    grant_row."id" AS "grantId", grant_row."ref" AS "grantRef", grant_row."workOrderId" AS "grantWorkOrderId",
    grant_row."grantedTo" AS "grantTo", grant_row."status" AS "grantStatus", grant_row."revokedAt" AS "grantRevokedAt",
    grant_row."expiresAt" AS "grantExpiresAt", grant_row."contentHash" AS "grantVersion", grant_row."createdAt" AS "grantCreatedAt",
    grant_row."allowedActions" AS "grantAllowed", grant_row."blockedActions" AS "grantBlocked",
    resource."canonicalIdentity" AS "repository"
  FROM "working_world" world
  JOIN "outcome_queue_item" outcome ON outcome."userId" = world."userId" AND outcome."outcomeKey" = world."snapshot"::jsonb#>>'{spine,outcomeKey}'
  JOIN "work_order" work ON work."userId" = world."userId" AND work."id" = outcome."activeWorkOrderId"
  JOIN "authority_grant" grant_row ON grant_row."userId" = world."userId" AND grant_row."id" = work."authorityGrantId"
  JOIN "project_resource" resource ON resource."userId" = world."userId"
    AND resource."projectId" = (world."snapshot"::jsonb#>>'{spine,projectId}')::integer
    AND resource."type" = 'repo' AND resource."relationship" = 'primary-repo'
  WHERE world."userId" = $1 AND world."id" = $2
    AND (grant_row."expiresAt" IS NULL OR grant_row."expiresAt" > CURRENT_TIMESTAMP)`

export async function deriveArtifactAdoptionBaseSha(
  root: string,
  repository: string,
  pullRequest: number,
  headSha: string,
  execute: CommandRunner = runFile as unknown as CommandRunner,
): Promise<Readonly<{ pullRequestBaseSha: string; baseRefSha: string; mergeBaseSha: string }>> {
  try {
    const slug = repository.replace(/^https:\/\/github\.com\//, "")
    if (slug !== SUPPORTED_REPOSITORY) throw new Error("unsupported repository")
    const result = await execute("gh", ["pr", "view", String(pullRequest), "--repo", slug, "--json", "number,state,headRefOid,baseRefOid,baseRefName"], {
      encoding: "utf8", windowsHide: true,
    })
    const value = JSON.parse(result.stdout) as Record<string, unknown>
    const pullRequestBaseSha = String(value.baseRefOid ?? "").toLowerCase()
    const baseRefName = String(value.baseRefName ?? "").trim()
    if (Number(value.number) !== pullRequest || value.state !== "OPEN"
      || value.headRefOid !== headSha || !SHA.test(pullRequestBaseSha) || !baseRefName) throw new Error("bad pull request identity")
    const localHeadRef = `refs/williamos/artifact-adoption/pr-${pullRequest}-head`
    await execute("git", ["-C", root, "fetch", "--quiet", "origin",
      `+refs/pull/${pullRequest}/head:${localHeadRef}`], { windowsHide: true })
    const fetchedHeadSha = (await execute("git", ["-C", root, "rev-parse", `${localHeadRef}^{commit}`], { encoding: "utf8", windowsHide: true })).stdout.trim().toLowerCase()
    if (fetchedHeadSha !== headSha) throw new Error("pull request head changed during fetch")
    await execute("git", ["-C", root, "fetch", "--quiet", "origin", `refs/heads/${baseRefName}:refs/remotes/origin/${baseRefName}`], { windowsHide: true })
    const baseRefSha = (await execute("git", ["-C", root, "rev-parse", `refs/remotes/origin/${baseRefName}^{commit}`], { encoding: "utf8", windowsHide: true })).stdout.trim().toLowerCase()
    const mergeBaseSha = (await execute("git", ["-C", root, "merge-base", baseRefSha, fetchedHeadSha], { encoding: "utf8", windowsHide: true })).stdout.trim().toLowerCase()
    if (!SHA.test(baseRefSha) || !SHA.test(mergeBaseSha)) throw new Error("bad pull request base")
    return { pullRequestBaseSha, baseRefSha, mergeBaseSha }
  } catch { fail("DELIVERY_SEAL_DIFF_INVALID", "the exact artifact base commit is unavailable") }
}

function defaultOptions(): ArtifactAdoptionRuntimeOptions {
  return {
    database: pool as unknown as Database,
    workspaceExists: async (root) => (await fs.stat(root).catch(() => null))?.isDirectory() === true,
    createLifecycle: (root, repository) => createHermesRepositoryLifecycle({
      repository: repository.replace(/^https:\/\/github\.com\//, ""), workspaceRoot: root, repositoryRoot: root,
      ownedWorktreeRoot: path.join(os.homedir(), ".williamos", "loom", "codex-worktrees"),
    }) as Lifecycle,
    deriveBaseSha: deriveArtifactAdoptionBaseSha,
    inspectDelivery: (root, baseSha, commitSha, paths) => inspectGitDelivery(root, baseSha, commitSha, paths, { allowMultiple: true }),
    signingKey: deliverySigningKeyFromBase64(process.env.WILLIAMOS_DELIVERY_SEAL_PRIVATE_KEY_B64),
    now: () => new Date(),
  }
}

export function createArtifactAdoptionRuntime(options: ArtifactAdoptionRuntimeOptions) {
  const sealBlock = (seal: WilliamOSDeliverySeal) => [
    "```WILLIAMOS_DELIVERY_SEAL",
    JSON.stringify(seal, null, 2),
    "```",
  ].join("\n")
  const loadContext = async (userId: string, worldId: string, target: ArtifactAdoptionTarget): Promise<Context> => {
    if (!Number.isSafeInteger(target.pullRequest) || target.pullRequest <= 0 || !SHA.test(target.expectedHeadSha)) {
      fail("DELIVERY_SEAL_REQUEST_INVALID", "the exact artifact target is malformed")
    }
    const result = await options.database.query(CONTEXT_SQL, [userId, worldId])
    if (result.rows.length === 0) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "no exact Space-bound delivery adoption is available")
    if (result.rows.length !== 1) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "one exact Space-bound authority context is required")
    const base = parseBaseContextRow(userId, worldId, result.rows[0])
    if (!await options.workspaceExists(base.workspace)) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the persisted Space workspace is unavailable")
    const lifecycle = options.createLifecycle(base.workspace, base.repository)
    const [pullRequest, files] = await Promise.all([
      lifecycle.inspectPullRequest(target.pullRequest, { allowRemediationBranch: true }),
      lifecycle.inspectPullRequestFiles(target.pullRequest),
    ])
    const paths = exactPaths(files)
    if (Number(pullRequest.number) !== target.pullRequest || String(pullRequest.state) !== "OPEN"
      || String(pullRequest.headRefOid) !== target.expectedHeadSha) {
      fail("DELIVERY_SEAL_DIFF_INVALID", "the requested artifact is not the exact current open pull-request head")
    }
    return contextForTarget(base, target, paths)
  }
  const loadAuthorization = async (userId: string, adoptionHash: string) => {
    const result = await options.database.query(
      `SELECT "id", "metadata" FROM "governance_event" WHERE "userId"=$1
        AND "eventType"='ARTIFACT_ADOPTION_AUTHORIZED' AND "entityType"='williamos_artifact_adoption_authorization'
        AND "entityId"=$2 ORDER BY "id" DESC LIMIT 1`, [userId, adoptionHash],
    )
    const row = result.rows[0]
    return row ? { eventId: Number(row.id), authorization: object(row.metadata) as unknown as ArtifactAdoptionAuthorization } : null
  }
  const findAuthorization = async (userId: string, worldId: string, idempotencyKey: string, previewDigest?: string) => {
    const result = await options.database.query(
      `SELECT "id", "metadata" FROM "governance_event" WHERE "userId"=$1
        AND "eventType"='ARTIFACT_ADOPTION_AUTHORIZED' AND "entityType"='williamos_artifact_adoption_authorization'
        AND "metadata"->'context'->>'worldId'=$2 AND "metadata"->>'idempotencyKey'=$3
        ORDER BY "id" DESC LIMIT 2`, [userId, worldId, idempotencyKey],
    )
    if (result.rows.length !== 1) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "one durable prospective authorization is required")
    const authorization = object(result.rows[0].metadata) as unknown as ArtifactAdoptionAuthorization
    if (previewDigest !== undefined && authorization.previewDigest !== previewDigest) fail("DELIVERY_SEAL_CONFIRMATION_STALE", "the confirmed prospective artifact changed")
    return { eventId: Number(result.rows[0].id), authorization }
  }
  const dependencies: ArtifactAdoptionDependencies = {
    loadContext,
    inspectArtifactIdentity: async (context) => {
      const base = await options.deriveBaseSha(
        context.workspace, context.repository, context.pullRequest, context.admittedHeadSha,
      )
      return {
        pullRequest: context.pullRequest, state: "OPEN", headSha: context.admittedHeadSha,
        pullRequestBaseSha: base.pullRequestBaseSha,
        baseRefSha: base.baseRefSha, baseSha: base.mergeBaseSha, paths: context.reservation.allowed,
      }
    },
    recordAuthorization: async (userId, authorization) => {
      const client = await options.database.connect()
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:artifact-adoption:${authorization.idempotencyKey}`])
        const prior = await client.query(
          `SELECT "id","metadata" FROM "governance_event" WHERE "userId"=$1
            AND "eventType"='ARTIFACT_ADOPTION_AUTHORIZED' AND "metadata"->>'idempotencyKey'=$2
            ORDER BY "id" DESC LIMIT 2 FOR UPDATE`, [userId, authorization.idempotencyKey],
        )
        if (prior.rows.length > 1) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "prospective authorization idempotency is ambiguous")
        if (prior.rows.length === 1) {
          const persisted = object(prior.rows[0].metadata) as unknown as ArtifactAdoptionAuthorization
          if (persisted.adoptionHash !== authorization.adoptionHash
            || persisted.previewDigest !== authorization.previewDigest
            || hashRecord(persisted.context) !== hashRecord(authorization.context)
            || hashRecord(persisted.artifact) !== hashRecord(authorization.artifact)) {
            fail("DELIVERY_SEAL_CONFIRMATION_STALE", "idempotency key is bound to another artifact")
          }
          await client.query("COMMIT")
          return { eventId: Number(prior.rows[0].id), authorization: persisted }
        }
        const grantVersion = hashRecord({
          kind: "prospective-artifact-delivery-grant.v1", adoptionHash: authorization.adoptionHash,
          owner: userId, worldId: authorization.context.worldId,
          workOrder: authorization.context.workOrder, artifact: authorization.artifact,
          reservation: authorization.context.reservation,
        })
        const grantRef = `GRANT-ADOPT-${authorization.adoptionHash.slice(0, 24).toUpperCase()}`
        const grant = await client.query(
          `INSERT INTO "authority_grant" ("userId","ref","workOrderId","grantedBy","grantedTo","authorityLevel","scope","allowedActions","blockedActions","reason","status","expiresAt","contentHash")
            VALUES ($1,$2,$3,$1,$4,'A8_PUSH',$5,$6::text[],$7::text[],$8,'active',$9,$10) RETURNING "id","ref","contentHash","expiresAt"`,
          [userId, grantRef, authorization.context.workOrder.id, DELIVERY_GRANTEE,
            JSON.stringify({ repository: authorization.context.repository, pullRequest: authorization.artifact.pullRequest, headSha: authorization.artifact.headSha }),
            authorization.artifact.paths, ["implementation:mutate", "authority:widen", "artifact:retarget"],
            "Owner prospectively authorized delivery of one exact existing artifact",
            authorization.context.grant.expiresAt, grantVersion],
        )
        const grantRow = grant.rows[0]
        if (!grantRow || !Number.isSafeInteger(Number(grantRow.id)) || String(grantRow.contentHash) !== grantVersion) {
          fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the prospective delivery grant was not persisted exactly")
        }
        const persistedAuthorization: ArtifactAdoptionAuthorization = {
          ...authorization,
          deliveryGrant: {
            id: Number(grantRow.id), ref: grantRow.ref == null ? null : String(grantRow.ref),
            version: grantVersion,
            expiresAt: grantRow.expiresAt == null ? null : iso(grantRow.expiresAt),
          },
        }
        const inserted = await client.query(
          `INSERT INTO "governance_event" ("userId","eventType","entityType","entityId","actor","reason","metadata")
            VALUES ($1,$2,$3,$4,'williamos',$5,$6::jsonb) RETURNING "id"`,
          [userId, "ARTIFACT_ADOPTION_AUTHORIZED", "williamos_artifact_adoption_authorization", authorization.adoptionHash,
            "Owner prospectively authorized delivery of one exact existing artifact", JSON.stringify(persistedAuthorization)],
        )
        await client.query("COMMIT")
        return { eventId: Number(inserted.rows[0]?.id), authorization: persistedAuthorization }
      } catch (error) {
        try { await client.query("ROLLBACK") } catch { /* retain original */ }
        throw error
      } finally { client.release() }
    },
    loadAuthorization,
    validateDeliveryGrant: async (userId, authorization) => {
      const result = await options.database.query(
        `SELECT "id","ref","workOrderId","grantedBy","grantedTo","authorityLevel","scope","allowedActions","blockedActions","status","expiresAt","revokedAt","contentHash"
          FROM "authority_grant" WHERE "userId"=$1 AND "id"=$2 LIMIT 2`,
        [userId, authorization.deliveryGrant.id],
      )
      if (result.rows.length !== 1) return false
      const row = result.rows[0]
      const expiry = row.expiresAt == null ? null : Date.parse(iso(row.expiresAt))
      return validDeliveryGrantRow(userId, authorization, row)
        && (expiry === null || (Number.isFinite(expiry) && expiry > options.now().getTime()))
    },
    inspectAuthorizedEvidence: async (authorization) => {
      const lifecycle = options.createLifecycle(authorization.context.workspace, authorization.context.repository)
      const [pullRequest, files] = await Promise.all([
        lifecycle.inspectPullRequest(authorization.artifact.pullRequest, { allowRemediationBranch: true }),
        lifecycle.inspectPullRequestFiles(authorization.artifact.pullRequest),
      ])
      const inspectedPaths = exactPaths(files)
      const pullRequestNumber = Number(pullRequest.number)
      const pullRequestState = String(pullRequest.state ?? "")
      const headSha = String(pullRequest.headRefOid ?? "")
      const exact = pullRequestNumber === authorization.artifact.pullRequest && pullRequestState === "OPEN"
        && headSha === authorization.artifact.headSha && same(inspectedPaths, authorization.artifact.paths)
      const common = {
        adoptionHash: authorization.adoptionHash,
        pullRequest: pullRequestNumber,
        state: pullRequestState as "OPEN" | "CLOSED" | "MERGED",
        headSha,
        paths: inspectedPaths,
      }
      const failedChecks = checkRows(pullRequest.failedChecks)
      const pendingChecks = checkRows(pullRequest.pendingChecks)
      const blockedChecks = [...failedChecks, ...pendingChecks]
      // The delivery check cannot pass until this seal exists. During prospective issuance only,
      // disregard that one exact self-referential check while requiring every other check to be
      // complete and green. The protected workflow still verifies the resulting seal afterward.
      const onlySelfSealBlocked = blockedChecks.length > 0
        && blockedChecks.every((check) => check.name === DELIVERY_SEAL_CHECK)
      const checksComplete = pullRequest.checksComplete === true
        || (onlySelfSealBlocked && pendingChecks.every((check) => check.name === DELIVERY_SEAL_CHECK))
      const checksGreen = pullRequest.checksGreen === true || (onlySelfSealBlocked && checksComplete)
      const validation = {
        ...common, checksGreen, checksComplete, failedChecks, pendingChecks,
      }
      const review = {
        ...common, reviewed: pullRequest.reviewed === true, reviewCompleted: pullRequest.reviewCompleted === true,
        isDraft: pullRequest.isDraft === true,
        reviewDecision: String(pullRequest.reviewDecision ?? "").toUpperCase(),
        unresolvedThreadCount: Number(pullRequest.unresolvedThreadCount ?? -1),
      }
      return {
        ...common,
        checksGreen: exact && validation.checksGreen,
        checksComplete: exact && validation.checksComplete,
        reviewed: exact && review.reviewed,
        reviewCompleted: exact && review.reviewCompleted,
        isDraft: review.isDraft,
        reviewDecision: review.reviewDecision,
        unresolvedThreadCount: review.unresolvedThreadCount,
        validationEvidenceDigest: hashRecord(validation), reviewEvidenceDigest: hashRecord(review),
      }
    },
    recordEvidence: async (userId, authorizationEventId, authorization, evidence) => {
      const values = [
        ["ARTIFACT_ADOPTION_VALIDATED", "williamos_artifact_adoption_validation", evidence.validationEvidenceDigest,
          { authorizationEventId, adoptionHash: authorization.adoptionHash, headSha: evidence.headSha, paths: evidence.paths, evidence }],
        ["ARTIFACT_ADOPTION_REVIEWED", "williamos_artifact_adoption_review", evidence.reviewEvidenceDigest,
          { authorizationEventId, adoptionHash: authorization.adoptionHash, headSha: evidence.headSha, paths: evidence.paths, evidence }],
      ] as const
      const ids: number[] = []
      for (const [eventType, entityType, entityId, metadata] of values) {
        const result = await options.database.query(
          `INSERT INTO "governance_event" ("userId","eventType","entityType","entityId","actor","reason","metadata")
            VALUES ($1,$2,$3,$4,'williamos',$5,$6::jsonb) RETURNING "id"`,
          [userId, eventType, entityType, entityId, "WilliamOS recorded exact-head prospective adoption evidence", JSON.stringify(metadata)],
        )
        ids.push(Number(result.rows[0]?.id))
      }
      return { validationEventId: ids[0], reviewEventId: ids[1] }
    },
    loadEvidence: async (userId, adoptionHash) => {
      const result = await options.database.query(
        `SELECT validation."id" AS "validationEventId", validation."metadata" AS "validationMetadata",
            review."id" AS "reviewEventId", review."metadata" AS "reviewMetadata"
          FROM "governance_event" validation JOIN "governance_event" review
            ON review."userId"=validation."userId" AND review."metadata"->>'adoptionHash'=validation."metadata"->>'adoptionHash'
          WHERE validation."userId"=$1 AND validation."eventType"='ARTIFACT_ADOPTION_VALIDATED'
            AND review."eventType"='ARTIFACT_ADOPTION_REVIEWED' AND validation."metadata"->>'adoptionHash'=$2
          ORDER BY validation."id" DESC, review."id" DESC LIMIT 1`, [userId, adoptionHash],
      )
      const row = result.rows[0]
      if (!row) return null
      const validation = object(row.validationMetadata)
      const review = object(row.reviewMetadata)
      const left = object(validation.evidence) as unknown as ArtifactAdoptionEvidence
      const right = object(review.evidence) as unknown as ArtifactAdoptionEvidence
      if (hashRecord(left) !== hashRecord(right)) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "validation and review evidence bindings disagree")
      return { validationEventId: Number(row.validationEventId), reviewEventId: Number(row.reviewEventId), evidence: left }
    },
    loadSeal: async (userId, adoptionHash) => {
      const result = await options.database.query(
        `SELECT "metadata" FROM "governance_event" WHERE "userId"=$1 AND "eventType"='EVIDENCE_RECORDED'
          AND "entityType"='williamos_delivery_seal' AND "metadata"->>'adoptionHash'=$2 ORDER BY "id" DESC LIMIT 2`,
        [userId, adoptionHash],
      )
      if (result.rows.length > 1) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "prospective delivery seal state is ambiguous")
      if (!result.rows[0]) return null
      const metadata = object(result.rows[0].metadata)
      return metadata.seal as WilliamOSDeliverySeal
    },
    inspectDelivery: options.inspectDelivery,
    signingKey: options.signingKey,
    recordSeal: async (userId, authorizationEventId, validationEventId, reviewEventId, seal) => {
      return recordArtifactAdoptionSealWithAuthorityFence({ userId, authorizationEventId, validationEventId, reviewEventId, seal }, options.database)
    },
    now: options.now,
  }
  return {
    preview: async (userId: string, worldId: string, requestedTarget?: ArtifactAdoptionTarget) => {
      let target = requestedTarget
      if (!target) {
        const existing = await options.database.query(
          `SELECT "metadata" FROM "governance_event" WHERE "userId"=$1
            AND "eventType"='ARTIFACT_ADOPTION_AUTHORIZED' AND "entityType"='williamos_artifact_adoption_authorization'
            AND "metadata"->'context'->>'worldId'=$2 ORDER BY "id" DESC LIMIT 2`,
          [userId, worldId],
        )
        if (existing.rows.length !== 1) fail("DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND", "no prospective artifact adoption is available to restore")
        const authorization = object(existing.rows[0].metadata) as unknown as ArtifactAdoptionAuthorization
        target = { pullRequest: authorization.artifact.pullRequest, expectedHeadSha: authorization.artifact.headSha }
      }
      const ready = await previewProspectiveArtifactAdoption({ userId, worldId, target }, dependencies)
      const found = await options.database.query(
        `SELECT "id", "metadata" FROM "governance_event" WHERE "userId"=$1
          AND "eventType"='ARTIFACT_ADOPTION_AUTHORIZED' AND "entityType"='williamos_artifact_adoption_authorization'
          AND "metadata"->'context'->>'worldId'=$2 AND "metadata"->>'previewDigest'=$3
          ORDER BY "id" DESC LIMIT 2`, [userId, worldId, ready.previewDigest],
      )
      if (found.rows.length !== 1) return ready
      const authorization = object(found.rows[0].metadata) as unknown as ArtifactAdoptionAuthorization
      const sealed = await options.database.query(
        `SELECT "metadata" FROM "governance_event" WHERE "userId"=$1 AND "eventType"='EVIDENCE_RECORDED'
          AND "entityType"='williamos_delivery_seal' AND "metadata"->>'adoptionHash'=$2 ORDER BY "id" DESC LIMIT 1`,
        [userId, authorization.adoptionHash],
      )
      if (sealed.rows[0]) {
        const metadata = object(sealed.rows[0].metadata)
        return { ...ready, status: "SEALED" as const, adoptionHash: authorization.adoptionHash, seal: metadata.seal as WilliamOSDeliverySeal }
      }
      return {
        ...ready,
        status: "AUTHORIZED" as const,
        idempotencyKey: authorization.idempotencyKey,
        adoptionHash: authorization.adoptionHash,
        authorizationEventId: Number(found.rows[0].id),
      }
    },
    authorize: async (userId: string, worldId: string, target: ArtifactAdoptionTarget, idempotencyKey: string, confirmedPreviewDigest: string) => {
      const result = await authorizeProspectiveArtifactAdoption({ userId, worldId, target, idempotencyKey, confirmedPreviewDigest }, dependencies)
      return {
        status: "AUTHORIZED" as const, worldId,
        pullRequest: result.authorization.artifact.pullRequest, headSha: result.authorization.artifact.headSha,
        paths: result.authorization.artifact.paths, previewDigest: result.authorization.previewDigest,
        idempotencyKey: result.authorization.idempotencyKey,
        adoptionHash: result.authorization.adoptionHash, authorizationEventId: result.eventId,
      }
    },
    issue: async (userId: string, worldId: string, idempotencyKey: string) => {
      const persisted = await findAuthorization(userId, worldId, idempotencyKey)
      const existing = await dependencies.loadSeal?.(userId, persisted.authorization.adoptionHash)
      if (existing) {
        const seal = await issueProspectiveArtifactAdoptionSeal({ userId, adoptionHash: persisted.authorization.adoptionHash }, dependencies)
        return {
          status: "SEALED" as const, worldId,
          pullRequest: persisted.authorization.artifact.pullRequest, headSha: persisted.authorization.artifact.headSha,
          paths: persisted.authorization.artifact.paths, previewDigest: persisted.authorization.previewDigest,
          adoptionHash: persisted.authorization.adoptionHash, seal, sealBlock: sealBlock(seal),
        }
      }
      await recordProspectiveArtifactAdoptionEvidence({ userId, authorizationEventId: persisted.eventId, authorization: persisted.authorization }, dependencies)
      // Reinspect and persist the trusted exact-head state immediately before signing. The seal loader
      // selects the newest evidence pair, so a head/path/check/review drift between phases fails closed.
      await recordProspectiveArtifactAdoptionEvidence({ userId, authorizationEventId: persisted.eventId, authorization: persisted.authorization }, dependencies)
      const seal = await issueProspectiveArtifactAdoptionSeal({ userId, adoptionHash: persisted.authorization.adoptionHash }, dependencies)
      return {
        status: "SEALED" as const, worldId,
        pullRequest: persisted.authorization.artifact.pullRequest, headSha: persisted.authorization.artifact.headSha,
        paths: persisted.authorization.artifact.paths, previewDigest: persisted.authorization.previewDigest,
        adoptionHash: persisted.authorization.adoptionHash, seal, sealBlock: sealBlock(seal),
      }
    },
  }
}

export async function recordArtifactAdoptionSealWithAuthorityFence(
  input: Readonly<{ userId: string; authorizationEventId: number; validationEventId: number; reviewEventId: number; seal: WilliamOSDeliverySeal }>,
  database: Database = pool as unknown as Database,
): Promise<WilliamOSDeliverySeal> {
  if (input.seal.payload.version !== "williamos-delivery-seal.v2") fail("DELIVERY_SEAL_REQUEST_INVALID", "artifact adoption fence accepts only prospective adoption seals")
  const client = await database.connect()
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
    const adoptionHash = input.seal.payload.adoption.adoptionHash
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.userId}:artifact-adoption-seal:${adoptionHash}`])
    const prior = await client.query(
      `SELECT "metadata" FROM "governance_event" WHERE "userId"=$1 AND "eventType"='EVIDENCE_RECORDED'
        AND "entityType"='williamos_delivery_seal' AND "metadata"->>'adoptionHash'=$2
        ORDER BY "id" DESC LIMIT 2 FOR UPDATE`,
      [input.userId, adoptionHash],
    )
    if (prior.rows.length > 1) fail("DELIVERY_SEAL_EVIDENCE_INVALID", "prospective delivery seal state is ambiguous")
    const priorMetadata = prior.rows[0] ? object(prior.rows[0].metadata) : null
    const seal = priorMetadata?.seal as WilliamOSDeliverySeal | undefined ?? input.seal
    if (seal.payload.version !== "williamos-delivery-seal.v2") {
      fail("DELIVERY_SEAL_EVIDENCE_INVALID", "persisted prospective delivery seal has the wrong version")
    }
    const authorizationEventId = priorMetadata ? Number(priorMetadata.authorizationEventId) : input.authorizationEventId
    const validationEventId = priorMetadata ? Number(priorMetadata.validationEventId) : input.validationEventId
    const reviewEventId = priorMetadata ? Number(priorMetadata.reviewEventId) : input.reviewEventId
    const events = await client.query(
      `SELECT authorization_event."metadata" AS "authorizationMetadata",
          validation_event."metadata" AS "validationMetadata", review_event."metadata" AS "reviewMetadata"
        FROM "governance_event" authorization_event
        JOIN "governance_event" validation_event ON validation_event."userId"=authorization_event."userId"
        JOIN "governance_event" review_event ON review_event."userId"=authorization_event."userId"
       WHERE authorization_event."id"=$2 AND authorization_event."userId"=$1
         AND authorization_event."eventType"='ARTIFACT_ADOPTION_AUTHORIZED'
         AND validation_event."id"=$3 AND validation_event."eventType"='ARTIFACT_ADOPTION_VALIDATED'
         AND review_event."id"=$4 AND review_event."eventType"='ARTIFACT_ADOPTION_REVIEWED'
       FOR UPDATE OF authorization_event, validation_event, review_event`,
      [input.userId, authorizationEventId, validationEventId, reviewEventId],
    )
    const eventRow = events.rows[0]
    if (!eventRow) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "prospective adoption authority changed before sealing")
    const authorization = object(eventRow.authorizationMetadata) as unknown as ArtifactAdoptionAuthorization
    const validation = object(eventRow.validationMetadata)
    const review = object(eventRow.reviewMetadata)
    const contextResult = await client.query(
      `${CONTEXT_SQL} FOR UPDATE OF world, outcome, work, grant_row`,
      [input.userId, seal.payload.adoption.worldId],
    )
    if (contextResult.rows.length !== 1) fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the Space authority changed before sealing")
    const baseContext = parseBaseContextRow(input.userId, seal.payload.adoption.worldId, contextResult.rows[0])
    const context = contextForTarget(baseContext, {
      pullRequest: authorization.artifact.pullRequest,
      expectedHeadSha: authorization.artifact.headSha,
    }, authorization.artifact.paths)
    const deliveryGrant = await client.query(
      `SELECT "id","ref","workOrderId","grantedBy","grantedTo","authorityLevel","scope","allowedActions","blockedActions","status","expiresAt","revokedAt","contentHash"
        FROM "authority_grant" WHERE "userId"=$1 AND "id"=$2 AND "status"='active' AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP) LIMIT 1 FOR UPDATE`,
      [input.userId, authorization.deliveryGrant.id],
    )
    if (deliveryGrant.rows.length !== 1 || !validDeliveryGrantRow(input.userId, authorization, deliveryGrant.rows[0])) {
      fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "the exact prospective delivery grant changed or expired before sealing")
    }
    const validationEvidence = object(validation.evidence) as unknown as ArtifactAdoptionEvidence
    const reviewEvidence = object(review.evidence) as unknown as ArtifactAdoptionEvidence
    const signed = seal.payload.adoption
    if (hashRecord(authorization.context) !== hashRecord(context)
      || authorization.adoptionHash !== signed.adoptionHash
      || authorization.artifact.headSha !== signed.artifact.headSha
      || !same(authorization.artifact.paths, signed.artifact.paths)
      || hashRecord(validationEvidence) !== hashRecord(reviewEvidence)
      || validationEvidence.validationEvidenceDigest !== signed.evidence.validationDigest
      || reviewEvidence.reviewEvidenceDigest !== signed.evidence.reviewDigest
      || validationEvidence.headSha !== signed.artifact.headSha || !same(validationEvidence.paths, signed.artifact.paths)) {
      fail("DELIVERY_SEAL_ASSIGNMENT_STALE", "prospective adoption authority or exact evidence changed before sealing")
    }
    if (priorMetadata) {
      await client.query("COMMIT")
      return seal
    }
    const inserted = await client.query(
      `INSERT INTO "governance_event" ("userId","eventType","entityType","entityId","actor","reason","metadata")
        VALUES ($1,'EVIDENCE_RECORDED','williamos_delivery_seal',$2,'williamos',
          'WilliamOS sealed a prospectively authorized exact artifact adoption',$3::jsonb) RETURNING "id"`,
      [input.userId, seal.signature, JSON.stringify({
        authorizationEventId: input.authorizationEventId, validationEventId: input.validationEventId,
        reviewEventId: input.reviewEventId, adoptionHash: signed.adoptionHash, seal,
      })],
    )
    if (!inserted.rows[0]?.id) throw new Error("DELIVERY_SEAL_NOT_DURABLE")
    await client.query("COMMIT")
    return seal
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* retain original failure */ }
    throw error
  } finally { client.release() }
}

let singleton: ReturnType<typeof createArtifactAdoptionRuntime> | null = null
function runtime() { return singleton ??= createArtifactAdoptionRuntime(defaultOptions()) }
export const previewPersistedArtifactAdoption = (userId: string, worldId: string) => runtime().preview(userId, worldId)
export const previewTargetArtifactAdoption = (userId: string, worldId: string, target: ArtifactAdoptionTarget) => runtime().preview(userId, worldId, target)
export const authorizePersistedArtifactAdoption = (userId: string, worldId: string, target: ArtifactAdoptionTarget, idempotencyKey: string, digest: string) => runtime().authorize(userId, worldId, target, idempotencyKey, digest)
export const issuePersistedArtifactAdoption = (userId: string, worldId: string, idempotencyKey: string) => runtime().issue(userId, worldId, idempotencyKey)
