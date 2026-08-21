import { hashRecord } from "@/lib/governance/hash"
import type { UnverifiedWorldEndpoint } from "@/lib/environment/endpoint-liveness"
import type { ExecutionObservation } from "@/lib/environment/world-projection"

export type EnvironmentRuntimeRequest =
  | Readonly<{ action: "admit_endpoint"; worldId: string; workOrderRef: string; grantRef: string; endpoint: UnverifiedWorldEndpoint }>
  | Readonly<{ action: "observe_execution"; worldId: string; workOrderRef: string; grantRef: string; observation: ExecutionObservation }>

const TEXT_LIMIT = 2_048
const SUMMARY_LIMIT = 8_000
const MAX_EVIDENCE_REFS = 100
const MAX_ARTIFACTS = 20

export function parseEnvironmentRuntimeRequest(raw: unknown): EnvironmentRuntimeRequest {
  const body = record(raw, "RUNTIME_PAYLOAD_MALFORMED")
  const action = text(body.action, "RUNTIME_ACTION_REQUIRED", 64)
  const common = {
    worldId: text(body.worldId, "WORLD_ID_REQUIRED"),
    workOrderRef: text(body.workOrderRef, "RUNTIME_WORK_ORDER_REQUIRED"),
    grantRef: text(body.grantRef, "RUNTIME_GRANT_REQUIRED"),
  }
  if (action === "admit_endpoint") {
    onlyKeys(body, ["action", "worldId", "workOrderRef", "grantRef", "endpoint"])
    return { action, ...common, endpoint: parseEndpoint(body.endpoint) }
  }
  if (action === "observe_execution") {
    onlyKeys(body, ["action", "worldId", "workOrderRef", "grantRef", "observation"])
    return { action, ...common, observation: parseObservation(body.observation) }
  }
  throw new Error("RUNTIME_ACTION_UNKNOWN")
}

export function environmentRuntimePayloadDigest(request: EnvironmentRuntimeRequest): string {
  return hashRecord(request.action === "admit_endpoint"
    ? { action: request.action, worldId: request.worldId, endpoint: request.endpoint }
    : { action: request.action, worldId: request.worldId, observation: request.observation })
}

export function runtimeEvidenceRefs(request: EnvironmentRuntimeRequest): string[] {
  if (request.action === "admit_endpoint") return [request.endpoint.provenance.evidenceRef]
  return unique([
    ...request.observation.evidenceRefs,
    ...(request.observation.artifacts ?? []).map((artifact) => artifact.evidenceRef),
  ])
}

function parseEndpoint(raw: unknown): UnverifiedWorldEndpoint {
  const value = record(raw, "ENDPOINT_MALFORMED")
  onlyKeys(value, [
    "id", "worldId", "resourceIdentity", "sandboxId", "probeUrl", "appUrl", "branch", "head",
    "filesystemRoot", "terminalStreamRef", "testStreamRef", "provenance",
  ])
  const provenance = record(value.provenance, "ENDPOINT_PROVENANCE_REQUIRED")
  onlyKeys(provenance, ["source", "evidenceRef", "capturedAt"])
  const source = text(provenance.source, "ENDPOINT_PROVENANCE_SOURCE_INVALID", 64)
  if (source !== "runtime_registry" && source !== "execution_receipt") {
    throw new Error("ENDPOINT_PROVENANCE_SOURCE_INVALID")
  }
  return {
    id: text(value.id, "ENDPOINT_ID_REQUIRED"),
    worldId: text(value.worldId, "ENDPOINT_WORLD_REQUIRED"),
    resourceIdentity: text(value.resourceIdentity, "ENDPOINT_RESOURCE_REQUIRED"),
    sandboxId: text(value.sandboxId, "ENDPOINT_SANDBOX_REQUIRED"),
    probeUrl: text(value.probeUrl, "ENDPOINT_PROBE_URL_REQUIRED"),
    appUrl: text(value.appUrl, "ENDPOINT_APP_URL_REQUIRED"),
    branch: text(value.branch, "ENDPOINT_BRANCH_REQUIRED"),
    head: text(value.head, "ENDPOINT_HEAD_REQUIRED"),
    filesystemRoot: text(value.filesystemRoot, "ENDPOINT_FILESYSTEM_REQUIRED"),
    terminalStreamRef: text(value.terminalStreamRef, "ENDPOINT_TERMINAL_STREAM_REQUIRED"),
    testStreamRef: text(value.testStreamRef, "ENDPOINT_TEST_STREAM_REQUIRED"),
    provenance: {
      source,
      evidenceRef: text(provenance.evidenceRef, "ENDPOINT_EVIDENCE_REQUIRED"),
      capturedAt: isoInstant(provenance.capturedAt, "ENDPOINT_CAPTURED_AT_INVALID"),
    },
  }
}

