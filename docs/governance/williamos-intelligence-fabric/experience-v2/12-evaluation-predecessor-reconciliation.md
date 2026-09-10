# 12 — Evaluation Predecessor Reconciliation

## Purpose

Prevent IF-05 from creating a second evaluation/admission/trust framework when current main already contains a hardened resident HERMES embedding bake-off with reusable execution controls.

## Current-main evidence

Current `package.json` exposes `fabric:embedding-bakeoff` as an executable Fabric capability.

The resident embedding bake-off currently provides a strong governed envelope around a deliberately narrow evaluator:

- exact reviewed source closure bound by SHA-256;
- exact model/runtime/host manifests;
- model revision/weights/license/source identity;
- host machine identity and inventory snapshot binding;
- fixed loopback endpoint contract;
- secret/caller-controlled executable-field rejection;
- Forge permission scope that is explicitly non-authorizing;
- reviewed authority registry;
- single-use claims;
- exclusive leases with fencing tokens and stale-lease recovery;
- exact interpreter/executable attestation;
- resource ceilings and bounded result/input/scratch limits;
- no external provider, fallback, scheduler activation, model download, arbitrary endpoint, canonical vector write or database mutation.

The evaluator itself is intentionally embedding-specific. `fabric_measure.py` fixes the resident Ollama embedding route, model/host/runtime envelope, CPU-only execution, corpus, batching and output bounds. It should not be stretched into a universal LLM/vision/audio evaluator merely because its trust wrapper is strong.

## Controlling split

IF-05 must distinguish:

### Reusable evaluation execution envelope

Likely candidates for extraction/extension at an existing boundary:

- reviewed source closure;
- model/runtime/host manifest binding;
- admission registry and validity window;
- single-use claim;
- lease/fencing/recovery;
- host/runtime attestation;
- secret/executable-field rejection;
- resource ceilings;
- bounded outputs;
- immutable result/evidence binding;
- independent promotion/admission separation.

### Modality/task-specific evaluator

Remain specialist implementations:

- embedding retrieval/ranking metrics and frozen corpus;
- repository implementation evaluation;
- structured-output evaluation;
- long-context evaluation;
- tool-use/authority/scope evaluation;
- vision/document evaluation;
- speech evaluation;
- FreeToken/MoE performance evaluation;
- future specialist tasks.

The right architecture is not one universal evaluator process. It is a common governed evaluation admission/execution/evidence contract with specialist evaluator adapters.

## Do not assume third-party dependencies are the owner

`autoevals` and Braintrust exist in package dependencies, but code search during this review did not establish them as the canonical current evaluation path. IF-00/IF-05 must prove actual call paths before assigning ownership or depending on SaaS/network availability. Sovereign local evaluation remains required.

## Mapping to #964 CapabilityEvidence

The existing embedding path already demonstrates several fields #964 needs:

- exact model artifact identity;
- exact runtime identity/build artifacts;
- exact host/placement identity;
- frozen evaluation corpus identity;
- resource ceilings;
- result evidence;
- independently reviewed admission.

IF-05 should map these into `CapabilityEvidence` rather than discard them. A generalized evidence record may reference existing modality-specific result receipts without rewriting historical evidence.

## Efficiency opportunity

Generalize the **contract**, not the implementation internals.

A future evaluation request should conceptually bind:

```text
EvaluationAdmission
  subject: model × runtime × config × compute
  evaluator: reviewed specialist adapter + corpus/version
  authority/scope
  limits
  host/runtime attestation
  single-use/fence
        |
        v
specialist evaluator
        |
        v
bounded raw result
        |
        v
independent promotion decision -> CapabilityEvidence
```

This prevents every new modality from reimplementing leases, attestation, provenance and admission while preserving narrow attack surfaces.

## Required reconciliation before IF-05 mutation

Current-main inventory must classify:

- embedding authority/admission registry;
- runner/adaptor/launcher;
- lease/fencing ledger;
- host attestation collector;
- model/runtime/host manifests;
- corpus identity/provenance;
- metric/evaluator implementation;
- promotion/review path;
- any other current evaluation frameworks/callers.

For each, return `REUSE_AS_IS`, `EXTEND_EXISTING`, `ADAPT_AT_BOUNDARY`, `SPECIALIST_ONLY`, `SUPERSEDED_BY_CURRENT_MAIN`, or `GENUINELY_MISSING`.

## Acceptance

IF-05 may create new generic evaluation machinery only for a capability proven genuinely missing after this reconciliation. PASS requires:

- no second admission registry when current mechanism can be extended;
- no second lease/fencing implementation for evaluations without a proven need;
- no loss of reviewed-source/host/runtime attestation strength;
- specialist evaluators remain narrow and independently testable;
- capability promotion remains separate from the subject being evaluated;
- historical embedding evidence remains valid and referenceable;
- sovereign/local evaluation does not become dependent on Braintrust/SaaS merely because packages exist.

Failure to reconcile is `FAILED_EXISTING_EVALUATION_SUBSYSTEM_NOT_RECONCILED`.
