# 03 — Integration and Migration Map

This map exists to prevent agents from treating #964 as permission to create a fresh orchestration stack.

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
