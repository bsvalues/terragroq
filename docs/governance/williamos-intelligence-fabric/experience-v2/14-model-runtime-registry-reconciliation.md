# 14 — Model / Runtime Registry Reconciliation

## Purpose

Prevent IF-01/IF-03/IF-08 from creating a fresh model/runtime registry or capability doctrine when current WilliamOS already contains several strong, partially overlapping sources of model identity, runtime identity, availability, promotion and measured capability.

## Current-main evidence found during review

### Application inference identity

`lib/ai/config.ts` already centralizes the active WilliamOS chat and embedding model identities and the generic OpenAI-compatible inference endpoint. It explicitly anticipates that the endpoint may later become a policy router, vLLM or distributed inference surface without rewriting application consumers.

This is an application-facing compatibility seam, not a complete governed model registry.

### Promoted resident Hermes Agent path

`config/execution-fabric/hermes-free-dev-agent-v2.policy.json` already binds an exact resident worker path including:

- provider identity;
- Hermes Agent runtime source commit;
- container image identity/digest;
- execution node;
- exact local model identity and base model;
- context length;
- inference endpoint contract;
- concurrency, turn and timeout limits;
- network/workspace containment;
- cloud-fallback prohibition;
- promotion status and scoped evidence;
- independent review provenance.

For that contained worker path, this policy remains authoritative until explicitly superseded. A global registry may project/adapt it; it may not weaken or silently replace its safety contract.

### Resident-model proof

`scripts/hermes-bridge/resident-model-probe.mjs` exercises the same Hermes kernel client used by the orchestrator against the owned worktree path and retains per-thread session identity and continuity evidence. This is execution-path evidence, not generic model discovery.

### Provider/lane availability

`scripts/hermes-bridge/provider-status.mjs` and `scripts/runtime-operator/worker-lanes.mjs` already separate provider availability from capability. Provider exhaustion is persisted as a typed temporary condition and lane selection can reroute only among capable lanes.

This distinction is mandatory for Intelligence Fabric:

`reachable/available != capable != promoted != authorized for this work`

### Measured capability

`scripts/runtime-operator/measure-lane-capability.mjs` already establishes another important invariant: a local lane cannot self-promote merely because it is reachable. A bounded external measurement runs the real lane against the real walls and stores a verdict plus evidence; `worker-lanes.mjs` admits implementation capability only for a `PROVEN` record with cited evidence.

This is a predecessor of the proposed model × runtime × configuration × compute `CapabilityEvidence` doctrine.

### Embedding model/runtime attestation

The governed embedding bakeoff already binds exact model ID/revision/weights digest/license/source, runtime ID/version/executable/container/interpreter digests, host identity and inventory snapshot. Those specialist manifests are stronger than the current global chat constants and should inform the common identity envelope without turning embedding-specific code into the universal registry.

## Architecture conclusion

WilliamOS does not currently have one complete universal model/runtime registry. It has multiple authoritative fragments with different scopes.

Therefore the correct IF-01/IF-03 job is **normalization and governed projection**, not replacement.

Preferred layering:

```text
source-specific authoritative records
  application inference config
  resident Hermes Agent policy
  lane/provider status
  lane capability measurement
  embedding model/runtime/host manifests
  live runtime/compute observations
        |
        v
Intelligence Fabric normalized read model
  ModelArtifact
  Runtime
  RuntimeConfiguration
  CapabilityEvidence
  availability / promotion / authority projections
        |
        v
existing application inference + worker + Execution Fabric consumers
```

The normalized view must retain source references/digests and scope so that it is always possible to answer: "which record actually authorized or proved this claim?"

## Mandatory identity separation

The following identities must not collapse into one object or string:

1. **ModelArtifact** — immutable/revisioned model weights/artifact identity and provenance.
2. **Runtime** — serving/execution software identity such as Ollama, llama.cpp, vLLM, Hermes Agent or provider API contract.
3. **RuntimeConfiguration** — context length, quantization/runtime flags, batching, tool mode, KV policy and other consequential configuration.
4. **ComputeResource / ComputeClass** — the hardware/topology on which the runtime was measured.
5. **Provider / Worker lane** — the execution actor or external provider surface.
6. **CapabilityEvidence** — what an exact combination has actually proven it can do.
7. **AvailabilityObservation** — whether it can be reached/used now.
8. **Authority** — whether this exact work may use it.

A model being installed must not imply capability. A capability being proven must not imply availability. Availability must not imply authority.

## IF-03 adoption rule

The first registry-backed local path should be an exact representation of the already-promoted resident path, not a reconfiguration:

- preserve `williamos-qwen3-4b:64k` identity as currently bound by policy;
- preserve its Hermes Agent runtime/image/policy provenance;
- preserve no-cloud-fallback and containment properties;
- project the existing promotion/evidence into the new read model with exact scope;
- prove registry reconstruction of the same effective identity before any consumer switches to registry lookup.

No automatic model pull/download is authorized by adoption.

## IF-05 interaction

Capability promotion must generalize the current measured-lane doctrine:

- subject cannot promote itself;
- evidence binds exact model × runtime × configuration × compute class;
- capability is task-class specific;
- changed model/revision/runtime/configuration/hardware must invalidate or explicitly narrow inherited evidence;
- infrastructure failures remain distinct from model incapability.

The existing lane measurement made this distinction explicitly and must not be regressed.

## IF-08 residency boundary

Search of current-main found model identity and execution evidence but did not establish a general model-residency manager with governed warm/idle/evict state, VRAM/KV accounting and reservation-aware preemption.

Treat that as **likely genuinely missing**, but IF-08 must prove it against current `origin/main` and live runtime before implementation.

Even if residency is new, it must reuse existing lease/fence patterns from Execution Fabric/evaluation where semantically applicable rather than invent a weaker lock protocol.

## Required reconciliation classification

Before IF-01/IF-03 mutation, classify at minimum:

- `lib/ai/config.ts` / `lib/ai/provider.ts`;
- resident Hermes Agent policy;
- resident-model probe/session evidence;
- provider-status;
- worker-lane roster;
- lane-capability measurement store;
- embedding model/runtime/host manifests;
- Execution Fabric runtime observations;
- any newer open-PR/current-main model registry work.

Each must be one of:

- `REUSE_AS_IS`
- `EXTEND_EXISTING`
- `ADAPT_AT_BOUNDARY`
- `SPECIALIST_ONLY`
- `DERIVED_PROJECTION_ONLY`
- `SUPERSEDED_BY_CURRENT_MAIN`
- `GENUINELY_MISSING`

## Acceptance

`IF_MODEL_RUNTIME_REGISTRY_RECONCILED: PASS` only when:

- no authoritative predecessor record loses its scope/provenance;
- the new domain model distinguishes artifact/runtime/config/compute/provider/capability/availability/authority;
- current resident execution can be reconstructed exactly from normalized records;
- existing execution behavior remains unchanged during adoption;
- model/runtime capability cannot self-promote;
- provider exhaustion remains availability evidence rather than capability evidence;
- embedding specialist attestations remain referenceable;
- no model download, runtime replacement or cloud fallback is introduced by registry creation;
- IF-08 proves model-residency machinery genuinely missing before building it.

Failure state: `FAILED_MODEL_RUNTIME_PREDECESSORS_NOT_RECONCILED`.
