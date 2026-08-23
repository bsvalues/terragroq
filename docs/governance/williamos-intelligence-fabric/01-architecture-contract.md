# 01 — Intelligence Fabric Architecture Contract

## 1. Normative outcome

WilliamOS Intelligence Fabric is the governed abstraction that converts a task's intelligence requirements into a measured, policy-compliant placement over approved models, runtimes, compute, providers, and worker lanes while preserving one WilliamOS-owned Thread/context.

It does **not** replace HERMES, the Work Order/queue lifecycle, AEGIS ExecutionBackend, Hermes Agent, or the WilliamOS Environment.

## 2. Ownership boundaries

### WilliamOS control plane owns

- owner intent and Project/Thread identity;
- authority, policy, data classification, privacy, spend boundaries;
- canonical context/evidence provenance;
- durable placement/execution records;
- capability admission/promotion policy;
- owner-facing truth.

### HERMES supervisor owns

- resident continuation;
- scheduling and recovery;
- querying Intelligence Fabric for placements;
- acquiring/releasing compute reservations;
- provider/runtime availability handling;
- invoking existing governed worker/execution paths;
- reroute/wait behavior for routine failures.

### Intelligence Fabric owns

- model/runtime/compute registries;
- Context Fabric compilation;
- capability evidence;
- placement candidate evaluation;
- hard policy/capacity gates;
- model/runtime lifecycle and residency state;
- accelerator reservations;
- elastic-compute abstraction;
- intelligence execution telemetry/provenance.

### Worker lanes own

Bounded execution behavior for a governed Work Order. `codex`, `claude`, `hermes-local`, and future lanes remain execution actors. They do not become the Intelligence Fabric and may not grant themselves capability.

### Runtime adapters own

The mechanics of invoking one inference/runtime interface. Runtime adapters do not own task authority, Project/Thread continuity, placement policy, or provider selection.

### Compute adapters own

Truthful resource discovery/reservation/provisioning mechanics. They do not decide whether data or spend is authorized.

## 3. Required separation of dimensions

Never collapse these into one provider/model object:

- `WorkerLane`
- `ModelArtifact`
- `Runtime`
- `RuntimeConfiguration`
- `ComputeResource`
- `CapabilityEvidence`
- `ContextPackage`
- `InferenceRequirement`
- `PlacementDecision`
- `InferenceExecution`
- `AcceleratorReservation`

A valid execution may look like:

`Hermes Agent × Qwen model × vLLM × P40`

or:

`Hermes Agent × Llama model × vLLM × ephemeral H100`

or:

`Codex lane × provider-managed model × provider-managed compute`.

The abstractions must support all three without pretending they have identical trust, lifecycle, observability, or capacity semantics.

## 4. Context authority

Canonical continuity is WilliamOS-owned. Existing Hermes session state remains a provider/runtime optimization.

A model session may disappear without destroying the Thread. A provider may change without requiring owner copy/paste. A context package is explicitly compiled and digest-bound for every intelligence execution.

Context compilation MUST:

- select only required Project/Thread/work/evidence/memory state;
- preserve authority metadata separately from untrusted task/context text;
- exclude credentials/secrets unless an explicitly governed tool boundary requires them, in which case the model still should not receive raw credentials;
- record sources, truncation, compression/summarization steps, token estimate, and digest;
- support model-specific formatting only after canonical context selection;
- make stale/missing context truth explicit.

## 5. Placement order

Placement applies hard gates before optimization.

### Hard gates

1. authority and work scope;
2. data classification / egress;
3. allowed provider/compute trust class;
4. proven capability;
5. required modality/tool support;
6. context fit;
7. runtime/hardware compatibility;
8. fresh resource capacity;
9. active spend ceiling if cost is nonzero.

A candidate failing a hard gate is refused, not merely penalized.

### Optimization dimensions

Among eligible candidates, policy may score:

- measured quality;
- reliability/failure rate;
- latency/TTFT;
- queue delay;
- locality;
- load/model-residency benefit;
- monetary cost;
- expected completion time;
- energy/thermal pressure where measured;
- fallback resilience.

All scoring inputs used for consequential routing must be inspectable after the fact.

## 6. Logical capacity versus physical VRAM

WilliamOS MAY expose a logical intelligence/accelerator capacity summary, but MUST NOT represent internet-connected GPU memory as physically contiguous VRAM unless a runtime and interconnect have actually proven that memory is jointly addressable for the selected execution.

Remote GPU usually means workload placement. Local multi-GPU/runtime-supported clusters may use model/tensor/pipeline parallelism when independently measured and admitted.

## 7. Priority and preemption

Minimum priority classes:

- REALTIME
- INTERACTIVE
- NORMAL
- BACKGROUND
- MAINTENANCE

Every reservation declares preemptibility. Background evaluation/model warming may be displaced by interactive owner work. Non-preemptible work requires explicit justification in policy.

## 8. Model residency

Minimum lifecycle states:

- UNLOADED
- LOADING
- WARM
- ACTIVE
- IDLE
- EVICTING
- FAILED

Residency decisions are capacity-aware and evidenced. Loading a model is not the same as granting it capability.

## 9. Elastic compute

Elastic compute is default-off until an approved provider adapter, data policy, egress policy, resource identity lifecycle, and spend authority are all active.

Provisioned workers are work-owned ephemeral resources, not durable agent identities.

Required lifecycle:

`REQUESTED -> PROVISIONING -> ATTESTING -> READY -> RESERVED -> EXECUTING -> SETTLING -> WIPING -> DESTROYING -> DESTROYED`

Failure states must distinguish provider, policy, provisioning, identity, runtime, workload, wipe, and destroy failures. Destroy/wipe failures are high-priority recovery obligations because cost/data exposure may continue.

## 10. Provider-managed API versus private remote compute

Treat these as separate execution classes:

- `EXTERNAL_MODEL_API` — prompt/context is processed by a provider-managed model service.
- `PRIVATE_EPHEMERAL_COMPUTE` — WilliamOS launches an approved model/runtime on rented compute with separately controlled network/identity policy.

A privacy rule permitting one does not imply permission for the other.

## 11. Multimodal architecture

The Fabric is modality-neutral. Minimum modality vocabulary should support:

- text
- image
- audio
- video
- document
- embedding
- rerank
- structured-data

Do not force specialist embedding, reranking, speech, or vision services through repository worker-lane semantics.

## 12. Evidence-before-capability

A configured/reachable model is not capable merely because an adapter returns 200.

Capability promotion requires evidence produced by a measurement/evaluation path that is independent from the subject's ability to edit its own capability record.

The existing `hermes-local` measured-capability doctrine is the precedent to generalize.

## 13. Normal UX

Normal owner experience remains the WilliamOS Environment. Model/runtime/compute/provider selection is automatic.

Allowed progressive disclosure:

- current state in Thread;
- relevant artifacts and proof;
- optional Inspect/Technical execution topology;
- optional engineering administration for model installation/benchmark/pinning/budgets.

Forbidden as normal prerequisite:

- choose model;
- choose GPU;
- choose runtime;
- launch cloud worker;
- copy context;
- restart inference service;
- move between separate provider conversations.

## 14. Non-goals for V1

V1 does not require:

- globally optimal routing;
- arbitrary distributed tensor parallelism across WAN;
- every cloud GPU provider;
- every model family;
- automatic purchases;
- public multi-tenant SaaS semantics;
- replacing existing governed work execution;
- exposing raw terminals or infrastructure privileges to the model;
- self-modifying routing policy without review.
