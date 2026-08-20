import {
  validateWorkingWorld,
  withSurface,
  type SurfaceKind,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"

const MAX_ENDPOINTS = 8
const MAX_SURFACES = 48
const MAX_ARTIFACTS_PER_OBSERVATION = 20
const MAX_SERIALIZED_CONTENT_BYTES = 2_000_000

export type ResourceBinding = Readonly<{
  candidateId: string
  canonicalIdentity: string
  label: string
}>

export type EndpointProvenance = Readonly<{
  source: "runtime_registry" | "execution_receipt"
  evidenceRef: string
  capturedAt: string
  liveness: Readonly<{
    status: "reachable"
    httpStatus: number
    observedAt: string
    evidenceRef: string
  }>
}>

/**
 * Identity of a real, isolated work endpoint. Every field is required so an application URL cannot
 * masquerade as an isolated world while silently sharing a branch, filesystem, or streams.
 */
export type WorldEndpointIdentity = Readonly<{
  id: string
  worldId: string
  resourceIdentity: string
  sandboxId: string
  appUrl: string
  branch: string
  filesystemRoot: string
  terminalStreamRef: string
  testStreamRef: string
  provenance: EndpointProvenance
}>

export type BoundSurface = Readonly<{
  id: string
  kind: SurfaceKind
  subject: string
  because?: string
  pinned?: boolean
  /** Serializable runtime/evidence content only; never client-inferred truth. */
  content?: unknown
  binding:
    | Readonly<{ type: "endpoint"; endpointId: string }>
    | Readonly<{ type: "artifact"; endpointId: string; artifactRef: string; evidenceRef: string }>
}>

export type ExecutionTruth =
  | Readonly<{ state: "not_started"; evidenceRefs: readonly [] }>
  | Readonly<{
      state: "observed_succeeded" | "observed_failed"
      summary: string
      endpointId: string
      evidenceRefs: readonly string[]
    }>

export type EnvironmentWorldStatus =
  | "waiting_for_resource"
  | "waiting_for_execution_endpoint"
  | "ready"
  | "paused"
  | "settled"

export type EnvironmentWorldProjection = Readonly<{
  schemaVersion: 1
  id: string
  resource: ResourceBinding | null
  meaning: WorkingWorldSnapshot
  endpoints: readonly WorldEndpointIdentity[]
  surfaces: readonly BoundSurface[]
  execution: ExecutionTruth
  status: EnvironmentWorldStatus
}>

export type ExecutionObservation = Readonly<{
  worldId: string
  endpointId: string
  outcome: "succeeded" | "failed"
  summary: string
  evidenceRefs: readonly string[]
  artifacts?: readonly Readonly<{
    artifactRef: string
    evidenceRef: string
    kind: Extract<SurfaceKind, "diff" | "tests" | "document" | "trace" | "data" | "compare" | "conflict">
    subject: string
    content?: unknown
  }>[]
}>

export function createEnvironmentWorldProjection({
  id,
  meaning,
  resource,
}: {
  id: string
  meaning: WorkingWorldSnapshot
  resource: ResourceBinding | null
}): EnvironmentWorldProjection {
  requireText(id, "WORLD_ID_REQUIRED")
  validateWorkingWorld(meaning)
  if (resource) validateResource(resource)
  return {
    schemaVersion: 1,
    id,
    resource,
    meaning,
    endpoints: [],
    surfaces: [],
    execution: { state: "not_started", evidenceRefs: [] },
    status: resource ? "waiting_for_execution_endpoint" : "waiting_for_resource",
  }
}

export function admitWorldEndpoint(
  world: EnvironmentWorldProjection,
  endpoint: WorldEndpointIdentity,
): EnvironmentWorldProjection {
  validateEnvironmentWorldProjection(world)
  validateEndpoint(endpoint)
  if (endpoint.worldId !== world.id) throw new Error("ENDPOINT_WORLD_MISMATCH")
  if (!world.resource || endpoint.resourceIdentity !== world.resource.canonicalIdentity) {
    throw new Error("ENDPOINT_RESOURCE_MISMATCH")
  }

  const endpoints = [...world.endpoints.filter((candidate) => candidate.id !== endpoint.id), endpoint]
  if (endpoints.length > MAX_ENDPOINTS) throw new Error("TOO_MANY_WORLD_ENDPOINTS")
  const endpointSurfaces: BoundSurface[] = [
    {
      id: `${endpoint.id}:application`,
      kind: "browser",
      subject: endpoint.appUrl,
      because: "the isolated application bound to this world",
      content: { url: endpoint.appUrl, sandboxId: endpoint.sandboxId, branch: endpoint.branch },
      binding: { type: "endpoint", endpointId: endpoint.id },
    },
    {
      id: `${endpoint.id}:terminal`,
      kind: "terminal",
      subject: endpoint.terminalStreamRef,
      because: "the terminal stream bound to this world",
      content: { streamRef: endpoint.terminalStreamRef },
      binding: { type: "endpoint", endpointId: endpoint.id },
    },
    {
      id: `${endpoint.id}:tests`,
      kind: "tests",
      subject: endpoint.testStreamRef,
      because: "the test stream bound to this world",
      content: { streamRef: endpoint.testStreamRef },
      binding: { type: "endpoint", endpointId: endpoint.id },
    },
  ]
  const replacedIds = new Set(endpointSurfaces.map((surface) => surface.id))
  const surfaces = [...world.surfaces.filter((surface) => !replacedIds.has(surface.id)), ...endpointSurfaces]
  let meaning = world.meaning
  for (const surface of endpointSurfaces) {
    meaning = withSurface(meaning, {
      kind: surface.kind,
      subject: surface.subject,
      because: surface.because,
    })
  }
  return validateEnvironmentWorldProjection({
    ...world,
    meaning,
    endpoints,
    surfaces,
    status: "ready",
  })
}

/**
 * Execution becomes a claim only through an evidence-bearing observation from an endpoint already
 * admitted to the same world. Line text and model output can never call this boundary successfully.
 */
export function applyExecutionObservation(
  world: EnvironmentWorldProjection,
  observation: ExecutionObservation,
): EnvironmentWorldProjection {
  validateEnvironmentWorldProjection(world)
  if (observation.worldId !== world.id) throw new Error("EXECUTION_WORLD_MISMATCH")
  const endpoint = world.endpoints.find((candidate) => candidate.id === observation.endpointId)
  if (!endpoint) throw new Error("EXECUTION_ENDPOINT_NOT_ADMITTED")
  requireText(observation.summary, "EXECUTION_SUMMARY_REQUIRED")
  const evidenceRefs = uniqueNonEmpty(observation.evidenceRefs)
  if (evidenceRefs.length === 0) throw new Error("EXECUTION_EVIDENCE_REQUIRED")

  if ((observation.artifacts?.length ?? 0) > MAX_ARTIFACTS_PER_OBSERVATION) {
    throw new Error("TOO_MANY_EXECUTION_ARTIFACTS")
  }
  const artifactSurfaces = (observation.artifacts ?? []).map((artifact, index): BoundSurface => {
    requireText(artifact.artifactRef, "ARTIFACT_REF_REQUIRED")
    requireText(artifact.evidenceRef, "ARTIFACT_EVIDENCE_REQUIRED")
    requireText(artifact.subject, "ARTIFACT_SUBJECT_REQUIRED")
    requireSerializable(artifact.content, "ARTIFACT_CONTENT_NOT_SERIALIZABLE")
    return {
      id: `${endpoint.id}:artifact:${index}:${artifact.artifactRef}`,
      kind: artifact.kind,
      subject: artifact.subject,
      because: "evidence produced by observed execution",
      content: artifact.content,
      binding: {
        type: "artifact",
        endpointId: endpoint.id,
        artifactRef: artifact.artifactRef,
        evidenceRef: artifact.evidenceRef,
      },
    }
  })
  let meaning = world.meaning
  for (const surface of artifactSurfaces) {
    meaning = withSurface(meaning, { kind: surface.kind, subject: surface.subject, because: surface.because })
  }
  return validateEnvironmentWorldProjection({
    ...world,
    meaning,
    surfaces: [...world.surfaces, ...artifactSurfaces],
    execution: {
      state: observation.outcome === "succeeded" ? "observed_succeeded" : "observed_failed",
      summary: observation.summary.trim(),
      endpointId: endpoint.id,
      evidenceRefs,
    },
  })
}

export function validateEnvironmentWorldProjection(raw: unknown): EnvironmentWorldProjection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("ENVIRONMENT_WORLD_MALFORMED")
  const world = raw as Record<string, unknown>
  if (world.schemaVersion !== 1) throw new Error("ENVIRONMENT_WORLD_SCHEMA_UNKNOWN")
  requireText(world.id, "WORLD_ID_REQUIRED")
  const meaning = validateWorkingWorld(world.meaning)
  if (world.resource !== null) validateResource(world.resource)
  if (!Array.isArray(world.endpoints) || !Array.isArray(world.surfaces)) {
    throw new Error("ENVIRONMENT_WORLD_COLLECTIONS_REQUIRED")
  }
  if (world.endpoints.length > MAX_ENDPOINTS) throw new Error("TOO_MANY_WORLD_ENDPOINTS")
  if (world.surfaces.length > MAX_SURFACES) throw new Error("TOO_MANY_WORLD_SURFACES")
  const endpoints = world.endpoints.map((endpoint) => validateEndpoint(endpoint))
  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id))
  for (const endpoint of endpoints) {
    if (endpoint.worldId !== world.id) throw new Error("ENDPOINT_WORLD_MISMATCH")
  }
  for (const surface of world.surfaces) validateSurface(surface, endpointIds)
  validateExecution(world.execution, endpointIds)
  if (!["waiting_for_resource", "waiting_for_execution_endpoint", "ready", "paused", "settled"].includes(String(world.status))) {
    throw new Error("ENVIRONMENT_WORLD_STATUS_INVALID")
  }
  return { ...world, meaning } as unknown as EnvironmentWorldProjection
}

