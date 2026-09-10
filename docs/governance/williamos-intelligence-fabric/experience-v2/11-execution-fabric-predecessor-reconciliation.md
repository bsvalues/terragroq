# 11 — Execution Fabric Predecessor Reconciliation

## Purpose

Prevent #964 from rebuilding placement, evidence freshness, workload classification, shadow placement, bounded dispatch, or recovery machinery that already exists from #538 and its merged successors.

## Current-main evidence found during review

Issue #538 (`WO-EF-PLACEMENT-001`) already defined the multi-node placement substrate beneath Hermes, including:

- authority/evidence/capability/headroom filters;
- deterministic placement and tie-break receipts;
- workload classes for local LLM inference, CPU/GPU work, state, retrieval, backup/archive, and interactive burst;
- explicit HERMES/AEGIS/ATLAS/OMEN role intent;
- shadow placement before dispatch;
- bounded dispatch contracts;
- re-placement/recovery with new receipts;
- a later model/intelligence routing phase;
- owner-facing invisibility of cluster mechanics.

Current `main` still exposes this substrate through package scripts including:

- `fabric:recommend`;
- `fabric:recommend:pinned`;
- `fabric:shadow`;
- `fabric:shadow-admit`;
- `fabric:dispatch-contract`;
- `fabric:bounded-dispatch`;
- `fabric:embedding-bakeoff`.

The current placement implementation validates workload requirements, authority, fresh observed/proven evidence, runtime health, resource headroom and deterministic ranking. `config/execution-fabric/registry.seed.json` already models OMEN, HERMES, ATLAS and AEGIS with distinct roles, authority, capabilities, constraints and freshness-gated evidence. `placement-workloads.json` already contains representative workload contracts. The bounded-dispatch implementation binds trusted placement and authority proof, single-use claims and runtime leases before local inference.

Historical #538 evidence also shows why this substrate must be reused rather than simplified: Phase 2 shadow-placement assurance found and repaired provenance/chronology weaknesses before genuine observations were admitted. Those hardened trust properties are part of the value of the predecessor implementation.

## Controlling reconciliation rule

#964 does **not** get a fresh placement engine.

IF-00 must identify the exact current owners and state of the #538 Execution Fabric on current `origin/main`, including all successor PRs and later supersessions, then classify every #964 contract as one of:

- `REUSE_AS_IS` — current mechanism already satisfies the requirement;
- `EXTEND_EXISTING` — add dimensions/fields/inputs to the existing mechanism;
- `ADAPT_AT_BOUNDARY` — preserve current engine and translate the new Intelligence Fabric contract at an adapter seam;
- `SUPERSEDED_BY_CURRENT_MAIN` — a newer existing owner has replaced the #538 implementation;
- `GENUINELY_MISSING` — only this class may justify new machinery.

No #964 child may implement a new placement/scoring/shadow/dispatch/recovery path before this classification exists.

## Expected reuse

Unless current-main evidence disproves it, preserve these concepts from the existing Execution Fabric:

1. Fresh evidence snapshots and immutable hashes.
2. Separate node health and capability health.
3. Workload-class requirements/preferences.
4. Authority hard-gate before placement.
5. Resource/headroom hard gates.
6. Data-locality/disruption constraints.
7. Deterministic ranking/tie-breaks.
8. Recommendation-only/shadow mode before consequential routing.
9. Placement receipts that cannot mint authority.
10. New receipts for re-placement after failure.
11. Bounded task adapters rather than arbitrary model-generated shell.
12. Scheduler/dispatch authority remaining distinct from recommendation capability.

## #964 should extend, not duplicate

The likely new dimensions #964 contributes are:

- exact `ModelArtifact` provenance rather than coarse local-LLM capability;
- `Runtime` and `RuntimeConfiguration` identities;
- model × runtime × configuration × compute `CapabilityEvidence`;
- model-independent `ContextPackage` continuity;
- accelerator/KV/model-residency reservations;
- intra-node memory/PCIe topology and measured transfer cost;
- `FabricLink` observations and inter-node transfer cost;
- stage-level `PipelinePlan` placement;
- private ephemeral remote compute lifecycle;
- model/runtime maturity and supply-chain admission;
- multimodal intelligence classes;
- explicit API-vs-private-remote trust classes;
- runtime/model cost and measured quality inputs.

These should enter the existing placement/evidence pipeline as new governed inputs, contracts or adapters whenever possible.

## Optimization consequence

The placement architecture should become hierarchical rather than parallel:

```text
existing Execution Fabric
  authority + fresh evidence + capability + headroom + locality
        |
        +-- whole-work / stage execution placement
        |
        v
Intelligence extension
  context + model + runtime + config + accelerator reservation + cost/quality
        |
        v
existing bounded dispatch / worker execution lifecycle
```

HERMES remains the resident supervisor above both.

## Acceptance for predecessor reconciliation

Before IF-01 or IF-06 may create placement-related production code, current-main evidence must prove:

- exact files/functions that implement #538 placement today;
- exact state of Phase 1/2/3+ and any later supersession;
- whether the hardened shadow-placement evidence path remains active/current;
- which current workload/registry contracts can be extended safely;
- which #964 domain objects map onto existing contracts;
- no duplicate scheduler, ranker, evidence registry, dispatch contract or recovery loop is proposed;
- rollback preserves the pre-#964 Execution Fabric behavior and evidence.

If this reconciliation cannot be completed, the correct state is `FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED`, not permission to build a clean replacement.
