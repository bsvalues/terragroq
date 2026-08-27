# WilliamOS Intelligence Fabric V1 — Development Package

**Repository:** `bsvalues/terragroq`

**Pull request:** `bsvalues/terragroq#965`

**Parent issue:** `bsvalues/terragroq#964` — `WILLIAMOS_INTELLIGENCE_FABRIC_V1`

**Parent program:** #762

**Status:** IF-00 BUILD RECONCILED / IF-01 CONTRACTS IMPLEMENTED — PUBLICATION PENDING

> Repository identity is part of the authority boundary. `bsvalues/terrafusion_os_1.0#965` is an
> unrelated pull request and must never be used as the source, target, evidence, or lifecycle record
> for this package.

## IF-00 assurance receipt — 2026-08-27

| Fact | Exact value |
| --- | --- |
| Repository | `bsvalues/terragroq` |
| PR / parent issue | `bsvalues/terragroq#965` / `bsvalues/terragroq#964` |
| Refresh base (`origin/main`) | `0e4536ea2ae84a39cc5ffb5c6f48aa4e72576152` |
| Pre-refresh PR head | `666a3d3c34e7ab107bac9728f9945606e120471b` |
| Pre-refresh merge base | `9dd61c67f325d4e6acdcd09d265400befc2ab0a8` |
| Pre-refresh divergence | 41 commits ahead / 25 commits behind `origin/main` |
| Local refresh merge | `e46875bc06e64d9a8fcbff5926a5677f3849b1db` |
| Post-refresh merge base | `0e4536ea2ae84a39cc5ffb5c6f48aa4e72576152` |
| Post-refresh divergence | 42 commits ahead / 0 commits behind `origin/main` before this reconciliation |
| Original package surface | 41 documentation files / 5,508 insertions, all under this directory |
| Runtime mutation in package | None; documentation only |
| Canonical HERMES evidence | `C:\HermesLab\hermes\HERMES-COMMISSIONED.md` / `[[hermes-commissioned]]` |

The refresh merge preserves all 41 package files. The remote PR head before publication was the
recorded pre-refresh head; the local merge SHA is the implementation-base receipt. The governed
GitHub lane verifies the separately published head rather than rewriting this historical receipt.

The commissioned HERMES record is authoritative for current production hardware, Ollama, model,
supervision, health, security-boundary, and recovery truth. It replaces the experimental log. Any
older `WOS-AI-013`, pre-commissioning local-AI consolidation note, or historical package statement
that says the P40/Ollama lane is merely proposed, absent, or awaiting commissioning is
**SUPERSEDED_BY_COMMISSIONED_EVIDENCE**. Reference `[[hermes-commissioned]]`; do not copy its mutable
configuration into this repository.

## Purpose

This package converts #964 from an architectural outcome into an implementation-ready program. It is intentionally designed to prevent another parallel subsystem, provider-specific implementation, or owner-facing infrastructure dashboard.

The product invariant is:

> William uses WilliamOS. WilliamOS owns continuity. HERMES owns resident orchestration. Intelligence providers, models, runtimes, nodes, accelerators, and ephemeral cloud resources are replaceable implementation details.

## Controlling architecture

```text
William
  |
  v
WilliamOS Environment
Conversation + working world
  |
  v
WilliamOS control plane
Project / Thread / Authority / Policy / Evidence
  |
  v
HERMES resident supervisor
Continuation / recovery / scheduling
  |
  +----------------------+----------------------+
  |                                             |
  v                                             v
Governed work execution                    Intelligence Fabric
Work Orders / worker lanes                 Context / model / runtime / compute
AEGIS / tools / review                     capability / placement / lifecycle
                                                |
                           +--------------------+---------------------+
                           |                    |                     |
                           v                    v                     v
                     Hermes Agent            Codex                Claude
                           |
                    Runtime adapters
                 Ollama / llama.cpp / vLLM
                           |
                      Compute fabric
            local GPU / CPU / accelerator / remote GPU
```

## Package contents

The package remains 41 files including this index. The two series are now path-disjoint, so their
intentional 11–21 numbering overlap cannot be mistaken for duplicate or replacement documents.

### Intelligence Fabric series

- [01 — Architecture contract](01-architecture-contract.md)
- [02 — Domain contracts](02-domain-contracts.md)
- [03 — Integration, migration, and IF-00 collision map](03-integration-and-migration-map.md)
- [04 — Delivery plan](04-delivery-plan.md)
- [05 — Acceptance and evaluation](05-acceptance-and-evaluation.md)
- [06 — Security threat model](06-security-threat-model.md)
- [07 — DO-NOT-REBUILD register](07-do-not-rebuild-register.md)
- [08 — FreeToken runtime review](08-freetoken-runtime-review.md)
- [09 — Whole-fabric topology and placement](09-whole-fabric-topology-and-placement.md)
- [10 — Efficiency review](10-efficiency-review-2026-08-23.md)
- [11 — IF-02 whole-fabric discovery acceptance](11-if-02-whole-fabric-discovery-acceptance.md)
- [12 — Hardware ROI contract](12-hardware-roi-contract.md)
- [13 — Stage placement acceptance](13-stage-placement-acceptance.md)
- [14 — Distributed inference maturity ladder](14-distributed-inference-maturity-ladder.md)
- [15 — Package delta: whole-fabric](15-package-delta-whole-fabric.md)
- [16 — Whole-fabric review checklist](16-whole-fabric-review-checklist.md)
- [17 — Whole-fabric chaos cases](17-whole-fabric-chaos-cases.md)
- [18 — IF-05 fabric benchmark matrix](18-if-05-fabric-benchmark-matrix.md)
- [19 — Placement efficiency score](19-placement-efficiency-score.md)
- [20 — Current next actions](20-current-next-actions.md)
- [21 — Topology truth vs role intent](21-topology-truth-vs-role-intent.md)

