# 03 — Integration and Migration Map

This map exists to prevent agents from treating #964 as permission to create a fresh orchestration stack.

## IF-00 collision and component classification map

This table is the build-lane decision record after refreshing the package onto
`origin/main@0e4536ea2ae84a39cc5ffb5c6f48aa4e72576152`. The prior implementation-lineage evidence in
[the Experience V2 Phase 0 collision map](../williamos-experience-v2-phase0-collision-map.md) remains
controlling for its surveyed seams. `SUPERSEDE_COMPOSITION_ONLY` means a new normalized projection
may replace scattered composition, while the cited source records remain authoritative.

| Proposed IF component | Classification | Existing owner / exact path | Build consequence |
| --- | --- | --- | --- |
| Work/authority envelope and lifecycle | `REUSE_AS_IS` | `lib/work-orders/lifecycle.ts`; `scripts/multi-agent-operator/work-order-envelope-v2.mjs`; `tests/multi-agent-work-order-envelope-v2.test.ts` | IF requests carry existing authority; they do not mint another work lifecycle. |
| Eligible-set scheduling and continuation | `REUSE_AS_IS` | `scripts/multi-agent-operator/dag-eligible-resolver.mjs`; `scripts/multi-agent-operator/eligible-set-scheduler.mjs`; `scripts/hermes-bridge/execution-backend.mjs` | No Intelligence Fabric scheduler or continuation daemon. |
| Path/contract/environment reservations | `EXTEND_EXISTING` | `scripts/multi-agent-operator/reservation-ledger.mjs`; `scripts/multi-agent-operator/reservation-set.mjs`; `tests/multi-agent-reservation-ledger.test.ts` | Add accelerator/runtime/model/context resource kinds only through the existing fenced ledger contract. |
| Provider capability, dispatch, status, cancellation, artifacts, evidence | `EXTEND_EXISTING` | `scripts/multi-agent-operator/provider-contract.mjs`; `tests/multi-agent-provider-contract.test.ts`; provider conformance and health/reroute modules in the same directory | IF-01 must extend or compose this provider-neutral contract, not land a second provider abstraction. |
| Provider exhaustion/temporary availability | `ADAPT_AT_BOUNDARY` | `scripts/hermes-bridge/provider-status.mjs`; `scripts/runtime-operator/worker-lanes.mjs` | Normalize observations while preserving existing typed wait/reroute behavior. |
| Node identity, topology, command transport, and audit | `REUSE_AS_IS` | `config/execution-fabric/registry.schema.json`; `config/execution-fabric/registry.seed.json`; `lib/fabric/registry.mjs`; `lib/fabric/broker.mjs`; `lib/fabric/audit.mjs` | Extend schemas/projections where required; never add a parallel node registry or raw transport. |
| Whole-fabric live discovery | `EXTEND_EXISTING` | `scripts/execution-fabric/probe-windows.ps1`; `scripts/execution-fabric/probe-linux.sh`; `app/api/fabric/nodes/route.ts` | Add missing freshness/identity/headroom fields at these seams. |
| Resident HERMES runtime/configuration truth | `REUSE_AS_IS` | `C:\HermesLab\hermes\HERMES-COMMISSIONED.md` / `[[hermes-commissioned]]`; repository boundary `config/execution-fabric/hermes-free-dev-agent-v2.policy.json` | Reference the commissioned record. Do not restate or mutate the golden configuration. |
| Application inference compatibility | `ADAPT_AT_BOUNDARY` | `lib/ai/config.ts`; `lib/ai/provider.ts`; `lib/ai/runtime.ts`; `app/api/thread-chat/route.ts` | Keep application consumers provider-neutral; registry projection may feed this boundary later without routing activation in IF-01. |
| Model/runtime/provider/capability registry | `SUPERSEDE_COMPOSITION_ONLY` | Application inference config; resident policy; `scripts/hermes-bridge/resident-model-probe.mjs`; provider status; lane measurement; embedding manifests | Build a provenance-preserving normalized read model over source-specific truth, not a replacement authority. |
| Canonical Project/Thread/context continuity | `ADAPT_AT_BOUNDARY` | `lib/workbench/thread-registry.ts`; `lib/workbench/thread-projection.ts`; `lib/objective/thread.ts`; `lib/objective/thread-binding.ts` | Context Fabric compiles bounded packets from canonical identities. Provider session IDs remain non-authoritative. |
| Generic memory/context database | `REUSE_AS_IS` | `components/memory/memory-governance-registry.ts`; `app/actions/memory.ts`; canonical Thread/Project/evidence sources above | No second chat-history, vector, memory, or context database. New persistence requires proof that projection is insufficient. |
| Capability evaluation/admission | `EXTEND_EXISTING` | `scripts/runtime-operator/measure-lane-capability.mjs`; `scripts/runtime-operator/lane-measurement.mjs`; `scripts/embedding-bakeoff/**`; `tests/execution-fabric-hermes-embedding-bakeoff.test.ts` | Generalize exact-subject evidence and trust wrappers; do not stretch the embedding evaluator into every modality. |
| Evidence and execution receipts | `EXTEND_EXISTING` | `scripts/multi-agent-operator/evidence-ledger.mjs`; `lib/fabric/audit.mjs`; `components/evidence/**`; existing placement/dispatch receipts | Add provider-neutral inference fields to existing evidence chains; no parallel audit universe. |
| Provider-neutral IF domain schemas (capability, model artifact, runtime configuration, compute, request, inference receipt) | `GENUINELY_MISSING` | Contract proposal in `02-domain-contracts.md`; no single current-main schema covers the complete identity set | IF-01 may add schemas and deterministic tests only. It must reuse the provider/work/reservation/evidence primitives above. |
| Accelerator admission/residency and reservation-aware model lifecycle | `GENUINELY_MISSING` | Partial identity/observation in Execution Fabric; lease/fence precedent in `scripts/multi-agent-operator/reservation-ledger.mjs` and `lane-lease-checkpoint.mjs` | Remains later-WO scope. Re-prove absence at its fresh base; no implementation in this first slice. |
| Elastic inference worker adapter | `ADAPT_AT_BOUNDARY` | Existing lifecycle/security precedents under `scripts/execution-fabric/provision/**` and provider-neutral contract above | A later authorized adapter must compose existing authority, lease, evidence, and cleanup seams; current slice adds no provider call. |
| Multimodal context objects | `GENUINELY_MISSING` | No complete admitted image/audio/video Context Fabric contract located in the IF-00 repository sweep | Later schema-only work must bind existing device/auth, provenance, data-class, and retention controls before capture. |
| Hybrid placement and fallback | `ADAPT_AT_BOUNDARY` | `scripts/execution-fabric/recommend-placement.mjs`; shadow placement/evidence modules; provider health/reroute modules | Shadow/composition only until separately admitted. No automatic egress, spend, or routing activation. |
| Owner Environment / technical inspection | `REUSE_AS_IS` | Current Environment/Workbench lineage and `docs/governance/williamos-experience-v2-implementation-charter.md` | Optional technical evidence integrates into the existing experience; no Models/GPU/Cloud root application. |
| Chaos, recovery, and terminal acceptance | `EXTEND_EXISTING` | Existing execution-fabric, multi-agent-operator, runtime-operator, and fabric test suites | Add IF-specific cases to existing deterministic and sovereign-review gates; do not create a second certification framework. |