function validateResource(raw: unknown): ResourceBinding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("RESOURCE_BINDING_MALFORMED")
  const resource = raw as Record<string, unknown>
  requireText(resource.candidateId, "RESOURCE_CANDIDATE_REQUIRED")
  requireText(resource.canonicalIdentity, "RESOURCE_IDENTITY_REQUIRED")
  requireText(resource.label, "RESOURCE_LABEL_REQUIRED")
  return resource as unknown as ResourceBinding
}

function validateEndpoint(raw: unknown): WorldEndpointIdentity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("ENDPOINT_MALFORMED")
  const endpoint = raw as Record<string, unknown>
  for (const [key, code] of [
    ["id", "ENDPOINT_ID_REQUIRED"],
    ["worldId", "ENDPOINT_WORLD_REQUIRED"],
    ["resourceIdentity", "ENDPOINT_RESOURCE_REQUIRED"],
    ["sandboxId", "ENDPOINT_SANDBOX_REQUIRED"],
    ["appUrl", "ENDPOINT_APP_URL_REQUIRED"],
    ["branch", "ENDPOINT_BRANCH_REQUIRED"],
    ["filesystemRoot", "ENDPOINT_FILESYSTEM_REQUIRED"],
    ["terminalStreamRef", "ENDPOINT_TERMINAL_STREAM_REQUIRED"],
    ["testStreamRef", "ENDPOINT_TEST_STREAM_REQUIRED"],
  ] as const) requireText(endpoint[key], code)
  try {
    const url = new URL(String(endpoint.appUrl))
    if (!/^https?:$/.test(url.protocol)) throw new Error()
  } catch {
    throw new Error("ENDPOINT_APP_URL_INVALID")
  }
  if (!endpoint.provenance || typeof endpoint.provenance !== "object" || Array.isArray(endpoint.provenance)) {
    throw new Error("ENDPOINT_PROVENANCE_REQUIRED")
  }
  const provenance = endpoint.provenance as Record<string, unknown>
  if (!new Set(["runtime_registry", "execution_receipt"]).has(String(provenance.source))) {
    throw new Error("ENDPOINT_PROVENANCE_SOURCE_INVALID")
  }
  requireText(provenance.evidenceRef, "ENDPOINT_EVIDENCE_REQUIRED")
  requireIsoInstant(provenance.capturedAt, "ENDPOINT_CAPTURED_AT_INVALID")
  if (!provenance.liveness || typeof provenance.liveness !== "object" || Array.isArray(provenance.liveness)) {
    throw new Error("ENDPOINT_LIVENESS_REQUIRED")
  }
  const liveness = provenance.liveness as Record<string, unknown>
  if (liveness.status !== "reachable") throw new Error("ENDPOINT_NOT_LIVE")
    if (!Number.isInteger(liveness.httpStatus) || Number(liveness.httpStatus) < 200 || Number(liveness.httpStatus) >= 300) {
    throw new Error("ENDPOINT_LIVENESS_STATUS_INVALID")
  }
  requireIsoInstant(liveness.observedAt, "ENDPOINT_LIVENESS_AT_INVALID")
  requireText(liveness.evidenceRef, "ENDPOINT_LIVENESS_EVIDENCE_REQUIRED")
  return endpoint as unknown as WorldEndpointIdentity
}

