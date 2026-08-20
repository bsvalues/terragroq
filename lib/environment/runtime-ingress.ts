import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { authorityGrant, environmentWorld, evidenceRecord, projectResource, workOrder } from "@/lib/db/schema"
import { grantCovers } from "@/lib/governance/authority"
import { validateEnvironmentWorldProjection, type ExecutionObservation } from "@/lib/environment/world-projection"
import type { UnverifiedWorldEndpoint } from "@/lib/environment/endpoint-liveness"

type RuntimeAuthorityInput = Readonly<{
  userId: string
  worldId: string
  workOrderRef: string
  grantRef: string
  action: "environment:admit-endpoint" | "environment:observe-execution"
  payloadDigest: string
  evidenceRefs: readonly string[]
  endpoint?: UnverifiedWorldEndpoint
  observation?: ExecutionObservation
}>

/**
 * One exact owner/world/resource/Work Order/grant/evidence chain must cover the action and submitted
 * payload digest. The request cannot choose a URL, branch, head, result, or artifact its durable
 * evidence did not already bind.
 */
export async function requireEnvironmentRuntimeAuthority(input: RuntimeAuthorityInput) {
  const [worldRow] = await db
    .select({ id: environmentWorld.id, resourceIdentity: environmentWorld.resourceIdentity, projection: environmentWorld.projection })
    .from(environmentWorld)
    .where(and(eq(environmentWorld.userId, input.userId), eq(environmentWorld.id, input.worldId)))
    .limit(1)
  if (!worldRow) throw new Error("WORLD_NOT_FOUND")
  const world = validateEnvironmentWorldProjection(worldRow.projection)
  if (world.workOrderRef !== input.workOrderRef) throw new Error("RUNTIME_WORK_ORDER_WORLD_MISMATCH")
  const resourceIdentity = world.resource?.canonicalIdentity
  if (!resourceIdentity || worldRow.resourceIdentity !== resourceIdentity) throw new Error("RUNTIME_RESOURCE_BINDING_MISMATCH")
  const resourceRecordId = world.resource?.recordId
  if (!resourceRecordId) throw new Error("RUNTIME_RESOURCE_BINDING_MISMATCH")

  let branch: string
  let head: string
  if (input.action === "environment:admit-endpoint") {
    if (!input.endpoint || input.endpoint.worldId !== world.id || input.endpoint.resourceIdentity !== resourceIdentity) {
      throw new Error("RUNTIME_ENDPOINT_BINDING_MISMATCH")
    }
    branch = input.endpoint.branch
    head = input.endpoint.head
  } else {
    if (!input.observation || input.observation.worldId !== world.id) throw new Error("EXECUTION_WORLD_MISMATCH")
    const endpoint = world.endpoints.find((candidate) => candidate.id === input.observation?.endpointId)
    if (!endpoint) throw new Error("EXECUTION_ENDPOINT_NOT_ADMITTED")
    branch = endpoint.branch
    head = endpoint.head
  }

  const [resource] = await db
    .select({ ratifiedAt: projectResource.ratifiedAt, allowedOperations: projectResource.allowedOperations })
    .from(projectResource)
    .where(and(
      eq(projectResource.id, resourceRecordId),
      eq(projectResource.userId, input.userId),
      eq(projectResource.canonicalIdentity, resourceIdentity),
    ))
    .limit(1)
  if (!resource?.ratifiedAt) throw new Error("RUNTIME_RESOURCE_NOT_RATIFIED")
  if (!resource.allowedOperations.includes(input.action) && !resource.allowedOperations.includes("environment:*")) {
    throw new Error("RUNTIME_RESOURCE_OPERATION_NOT_ALLOWED")
  }

  const [work] = await db
    .select()
    .from(workOrder)
    .where(and(eq(workOrder.userId, input.userId), eq(workOrder.ref, input.workOrderRef)))
    .limit(1)
  if (!work || !["active", "review"].includes(work.status)) throw new Error("RUNTIME_WORK_ORDER_NOT_ACTIVE")
  if (!work.description?.includes(`[environment-world:${input.worldId}]`)) {
    throw new Error("RUNTIME_WORK_ORDER_WORLD_MISMATCH")
  }
  if (!scopeCovers(work.scope, resourceIdentity, resourceRecordId)) throw new Error("RUNTIME_WORK_ORDER_RESOURCE_MISMATCH")

  const [grant] = await db
    .select()
    .from(authorityGrant)
    .where(and(eq(authorityGrant.userId, input.userId), eq(authorityGrant.ref, input.grantRef)))
    .limit(1)
  if (!grant || grant.id !== work.authorityGrantId || grant.workOrderId !== work.id) {
    throw new Error("RUNTIME_AUTHORITY_BINDING_MISMATCH")
  }
  if (!scopeCovers(grant.scope, resourceIdentity, resourceRecordId)) throw new Error("RUNTIME_AUTHORITY_SCOPE_MISMATCH")
  const covered = grantCovers(grant, "A2_WRITE_OWN", input.action)
  if (!covered.ok) throw new Error("RUNTIME_AUTHORITY_NOT_GRANTED")

  const required = unique(input.evidenceRefs)
  if (required.length === 0 || !/^[0-9a-f]{64}$/.test(input.payloadDigest)) {
    throw new Error("RUNTIME_EVIDENCE_REQUIRED")
  }
  const rows = await db
    .select({
      id: evidenceRecord.id,
      ref: evidenceRecord.ref,
      result: evidenceRecord.result,
      repo: evidenceRecord.repo,
      branch: evidenceRecord.branch,
      head: evidenceRecord.head,
      contentHash: evidenceRecord.contentHash,
    })
    .from(evidenceRecord)
    .where(and(eq(evidenceRecord.userId, input.userId), eq(evidenceRecord.workOrderId, work.id)))
  const byRef = new Map(rows.filter((row) => row.ref).map((row) => [row.ref!, row]))
  if (required.some((ref) => !byRef.has(ref))) throw new Error("RUNTIME_EVIDENCE_BINDING_MISMATCH")
  const matched = required.map((ref) => byRef.get(ref)!)
  for (const evidence of matched) {
    if (evidence.repo !== resourceIdentity || evidence.branch !== branch || evidence.head !== head) {
      throw new Error("RUNTIME_EVIDENCE_SOURCE_MISMATCH")
    }
    if (evidence.contentHash !== input.payloadDigest) throw new Error("RUNTIME_EVIDENCE_DIGEST_MISMATCH")
  }
  if (input.action === "environment:admit-endpoint" && matched.some((row) => row.result !== "PASS")) {
    throw new Error("RUNTIME_ENDPOINT_EVIDENCE_NOT_PASSING")
  }
  if (input.action === "environment:observe-execution") {
    if (input.observation?.outcome === "succeeded" && matched.some((row) => row.result !== "PASS")) {
      throw new Error("RUNTIME_SUCCESS_EVIDENCE_NOT_PASSING")
    }
    if (input.observation?.outcome === "failed" && matched.every((row) => row.result === "PASS")) {
      throw new Error("RUNTIME_FAILURE_EVIDENCE_MISMATCH")
    }
  }

  return { world, work, grant, evidence: matched }
}

function scopeCovers(scope: string | null, resourceIdentity: string, resourceRecordId: number): boolean {
  return Boolean(
    scope?.includes(`[resource:${resourceIdentity}]`) &&
    scope.includes(`[resource-record:${resourceRecordId}]`),
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((ref) => ref.trim()).filter(Boolean))]
}
