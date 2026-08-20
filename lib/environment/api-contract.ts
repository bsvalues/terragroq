import type { SurfaceKind } from "@/lib/environment/working-world"
import type {
  EnvironmentWorldProjection,
  EnvironmentWorldStatus,
  ResourceBinding,
  WorldEndpointIdentity,
} from "@/lib/environment/world-projection"

export type EnvironmentSurfaceDto = Readonly<{
  id: string
  kind: SurfaceKind
  subject: string
  /** Exact admitted endpoint this surface is bound to; URLs are display data, not identity. */
  endpointId: string
  title?: string
  status: "ready" | "running" | "passed" | "failed" | "waiting" | "unavailable"
  provenance: Readonly<{
    source: string
    observedAt?: string
    artifactRef?: string
    evidenceRef?: string
  }>
  content?: unknown
}>

export type EnvironmentConversationTurnDto = Readonly<{
  id: string
  role: "owner" | "williamos"
  content: string
  at: string
}>

export type EnvironmentWorldDto = Readonly<{
  worldId: string
  intent: string
  assumption: string | null
  resource: ResourceBinding | null
  conversation: readonly EnvironmentConversationTurnDto[]
  surfaces: readonly EnvironmentSurfaceDto[]
  endpoints: readonly WorldEndpointIdentity[]
  status: EnvironmentWorldStatus
  execution: EnvironmentWorldProjection["execution"]
  lastUpdatedAt: string
}>

export type EnvironmentLineState =
  | "waiting_for_resource"
  | "waiting_for_execution_endpoint"
  | "ready"
  | "continued"

export type EnvironmentLineResponse = Readonly<{
  state: EnvironmentLineState
  say: string
  world: EnvironmentWorldDto
}>

export type EnvironmentCompareResponse = Readonly<{
  state: "waiting_for_distinct_endpoints" | "waiting_for_comparison_evidence" | "compared"
  say: string
  conflicts: readonly string[]
  leftWorld: EnvironmentWorldDto
  rightWorld: EnvironmentWorldDto
  comparisonSurface?: EnvironmentSurfaceDto
}>

const ENDPOINT_LIVENESS_TTL_MS = 30_000

function hasFreshEndpointReceipt(endpoint: WorldEndpointIdentity, nowMs: number): boolean {
  const liveness = endpoint.provenance.liveness
  const observedAt = Date.parse(liveness.observedAt)
  const publicObservedAt = Date.parse(liveness.publicRoute.observedAt)
  return liveness.status === "reachable" && liveness.publicRoute.status === "reachable" &&
    Number.isFinite(observedAt) && Number.isFinite(publicObservedAt) &&
    nowMs >= observedAt && nowMs - observedAt <= ENDPOINT_LIVENESS_TTL_MS &&
    nowMs >= publicObservedAt && nowMs - publicObservedAt <= ENDPOINT_LIVENESS_TTL_MS
}

export function toEnvironmentWorldDto(
  world: EnvironmentWorldProjection,
  lastUpdatedAt: string,
  nowMs = Date.now(),
): EnvironmentWorldDto {
  const endpoints = new Map(world.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const freshEndpointIds = new Set(
    world.endpoints.filter((endpoint) => hasFreshEndpointReceipt(endpoint, nowMs)).map((endpoint) => endpoint.id),
  )
  return {
    worldId: world.id,
    intent: world.meaning.intent,
    assumption: world.meaning.assumption,
    resource: world.resource,
    conversation: world.meaning.conversation.map((turn, index) => ({
      id: `${turn.at}:${index}`,
      ...turn,
    })),
    surfaces: world.surfaces.map((surface) => {
      const endpoint = endpoints.get(surface.binding.endpointId)
      const artifact = surface.binding.type === "artifact" ? surface.binding : null
      const endpointIsFresh = freshEndpointIds.has(surface.binding.endpointId)
      const status = !artifact && !endpointIsFresh
        ? "unavailable"
        : surface.kind === "tests" && !artifact
        ? "waiting"
        : surface.kind === "tests" && world.execution.state === "observed_succeeded"
          ? "passed"
          : surface.kind === "tests" && world.execution.state === "observed_failed"
            ? "failed"
            : "ready"
      return {
        id: surface.id,
        kind: surface.kind,
        subject: surface.subject,
        endpointId: surface.binding.endpointId,
        title: surface.because,
        status,
        provenance: artifact
          ? {
              source: "execution_evidence",
              observedAt: endpoint?.provenance.liveness.observedAt,
              artifactRef: artifact.artifactRef,
              evidenceRef: artifact.evidenceRef,
            }
          : {
              source: endpoint?.provenance.source ?? "unavailable",
              observedAt: endpoint?.provenance.liveness.observedAt,
              evidenceRef: endpoint?.provenance.liveness.sourceEvidenceRef,
            },
        content: surface.content,
      }
    }),
    endpoints: world.endpoints,
    status: world.status === "ready" && freshEndpointIds.size === 0
      ? "waiting_for_execution_endpoint"
      : world.status,
    execution: world.execution,
    lastUpdatedAt,
  }
}