function validateSurface(raw: unknown, endpointIds: ReadonlySet<string>): BoundSurface {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("SURFACE_MALFORMED")
  const surface = raw as Record<string, unknown>
  requireText(surface.id, "SURFACE_ID_REQUIRED")
  requireText(surface.kind, "SURFACE_KIND_REQUIRED")
  requireText(surface.subject, "SURFACE_SUBJECT_REQUIRED")
  requireSerializable(surface.content, "SURFACE_CONTENT_NOT_SERIALIZABLE")
  if (!surface.binding || typeof surface.binding !== "object" || Array.isArray(surface.binding)) {
    throw new Error("SURFACE_BINDING_REQUIRED")
  }
  const binding = surface.binding as Record<string, unknown>
  requireText(binding.endpointId, "SURFACE_ENDPOINT_REQUIRED")
  if (!endpointIds.has(String(binding.endpointId))) throw new Error("SURFACE_ENDPOINT_NOT_ADMITTED")
  if (binding.type === "artifact") {
    requireText(binding.artifactRef, "ARTIFACT_REF_REQUIRED")
    requireText(binding.evidenceRef, "ARTIFACT_EVIDENCE_REQUIRED")
  } else if (binding.type !== "endpoint") {
    throw new Error("SURFACE_BINDING_INVALID")
  }
  return surface as unknown as BoundSurface
}

