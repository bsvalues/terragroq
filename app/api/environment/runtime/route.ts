import { appendGovernanceEvent } from "@/lib/governance/events"
import { environmentWorldService } from "@/lib/environment/server"
import { verifyEndpointLiveness } from "@/lib/environment/endpoint-liveness"
import { requireEnvironmentRuntimeAuthority } from "@/lib/environment/runtime-ingress"
import {
  environmentRuntimePayloadDigest,
  parseEnvironmentRuntimeRequest,
  runtimeEvidenceRefs,
  type EnvironmentRuntimeRequest,
} from "@/lib/environment/runtime-contract"
import { authenticatedRuntimeUserId, environmentError, NO_STORE_HEADERS, readEnvironmentJson } from "@/app/api/environment/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const userId = await authenticatedRuntimeUserId()
  if (!userId) return Response.json({ error: "RUNTIME_DEVICE_REQUIRED" }, { status: 401, headers: NO_STORE_HEADERS })
  let body: EnvironmentRuntimeRequest
  try {
    body = parseEnvironmentRuntimeRequest(await readEnvironmentJson(request))
  } catch (error) {
    return environmentError(error)
  }

  try {
    const evidenceRefs = runtimeEvidenceRefs(body)
    const payloadDigest = environmentRuntimePayloadDigest(body)
    if (body.action === "admit_endpoint") {
      if (body.endpoint.worldId !== body.worldId) throw new Error("ENDPOINT_WORLD_MISMATCH")
      const evidenceRef = body.endpoint.provenance?.evidenceRef
      const authority = await requireEnvironmentRuntimeAuthority({
        userId,
        worldId: body.worldId,
        workOrderRef: body.workOrderRef,
        grantRef: body.grantRef,
        action: "environment:admit-endpoint",
        payloadDigest,
        evidenceRefs,
        endpoint: body.endpoint,
      })
      const endpoint = await verifyEndpointLiveness(body.endpoint, { sourceEvidenceRef: evidenceRef })
      const world = await environmentWorldService.admitEndpoint(userId, body.worldId, endpoint)
      await appendGovernanceEvent({
        userId,
        eventType: "EVIDENCE_RECORDED",
        entityType: "environment_world",
        entityId: body.worldId,
        actor: "runtime-device",
        reason: "Admitted a live world endpoint under exact authority and evidence",
        evidenceId: authority.evidence[0]?.id,
        after: endpoint,
        metadata: { workOrderRef: body.workOrderRef, grantRef: body.grantRef, endpointId: endpoint.id, payloadDigest },
      })
      return Response.json({ world }, { headers: NO_STORE_HEADERS })
    }

    if (body.action === "observe_execution") {
      if (!body.observation || body.observation.worldId !== body.worldId) throw new Error("EXECUTION_WORLD_MISMATCH")
      const authority = await requireEnvironmentRuntimeAuthority({
        userId,
        worldId: body.worldId,
        workOrderRef: body.workOrderRef,
        grantRef: body.grantRef,
        action: "environment:observe-execution",
        payloadDigest,
        evidenceRefs,
        observation: body.observation,
      })
      const world = await environmentWorldService.observeExecution(userId, body.observation)
      await appendGovernanceEvent({
        userId,
        eventType: "EVIDENCE_RECORDED",
        entityType: "environment_world",
        entityId: body.worldId,
        actor: "runtime-device",
        reason: "Projected execution evidence into the Environment",
        evidenceId: authority.evidence[0]?.id,
        after: body.observation,
        metadata: { workOrderRef: body.workOrderRef, grantRef: body.grantRef, payloadDigest },
      })
      return Response.json({ world }, { headers: NO_STORE_HEADERS })
    }
    return Response.json({ error: "RUNTIME_ACTION_UNKNOWN" }, { status: 400, headers: NO_STORE_HEADERS })
  } catch (error) {
    return environmentError(error)
  }
}
