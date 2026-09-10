# 02 — Intelligence Fabric Domain Contracts

This document is normative for IF-01. Exact implementation language/schema is selected by current-main repository conventions after #831 proof, but semantic fields and invariants below must survive.

## 1. `ModelArtifact`

Required fields:

```ts
interface ModelArtifact {
  id: string
  family: string
  revision: string
  source: string
  immutableIdentity: string
  weightDigest?: string
  tokenizerDigest?: string
  chatTemplateDigest?: string
  configDigest?: string
  quantization?: string
  architecture: string
  modalities: string[]
  declaredContextTokens?: number
  licenseId?: string
  licenseEvidenceRef?: string
  commercialUse?: "ALLOWED" | "DENIED" | "UNKNOWN"
  redistribution?: "ALLOWED" | "DENIED" | "UNKNOWN"
  sourceTrust: "APPROVED" | "QUARANTINED" | "UNKNOWN" | "DENIED"
  admission: "DISCOVERED" | "QUARANTINED" | "CANDIDATE" | "APPROVED" | "ACTIVE" | "FALLBACK" | "RETIRED" | "DENIED"
  createdAt: string
}
```

Invariants:

- mutable display names are never execution identity;
- remote provider models need an immutable provider/version identity when weights are unavailable;
- license unknown cannot silently become approved for deployment;
- ACTIVE requires prior capability evidence for the intended capability, not merely artifact admission.

## 2. `Runtime`

```ts
interface Runtime {
  id: string
  kind: "OLLAMA" | "LLAMA_CPP" | "VLLM" | "HERMES_AGENT" | "EXTERNAL_API" | "SPECIALIST"
  version: string
  buildIdentity?: string
  endpointClass?: "OPENAI_COMPATIBLE" | "NATIVE" | "CLI" | "INTERNAL"
  lifecycle: "UNKNOWN" | "OFFLINE" | "STARTING" | "HEALTHY" | "DEGRADED" | "FAILED" | "STOPPING"
  observedAt?: string
}
```

Hardware/runtime feature support is stored separately as evidence; never one `supportsGaudi`/`supportsMultiGpu` boolean without version/platform scope.

## 3. `RuntimeCapability`

```ts
interface RuntimeCapability {
  runtimeId: string
  hardwarePlatform: string
  feature: string
  verdict: "UNKNOWN" | "SUPPORTED" | "MEASURED" | "PROVEN" | "DEGRADED" | "FAILED" | "UNAVAILABLE"
  evidenceRef?: string
  observedAt?: string
}
```

Examples: OpenAI-compatible serving, tensor parallel, pipeline parallel, LoRA, multimodal, embeddings, rerank, tool-call pass-through, CPU offload, KV offload, disaggregated prefill.

## 4. `ComputeResource`

```ts
interface ComputeResource {
  id: string
  fabricNodeId?: string
  providerId?: string
  locationClass: "LOCAL_HOST" | "LOCAL_FABRIC" | "PRIVATE_REMOTE" | "PROVIDER_MANAGED"
  trustClass: string
  accelerator?: {
    vendor: string
    model: string
    architecture?: string
    count: number
    memoryBytesPerDevice?: number
  }
  cpu?: { logicalCores?: number; architecture?: string }
  systemMemoryBytes?: number
  storageClass?: string
  networkClass?: string
  lifecycle: "UNKNOWN" | "OFFLINE" | "AVAILABLE" | "RESERVED" | "DEGRADED" | "DRAINING" | "FAILED" | "DESTROYED"
  observedAt?: string
  expiresAt?: string
}
```

Freshness is mandatory for AVAILABLE claims. Persisted hardware inventory without a fresh observation is not free capacity.

## 5. `ResourceCapacity`

Capacity must distinguish at least:

- accelerator weight/model memory;
- accelerator KV/cache memory;
- runtime overhead;
- system RAM;
- CPU allocation;
- current reservations;
- optional model residency allocations.

A resource can have enough physical VRAM for one job while lacking admissible capacity due to existing reservations.

## 6. `CapabilityEvidence`

```ts
interface CapabilityEvidence {
  id: string
  capability: string
  verdict: "UNKNOWN" | "SUPPORTED" | "MEASURED" | "PROVEN" | "DEGRADED" | "FAILED" | "RETIRED"
  modelArtifactId: string
  runtimeId: string
  runtimeConfigDigest: string
  computeResourceClass: string
  evaluationId: string
  evidenceRef: string
  measuredAt: string
  metrics: Record<string, number | string | boolean | null>
  promotedBy?: string
}
```

`promotedBy` may not equal the execution identity being measured when promotion would expand production eligibility.

Recommended metrics include: quality score, exact-task success, schema validity, tool accuracy, authority compliance, semantic-scope compliance, prompt-injection resistance, context tested, TTFT, tokens/sec, peak VRAM/RAM, failure rate, cost.

## 7. `ContextPackage`