The map accounts for IF-00 through IF-13. A `GENUINELY_MISSING` result authorizes only the bounded
child named in the delivery plan; it does not authorize runtime, provider, credential, routing, UI,
or persistence work in IF-01.

## Existing seams to preserve

### 1. Worker-lane selection

Current owner: `scripts/runtime-operator/worker-lanes.mjs`

Preserve:

- assigned-lane preference;
- provider availability skipping;
- typed wait when all capable lanes are exhausted;
- evidence-backed capability admission;
- explicit `hermes-local` non-capability until measured.

Adaptation:

- lane selection may request/consume `InferenceRequirement` and placement evidence;
- worker identity remains separate from model/runtime/compute identity;
- existing provider-status behavior remains a source of availability evidence.

Forbidden:

- replacing lane selection with a new independent scheduler;
- allowing the Intelligence Fabric to self-authorize Work Order effects.

### 2. HERMES provider availability

Current owner: `scripts/hermes-bridge/provider-status.mjs` and runtime-operator state.

Preserve:

- persisted exhaustion windows;
- fail-soft optimization behavior;
- typed reasons;
- existing reroute semantics.

Adaptation:

- normalize provider/runtime/compute availability into Fabric observation records;
- do not make this file the universal registry.

### 3. Resident model kernel

Current owners:

- `scripts/hermes-bridge/hermes-kernel-client.mjs`
- `scripts/hermes-bridge/resident-model-probe.mjs`
- `config/execution-fabric/hermes-free-dev-agent-v2.policy.json`
- Hermes Agent deployment/invoker assets.

Preserve:

- owned-worktree confinement;
- packet/schema validation;
- per-thread kernel state;
- resumable Hermes session;
- evidence and quarantine gates;
- model tool-use containment;
- no cloud fallback in the existing promoted policy unless separately changed under authority.

Adaptation:

- current `policy.model.id` becomes a registry-backed exact model binding for this legacy/promoted path;
- packet should eventually include/derive a `contextPackageId`/digest and `placementDecisionId` without weakening existing fields;
- the resident coding kernel remains one safe worker execution backend, not the universal inference API.

Forbidden:

- stretching worktree-specific kernel mechanics into embeddings, speech, vision, or general model-serving just to reuse code;
- removing the policy evidence gate because a global registry exists.

### 4. Canonical fabric broker