### Experience V2 reconciliation series

- [11 — Execution Fabric predecessor reconciliation](experience-v2/11-execution-fabric-predecessor-reconciliation.md)
- [12 — Evaluation predecessor reconciliation](experience-v2/12-evaluation-predecessor-reconciliation.md)
- [13 — Context and inference seam reconciliation](experience-v2/13-context-and-inference-seam-reconciliation.md)
- [14 — Model/runtime registry reconciliation](experience-v2/14-model-runtime-registry-reconciliation.md)
- [15 — Accelerator residency reconciliation](experience-v2/15-accelerator-residency-reconciliation.md)
- [16 — Observability/headroom reconciliation](experience-v2/16-observability-headroom-reconciliation.md)
- [17 — Elastic compute security reconciliation](experience-v2/17-elastic-compute-security-reconciliation.md)
- [18 — Model supply-chain reconciliation](experience-v2/18-model-supply-chain-reconciliation.md)
- [19 — Owner-experience invisibility contract](experience-v2/19-owner-experience-invisibility-contract.md)
- [20 — Personal operating environment](experience-v2/20-williamos-experience-v2-personal-operating-environment.md)
- [21 — Context compartment and settled-truth reconciliation](experience-v2/21-context-compartment-and-settled-truth-reconciliation.md)
- [22 — Cache, data gravity, and derived state](experience-v2/22-cache-data-gravity-and-derived-state-reconciliation.md)
- [23 — Attention, re-entry, and semantic thread](experience-v2/23-attention-reentry-semantic-thread-reconciliation.md)
- [24 — Current frontend cutover map](experience-v2/24-experience-v2-current-frontend-cutover-map.md)
- [25 — Native overlay and shell boundary](experience-v2/25-native-overlay-and-shell-boundary.md)
- [26 — Visual, material, and cross-device contract](experience-v2/26-experience-v2-visual-material-cross-device-contract.md)
- [27 — System object graph and direct operation](experience-v2/27-system-object-graph-and-direct-operation.md)
- [28 — Operating modes and policy bundles](experience-v2/28-operating-modes-and-policy-bundles.md)
- [29 — Command, causality, personalization, and build sequence](experience-v2/29-command-causality-personalization-and-build-sequence.md)

The on-main [Experience V2 Phase 0 collision map](../williamos-experience-v2-phase0-collision-map.md)
remains the implementation-lineage record for the spec/implementation relationship and prior
collision research. This package map narrows only the Intelligence Fabric/Experience V2 document
collision; it does not replace that evidence.

## Required execution discipline

Every implementation child MUST satisfy #831 `WORK_CONTEXT_RECEIPT` against current `origin/main` before mutation. Current repository/runtime/topology truth outranks this package if later evidence shows drift. Drift requires updating the package or child contract; it does not authorize silently inventing a parallel mechanism.

Every child must:

1. identify the existing subsystem it integrates;
2. state exact reserved paths and authority;
3. preserve parent #964 acceptance;
4. prove no equivalent current-main mechanism already solves the seam;
5. deliver tests/evidence before capability promotion;
6. recompute #964 after settlement;
7. continue automatically to the next eligible child unless a genuine owner boundary exists.

## Product anti-patterns

The following are disqualifying architecture outcomes:

- a second scheduler or continuation loop;
- a second authority or decision model;
- a second node registry/broker;
- a second agent framework beside the governed Hermes Agent integration;
- a model/provider-specific conversation authority;
- a user workflow requiring a Models, GPU, Runtime, or Cloud page before ordinary work can proceed;
- treating WAN cloud GPU memory as physically contiguous local VRAM;
- capability claims without measured evidence;
- automatic remote data egress because a worker is reachable;
- automatic paid-resource provisioning without separate active policy/spend authority;
- infrastructure failures becoming owner command/log courier tasks.

## Terminal product test

A meaningful development outcome begins through the normal WilliamOS Environment, starts on one approved intelligence path, loses that path during active work, automatically continues through another allowed path with the same canonical Thread/context, and completes through the existing governed execution/review/delivery lifecycle. If separate cloud/spend authority is active, a deliberately insufficient local condition may trigger an ephemeral remote GPU burst that is created, bounded, used, wiped, destroyed, and evidenced without owner infrastructure operation.

Normal use must not require the owner to know which model, runtime, accelerator, node, or provider performed any step. Inspect/Technical must reveal the complete truthful chain afterward.