function parseObservation(raw: unknown): ExecutionObservation {
  const value = record(raw, "EXECUTION_OBSERVATION_MALFORMED")
  onlyKeys(value, ["worldId", "endpointId", "outcome", "summary", "evidenceRefs", "artifacts"])
  const outcome = text(value.outcome, "EXECUTION_OUTCOME_REQUIRED", 32)
  if (outcome !== "succeeded" && outcome !== "failed") throw new Error("EXECUTION_OUTCOME_INVALID")
  const evidenceRefs = stringArray(value.evidenceRefs, "EXECUTION_EVIDENCE_INVALID", MAX_EVIDENCE_REFS)
  const artifactsRaw = value.artifacts === undefined ? [] : array(value.artifacts, "EXECUTION_ARTIFACTS_INVALID", MAX_ARTIFACTS)
  const artifacts = artifactsRaw.map((rawArtifact) => {
    const artifact = record(rawArtifact, "EXECUTION_ARTIFACT_MALFORMED")
    onlyKeys(artifact, ["artifactRef", "evidenceRef", "kind", "subject", "content"])
    const kind = text(artifact.kind, "ARTIFACT_KIND_REQUIRED", 32)
    if (!new Set(["diff", "tests", "document", "trace", "data", "compare", "conflict"]).has(kind)) {
      throw new Error("ARTIFACT_KIND_INVALID")
    }
    return {
      artifactRef: text(artifact.artifactRef, "ARTIFACT_REF_REQUIRED"),
      evidenceRef: text(artifact.evidenceRef, "ARTIFACT_EVIDENCE_REQUIRED"),
      kind: kind as "diff" | "tests" | "document" | "trace" | "data" | "compare" | "conflict",
      subject: text(artifact.subject, "ARTIFACT_SUBJECT_REQUIRED"),
      ...(artifact.content === undefined ? {} : { content: artifact.content }),
    }
  })
  return {
    worldId: text(value.worldId, "EXECUTION_WORLD_REQUIRED"),
    endpointId: text(value.endpointId, "EXECUTION_ENDPOINT_REQUIRED"),
    outcome,
    summary: text(value.summary, "EXECUTION_SUMMARY_REQUIRED", SUMMARY_LIMIT),
    evidenceRefs,
    ...(artifacts.length === 0 ? {} : { artifacts }),
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code)
  return value as Record<string, unknown>
}

function array(value: unknown, code: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(code)
  return value
}

function stringArray(value: unknown, code: string, max: number): string[] {
  return unique(array(value, code, max).map((item) => text(item, code)))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function text(value: unknown, code: string, max = TEXT_LIMIT): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(code)
  return value.trim()
}

function isoInstant(value: unknown, code: string): string {
  const result = text(value, code, 128)
  if (!Number.isFinite(Date.parse(result))) throw new Error(code)
  return result
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed)
  if (Object.keys(value).some((key) => !set.has(key))) throw new Error("RUNTIME_PAYLOAD_FIELD_UNKNOWN")
}