Current owner: `lib/fabric/broker.mjs` plus canonical fabric registry/baseline machinery.

Preserve:

- one governed node resolution path;
- unknown-node denial;
- pinned transport behavior;
- unified audit ledger.

Adaptation:

- local compute discovery and node-level runtime probes must use canonical broker/registry seams;
- elastic remote providers are not silently added as ordinary nodes unless the canonical fabric model explicitly supports their ephemeral lifecycle.

Forbidden:

- raw new SSH clients in Intelligence Fabric;
- a parallel topology registry.

### 5. Work execution lifecycle

Current owner: #754 ExecutionBackend / HERMES→AEGIS lifecycle, operational kernel, repository lifecycle, validation/review/merge/cleanup.

Preserve unchanged unless a child proves a specific defect.

Intelligence Fabric chooses/provides intelligence used by work; it does not replace workspace ownership, Git lifecycle, validation, review, fencing, cleanup, or Work Order authority.

### 6. Project / Thread / Context sources

Current owners include Workbench Thread projection, Project model, operator state, evidence, authority, memory/context stores, and active Environment work.

Preserve canonical durable identities and explicit source bindings.

Adaptation:

- introduce Context Fabric as a compiler/projection over canonical sources;
- do not create a second conversation/task authority;
- existing Hermes kernel session is linked as execution/session state, never the sole canonical Thread state.

### 7. Environment / owner UX

Current control:

- #762 acceptance;
- active Workbench UX contract;
- #921 Environment architecture direction and subsequent takeover work.

Preserve:

- Conversation as operating language;
- owner intent first;
- no infrastructure/module vocabulary prerequisite;
- synthetic-owner/runtime acceptance before owner exploratory QA;
- progressively disclosed technical detail.

Adaptation:

- expose `PlacementDecision`, current intelligence state, fallback/recovery, and cost as optional Technical/Execution evidence;
- normal Thread copy remains human: Working / Waiting / Needs you / Degraded / etc.

Forbidden:

- a new top-level Models/GPU/Cloud dashboard as the operating model;
- forcing the owner to select a model before starting work.

## Migration strategy

### Stage A — observe, do not route

Create registries and adapters that truthfully represent the current promoted local model/runtime/compute path and frontier lanes. Existing behavior remains authoritative.

Acceptance: registry state can reconstruct current execution identity/provenance without changing dispatch.

### Stage B — shadow placement

For existing executions, generate `InferenceRequirement` and a shadow `PlacementDecision` but continue using existing lane/model selection. Compare shadow choice with actual choice and record disagreement.

Acceptance: zero production behavior change; placement hard gates match existing policy; no false eligibility.

### Stage C — local opt-in placement

Allow an exact bounded work class to use Fabric placement among already-approved local/provider candidates. Existing worker/execution lifecycle remains unchanged.

Acceptance: same authority and delivery evidence, plus Fabric placement evidence.

### Stage D — Context Fabric cutover

Make selected exact work classes consume digest-bound canonical context packages while preserving Hermes session continuity as an optimization.

Acceptance: kill the runtime session between turns, reconstruct from WilliamOS canonical context, and continue without owner context relay.

### Stage E — capacity/residency control

Introduce accelerator reservations and model lifecycle management around selected local paths.

Acceptance: concurrent jobs cannot over-admit the accelerator; preemption/eviction is deterministic and evidenced.

### Stage F — elastic compute default-off

Integrate one remote compute adapter behind explicit policy and spend authority. No automatic use until acceptance.

Acceptance: create/use/wipe/destroy one worker with zero orphaned resources and full cost/provenance evidence.

### Stage G — owner-transparent routing

Enable policy-driven reroute across approved local/frontier/elastic classes for selected production work.

Acceptance: terminal chaos test in `05-acceptance-and-evaluation.md`.

## Collision rules

Before each child mutation, search current `origin/main`, open PRs, active branches, and reservations for overlapping:

- provider/router work;
- Environment frontend work;
- HERMES supervisor/continuation work;
- Hermes Agent cutover/policy work;
- fabric registry/broker work;
- Workbench Thread/context work;
- model/embedding/vector/RAG work;
- GPU/compute provisioning work.

If overlap exists, the child either integrates into the active owner or fails `FAILED_SCOPE_COLLISION`. It may not silently start a parallel stack.

## Data migration rule

Do not introduce new persistence tables merely because the domain contract is convenient. IF-01 must inventory current schema/registers and prove which records can extend existing stores versus which genuinely require additive schema. Schema changes remain bounded and migration-tested.

## Compatibility rule

Old execution records without Fabric metadata remain valid historical evidence. Projection may show `placement: legacy/unavailable` rather than fabricate model/runtime/compute provenance.

## Rollback rule

At every migration stage before full cutover, disabling the new placement path must restore the prior supported execution behavior without deleting canonical evidence. Do not make migration rollback depend on removing old records or rewriting history.