function validateExecution(raw: unknown, endpointIds: ReadonlySet<string>): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("EXECUTION_TRUTH_REQUIRED")
  const execution = raw as Record<string, unknown>
  if (execution.state === "not_started") {
    if (!Array.isArray(execution.evidenceRefs) || execution.evidenceRefs.length !== 0) {
      throw new Error("FALSE_EXECUTION_CLAIM")
    }
    return
  }
  if (execution.state !== "observed_succeeded" && execution.state !== "observed_failed") {
    throw new Error("EXECUTION_STATE_INVALID")
  }
  requireText(execution.summary, "EXECUTION_SUMMARY_REQUIRED")
  requireText(execution.endpointId, "EXECUTION_ENDPOINT_REQUIRED")
  if (!endpointIds.has(String(execution.endpointId))) throw new Error("EXECUTION_ENDPOINT_NOT_ADMITTED")
  if (!Array.isArray(execution.evidenceRefs) || uniqueNonEmpty(execution.evidenceRefs).length === 0) {
    throw new Error("EXECUTION_EVIDENCE_REQUIRED")
  }
}

function uniqueNonEmpty(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
}

function requireText(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code)
}

function requireIsoInstant(value: unknown, code: string): asserts value is string {
  requireText(value, code)
  if (!Number.isFinite(Date.parse(value))) throw new Error(code)
}

function requireSerializable(value: unknown, code: string): void {
  if (value === undefined) return
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error()
    if (new TextEncoder().encode(encoded).byteLength > MAX_SERIALIZED_CONTENT_BYTES) {
      throw new Error("CONTENT_TOO_LARGE")
    }
  } catch {
    throw new Error(code)
  }
}