```ts
interface ContextPackage {
  id: string
  schemaVersion: number
  projectId?: string
  threadId?: string
  workOrderRef?: string
  sourceRefs: string[]
  authorityRef?: string
  classification: string
  includedSections: Array<{ kind: string; sourceRef: string; digest: string }>
  excludedClasses: string[]
  compressionSteps: Array<{ kind: string; inputDigest: string; outputDigest: string; evidenceRef?: string }>
  estimatedTokens?: number
  digest: string
  compiledAt: string
}
```

The package contains or references task/context data; authority is never derived from prompt text. Secret-bearing material is excluded by default.

## 8. `InferenceRequirement`

```ts
interface InferenceRequirement {
  id: string
  workRef: string
  requiredCapabilities: string[]
  preferredCapabilities?: string[]
  modalities: string[]
  minimumContextTokens?: number
  classification: string
  egressPolicyId: string
  toolAuthorityRef?: string
  priority: "REALTIME" | "INTERACTIVE" | "NORMAL" | "BACKGROUND" | "MAINTENANCE"
  qualityTarget?: string
  latencyTargetMs?: number
  maxCostUsd?: number
  continuity: "STATELESS" | "THREAD"
  allowedExecutionClasses: Array<"LOCAL" | "PRIVATE_REMOTE" | "EXTERNAL_MODEL_API">
  fallbackAllowed: boolean
}
```

This object describes needs, not a chosen model.

## 9. `PlacementDecision`

```ts
interface PlacementDecision {
  id: string
  requirementId: string
  contextPackageId: string
  considered: Array<{
    candidateId: string
    eligible: boolean
    refusals: string[]
    score?: number
    evidenceRefs: string[]
  }>
  selected: {
    workerLaneId?: string
    modelArtifactId?: string
    runtimeId?: string
    runtimeConfigDigest?: string
    computeResourceId?: string
    executionClass: string
  }
  fallbackCandidateIds: string[]
  policyDigest: string
  reason: string
  decidedAt: string
}
```

The decision is immutable evidence. Re-placement after failure creates a new decision linked to the prior execution/failure; it does not overwrite history.

## 10. `AcceleratorReservation`

```ts
interface AcceleratorReservation {
  id: string
  computeResourceId: string
  workRef: string
  threadId?: string
  modelArtifactId?: string
  requestedWeightBytes?: number
  requestedKvBytes?: number
  requestedSystemMemoryBytes?: number
  priority: string
  preemptible: boolean
  fencingToken: number
  leaseExpiresAt: string
  state: "REQUESTED" | "ACTIVE" | "PREEMPTING" | "RELEASED" | "EXPIRED" | "FAILED"
}
```

Reservation/fence semantics should reuse proven WilliamOS patterns where current-main implementation allows; do not invent a weaker GPU-specific concurrency model.

## 11. `InferenceExecution`

```ts
interface InferenceExecution {
  id: string
  requirementId: string
  placementDecisionId: string
  contextPackageId: string
  reservationId?: string
  parentExecutionId?: string
  state: "QUEUED" | "LOADING" | "RUNNING" | "VALIDATING" | "COMPLETED" | "WAITING" | "FAILED" | "CANCELLED"
  failureClass?: string
  startedAt?: string
  finishedAt?: string
  metrics: Record<string, number | string | boolean | null>
  toolEvidenceRefs: string[]
  resultEvidenceRef?: string
}
```

## 12. `EgressPolicy`

Must be able to express independent permission for:

- prompts;
- retrieved documents;
- generated embeddings;
- KV/cache state;
- logs/traces;
- model artifacts;
- telemetry;
- tool/network access.

Do not encode egress as one boolean.

## 13. `ElasticWorker`

```ts
interface ElasticWorker {
  id: string
  providerId: string
  computeResourceId: string
  workRef: string
  state: "REQUESTED" | "PROVISIONING" | "ATTESTING" | "READY" | "RESERVED" | "EXECUTING" | "SETTLING" | "WIPING" | "DESTROYING" | "DESTROYED" | "FAILED"
  shortLivedIdentityRef?: string
  provisionEvidenceRef?: string
  wipeEvidenceRef?: string
  destructionEvidenceRef?: string
  maxCostUsd: number
  expiresAt: string
}
```

No durable agent identity is created from an elastic worker.

## 14. Failure vocabulary

Minimum typed failures:

`MODEL_LOAD_FAILED`, `MODEL_OOM`, `KV_CAPACITY_EXHAUSTED`, `CONTEXT_TOO_LARGE`, `RUNTIME_UNHEALTHY`, `ACCELERATOR_UNAVAILABLE`, `CAPABILITY_UNPROVEN`, `PROVIDER_RATE_LIMITED`, `PROVIDER_AUTH_FAILED`, `CLOUD_CAPACITY_UNAVAILABLE`, `BUDGET_EXCEEDED`, `POLICY_DENIED_REMOTE`, `MODEL_OUTPUT_INVALID`, `TOOL_CALL_FAILED`, `QUALITY_GATE_FAILED`, `ELASTIC_IDENTITY_FAILED`, `ELASTIC_WIPE_FAILED`, `ELASTIC_DESTROY_FAILED`.

Each failure maps to deterministic reroute/wait/recovery/escalation policy; no generic `MODEL_FAILED` may be the only durable explanation.
