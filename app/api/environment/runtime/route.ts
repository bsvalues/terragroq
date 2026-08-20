import { appendGovernanceEvent } from "@/lib/governance/events"
import { environmentWorldService } from "@/lib/environment/server"
import { verifyEndpointLiveness, type UnverifiedWorldEndpoint } from "@/lib/environment/endpoint-liveness"
import { requireEnvironmentRuntimeAuthority } from "@/lib/environment/runtime-ingress"
import type { ExecutionObservation } from "@/lib/environment/world-projection"
import { authenticatedRuntimeUserId, environmentError, NO_STORE_HEADERS, readEnvironmentJson } from "@/app/api/environment/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RuntimeRequest =
  | { action: "admit_endpoint"; worldId: string; workOrderRef: string; grantRef: string; endpoint: UnverifiedWorldEndpoint }
  | { action: "observe_execution"; worldId: string; workOrderRef: string; grantRef: string; observation: ExecutionObservation }

export async function POST(request: Request) {
  const userId = await authenticatedRuntimeUserId()
  if (!userId) return Response.json({ error: "RUNTIME_DEVICE_REQUIRED" }, { status: 401, headers: NO_STORE_HEADERS })
  let body: RuntimeRequest
  try {
    body = await readEnvironmentJson(request) as RuntimeRequest
  } catch (error) {
    return environmentError(error)
  }
  if (!body || typeof body !== "object" || !("action" in body)) {
    return Response.json({ error: "INVALID_BODY" }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    if (body.action === "admit_endpoint") {
      if (!body.endpoint || body.endpoint.worldId !== body.worldId) throw new Error("ENDPOINT_WORLD_MISMATCH")
      const evidenceRef = body.endpoint.provenance?.evidenceRef
      if (typeof evidenceRef !== "string") throw new Error("RUNTIME_EVIDENCE_REQUIRED")
      const authority = await requireEnvironmentRuntimeAuthority({
        userId,
        worldId: body.worldId,
        workOrderRef: body.workOrderRef,
        grantRef: body.grantRef,
        evidenceRefs: [evidenceRef],
      })
      const endpoint = await verifyEndpointLiveness(body.endpoint, { evidenceRef })
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
        metadata: { workOrderRef: body.workOrderRef, grantRef: body.grantRef, endpointId: endpoint.id },
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
        evidenceRefs: body.observation.evidenceRefs,
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
        metadata: { workOrderRef: body.workOrderRef, grantRef: body.grantRef },
      })
      return Response.json({ world }, { headers: NO_STORE_HEADERS })
    }
    return Response.json({ error: "RUNTIME_ACTION_UNKNOWN" }, { status: 400, headers: NO_STORE_HEADERS })
  } catch (error) {
    return environmentError(error)
  }
}
