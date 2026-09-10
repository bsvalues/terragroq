# 04 — Bounded Delivery Plan

Each increment below is a child of #964 and must satisfy #831 before mutation. No child is terminal unless #964 acceptance is recomputed and passes.

## IF-00 — Current-truth architecture freeze

**Goal:** prove the current seams before implementation.

Deliver:

- exact current-main inventory of model/provider/runtime/context/compute/fabric/frontend owners;
- open-PR/branch collision map;
- current live HERMES model/runtime/compute observation;
- exact existing persistence/register inventory;
- DO-NOT-REBUILD confirmation;
- proposed reserved paths for IF-01–IF-04.

No production behavior change.

Acceptance:

- valid `WORK_CONTEXT_RECEIPT`;
- no architecture claim based solely on historical docs/conversation;
- current promoted Hermes local policy and actual runtime identity reconciled;
- current Environment/frontend owner reconciled;
- current provider lane/status owner reconciled.

## IF-01 — Domain contracts and persistence seam

**Goal:** land versioned Fabric domain objects without changing routing.

Deliver:

- pure types/schemas/validators;
- persistence/read-model decision based on existing schema inventory;
- deterministic IDs/digests;
- failure vocabulary;
- unit tests for invalid/ambiguous/extra-field/future-version cases.

Acceptance:

- no automatic placement;
- no provider call;
- no node mutation;
- no second authority/queue;
- schema migration, if any, has fresh + additive replay + rollback/fail-closed proof.

## IF-02 — Local compute discovery

**Goal:** make local capacity truthful and freshness-aware.

Deliver:

- compute discovery through canonical broker/registry paths;
- accelerator/CPU/RAM/runtime observations;
- freshness/degraded/unknown semantics;
- capacity projection that distinguishes inventory from currently reservable capacity.

Acceptance:

- unknown nodes denied;
- stale observation never renders AVAILABLE capacity;
- no raw parallel SSH path;
- negative proof for unavailable/partial telemetry.

## IF-03 — Current model/runtime adoption

**Goal:** represent the existing local Qwen/Ollama/Hermes-Agent path exactly.

Deliver:

- ModelArtifact for current model identity;
- Runtime records for current serving/agent path;
- runtime capability evidence scoped to actual versions/hardware;
- mapping from promoted resident-model policy into registry provenance.

Acceptance:

- existing resident execution behaves unchanged;
- registry can reconstruct model/runtime/image/policy identity;
- no automatic new model download;
- legacy policy remains authoritative for its contained worker path.

## IF-04 — Context Fabric

**Goal:** make canonical context independent of one model session.

Deliver:

- ContextPackage compiler;
- source selection and explicit exclusion rules;
- deterministic digest/provenance;
- model-specific formatter stage;
- adapter from resident-model execution to context package;
- reconstruction path when Hermes session state is absent.

Acceptance:

- identical canonical source set produces stable semantic/digest behavior according to versioned contract;
- credentials excluded;
- authority metadata cannot be overridden by untrusted context text;
- kill resident session state and continue a bounded Thread using reconstructed canonical context;
- existing per-thread Hermes resume still works when present.

## IF-05 — Evaluation Lab / capability evidence

**Goal:** generalize evidence-backed capability promotion.

Deliver:

- evaluation task schema/runner;
- initial representative corpus;
- metric capture;
- independent promotion path;
- measured-capability read model.

Minimum initial tests:

- structured output;
- context continuity;
- bounded repository task;
- authority/path compliance;
- semantic-scope compliance;
- tool use;
- latency/memory.

Acceptance:

- subject model/lane cannot mark itself PROVEN;
- evidence binds exact model × runtime × config × compute class;
- changed model/runtime revision invalidates or scopes prior evidence correctly.

## IF-06 — Local placement V1

**Goal:** turn `InferenceRequirement` into a durable local placement decision.

Deliver:

- hard-gate evaluator;
- candidate enumeration;
- deterministic scoring/rationale;
- fallback chain;
- shadow-mode comparison before activation;
- exact bounded opt-in production class.

Acceptance:

- hard gate always beats score;
- unproven capability refused;
- stale capacity refused;
- context too large refused/rerouted;
- placement evidence explains every considered candidate;
- seamless fallback between two approved candidates without owner context transfer.

## IF-07 — Worker/provider integration

**Goal:** connect Fabric placement to existing governed worker lanes.

Deliver:

- lane capability request adapter;
- mapping for Codex, Claude, and Hermes local paths;
- provider availability/failure feedback into re-placement;
- no change to Work Order/AEGIS/Git lifecycle authority.

Acceptance:

- assigned lane semantics preserved where required;
- provider rate limit triggers typed re-placement/wait;
- no worker chooses its own next parent outcome;
- no Fabric action creates unauthorized repository effects.

## IF-08 — Accelerator reservations and model residency

**Goal:** prevent over-admission and manage warm models intentionally.

Deliver:

- AcceleratorReservation with lease/fence semantics;
- capacity accounting for weights/KV/runtime overhead;
- model residency state machine;
- warm/idle/evict policy;
- priority/preemption.

Acceptance:

- concurrent reservations cannot exceed governed capacity;
- expired lease releases capacity deterministically;
- background job can be preempted by interactive work;
- non-preemptible active work is not evicted silently;
- crash/restart reconstructs safe reservation truth.

## IF-09 — Multimodal foundation

**Goal:** prove the Fabric is intelligence-modal, not LLM-only.

Deliver at least two specialist classes among:

- embeddings;
- reranking;
- vision/document;
- speech-to-text;
- text-to-speech.

Acceptance:

- specialist services use common model/runtime/compute/capability contracts;
- they do not require repository worker-lane semantics;
- modality-specific privacy/egress remains enforceable.

## IF-10 — Elastic compute adapter

**Goal:** prove one work-owned ephemeral remote GPU resource end to end.

Prerequisites:

- separate approved provider choice;
- separate provider credential setup;
- explicit spend policy;
- explicit data/egress policy;
- no protected-data test unless separately authorized.

Deliver:

- provider adapter;
- provision/attest/identity/network/runtime/load/execute/wipe/destroy lifecycle;
- bounded TTL/spend;
- orphan sweeper/recovery;
- evidence/cost accounting.

Acceptance:

- worker has short-lived scoped identity only;
- no public inbound dependency;
- no master credential on worker;
- egress policy negative tests pass;
- worker destroyed after success and after induced execution failure;
- orphaned paid worker detected and recovered;
- exact cost/TTL evidence recorded.

## IF-11 — Cost/quality optimization

**Goal:** use measurements to choose among eligible local/private-remote/API options.

Deliver:

- policy weights/defaults;
- cost estimate normalization;
- queue-delay/locality consideration;
- explainable choice output.

Acceptance:

- optimizer cannot override privacy/authority/spend hard gates;
- measured data freshness/scoping enforced;
- local preferred when equivalent unless policy says otherwise;
- remote burst selected when measured value clears policy threshold.

## IF-12 — Environment integration

**Goal:** make the Fabric disappear in normal use.

Deliver:

- Thread-level human state for automatic placement/recovery;
- optional Technical/Execution projection of placement chain;
- no model picker in required path;
- no provider-specific conversations;
- no focus theft on reroute.

Acceptance:

- synthetic-owner job succeeds without infrastructure vocabulary;
- provider/model switch does not open panes or navigate;
- owner can inspect provenance after completion;
- mobile/desktop behavior follows controlling Environment acceptance.

## IF-13 — Chaos / terminal V1 proof

Run the terminal matrix in `05-acceptance-and-evaluation.md` against installed authenticated WilliamOS/HERMES and real durable state.

Terminal result only after independent review:

`WILLIAMOS_INTELLIGENCE_FABRIC_V1: PASS`
