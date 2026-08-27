# 07 — DO-NOT-REBUILD Register

This register is a hard pre-execution guard for #964 children. A child may change one of these mechanisms only after current-main evidence proves a defect relevant to the exact Work Order. Convenience, unfamiliarity, or desire for a cleaner abstraction is not sufficient.

The authoritative classifications and exact current-main paths are in the
[IF-00 collision/component map](03-integration-and-migration-map.md#if-00-collision-and-component-classification-map).
Allowed classification vocabulary is limited to `REUSE_AS_IS`, `EXTEND_EXISTING`,
`SUPERSEDE_COMPOSITION_ONLY`, `ADAPT_AT_BOUNDARY`, and `GENUINELY_MISSING`. The last category is
not general build authority: it is valid only for the named bounded child and must be re-proven at
that child's fresh base.

| Existing capability | Current owner / precedent | Required treatment |
| --- | --- | --- |
| Work/authority lifecycle | Goal/Outcome/Work Order/Decision/Grant/queue machinery | Reuse. Intelligence placement never mints work authority. |
| HERMES continuation | resident supervisor/orchestrator and #870 direction | Reuse. No second continuation daemon/scheduler. |
| Worker lane selection | `scripts/runtime-operator/worker-lanes.mjs` | Extend/adapt only. Preserve assigned lane, measured capability, availability reroute. |
| Provider exhaustion state | `scripts/hermes-bridge/provider-status.mjs` + runtime operator state | Reuse as availability evidence. Do not create competing rate-limit state. |
| Resident local coding worker | Hermes Agent kernel/invoker/policy path | Preserve containment/evidence; treat as one worker/runtime path, not universal inference service. |
| Per-thread Hermes session continuity | `hermes-kernel-client.mjs` | Preserve as optimization; add canonical Context Fabric above it. |
| AEGIS execution backend | #754 and repository lifecycle | Reuse. No new repo execution engine. |
| Worktree ownership/confinement | existing repository lifecycle + Hermes owned-worktree controls | Reuse. Fabric does not invent another workspace mechanism. |
| Git/GitHub delivery | governed existing lifecycle and AEGIS brokered gh path | Reuse. No model/provider-specific Git automation. |
| Validation/review/remediation | existing operational kernel/review doctrine | Reuse. Capability evaluation is additional evidence, not replacement delivery review. |
| Node registry/topology | canonical fabric registry/baseline | Reuse. No second node inventory. |
| Node command transport/audit | `lib/fabric/broker.mjs` | Reuse for managed local fabric actions. No raw ad-hoc SSH client. |
| Project identity | durable WilliamOS Project/resource model | Reuse. Project != repository and must not be inferred from path/name. |
| Thread identity/projection | Workbench Thread durable projection | Reuse. No provider-owned Thread authority. |
| System truth semantics | live/persisted/inferred/unknown + freshness doctrine | Reuse for compute/runtime health. Do not render stale inventory as live. |
| Owner UX | #762, Workbench UX contract, current Environment architecture | Integrate progressively. No new infrastructure-first root app. |
| Device/auth boundary | existing device/passkey/session architecture | Reuse. Elastic worker identity is machine/work identity, not replacement owner auth. |
| Evidence/Trace/Audit | current evidence/governance/audit records | Integrate. Placement/measurement adds evidence but not a parallel audit universe. |
| Model local policy | `hermes-free-dev-agent-v2.policy.json` | Preserve exact proven controls until a separately reviewed migration supersedes them. |
| Commissioned HERMES appliance | `C:\HermesLab\hermes\HERMES-COMMISSIONED.md` / `[[hermes-commissioned]]` | `REUSE_AS_IS`. This canonical 2026-08-27 record supersedes experimental and pre-commissioning local-AI claims. Reference it; do not duplicate or mutate its golden configuration. |
| Provider-neutral provider contract | `scripts/multi-agent-operator/provider-contract.mjs` + `tests/multi-agent-provider-contract.test.ts` | `EXTEND_EXISTING`. IF-01 must not create a parallel dispatch/status/cancel/artifact/evidence contract. |
| Reservation ledger and fences | `scripts/multi-agent-operator/reservation-ledger.mjs`, `reservation-set.mjs`, `lane-lease-checkpoint.mjs` | `EXTEND_EXISTING`. Accelerator/model/context reservations must compose these mechanics. |
| Eligible-set scheduler/DAG | `scripts/multi-agent-operator/eligible-set-scheduler.mjs` + `dag-eligible-resolver.mjs` | `REUSE_AS_IS`. Placement is an input/projection; it is not another scheduler. |
| Evidence ledger | `scripts/multi-agent-operator/evidence-ledger.mjs` + `lib/fabric/audit.mjs` | `EXTEND_EXISTING`. Inference receipts join existing evidence; they do not create a separate audit universe. |
| Experience V2 implementation collision record | `docs/governance/williamos-experience-v2-phase0-collision-map.md` | `REUSE_AS_IS`. Cross-reference its current-main findings; do not fork or restate its implementation-lineage authority. |

## First-slice hard stop

The IF-00/IF-01 slice is documentation plus provider-neutral contracts and schema tests. It must not
change runtime behavior, credentials, provider SDKs/calls, routing, automatic fallback, spend,
provisioning, persistence, or UI. Discovery of a missing later-phase component records
`GENUINELY_MISSING`; it does not pull that component into the first slice.

## Mandatory pre-execution questions

Every #964 child must answer these in its `WORK_CONTEXT_RECEIPT` or attached planning evidence:

1. Which row(s) above does this work touch?
2. What current-main files/functions own that behavior today?
3. Why is integration insufficient if proposing new machinery?
4. What open PR/branch/reservation overlaps the seam?
5. Which existing tests prove the old invariant that must remain green?
6. What exact new invariant is missing?
7. How can the child be disabled/rolled back without deleting historical evidence?

If the agent cannot answer, mutation is blocked as `FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED`.

## Special prohibition: Models UI

A model/runtime/compute administration surface is permitted only as an engineering/technical management capability. It may not become:

- the landing page;
- a prerequisite to ordinary work;
- the owner-facing scheduler;
- the place the owner must visit after provider failure;
- a separate conversation product.

The Environment remains the operating surface.

## Special prohibition: cloud VRAM fiction

Do not create a `totalVram = local + cloud` value that implies one model process can address all memory. A logical capacity summary must label remote capacity as elastic/placement capacity. Physical distributed memory claims require explicit runtime/interconnect capability evidence.

## Special prohibition: context duplication

Do not create a new generic chat-history database if canonical Thread/Project/memory/evidence stores can provide the required ContextPackage projection. Context Fabric compiles/normalizes authoritative state; it does not casually duplicate it.

## Special prohibition: provider SDK sprawl

Before adding a direct provider SDK, inventory whether Hermes Agent, an OpenAI-compatible runtime adapter, or existing provider lane already supplies the required narrow interface. Direct SDK adoption requires a specific missing capability and a bounded adapter contract.

## Special prohibition: self-learning authority

Operational telemetry may improve ranking inputs, but no model/router may automatically change hard privacy, authority, egress, provider trust, or spend policy. Those remain governed reviewed policy.
