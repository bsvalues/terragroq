# WilliamOS Intelligence Fabric V1 — Development Package

**Parent issue:** #964 `WILLIAMOS_INTELLIGENCE_FABRIC_V1`

**Parent program:** #762

**Status:** DEVELOPMENT PACKAGE / ARCHITECTURE FREEZE INPUT

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

- `01-architecture-contract.md` — component ownership, boundaries, invariants, and non-goals.
- `02-domain-contracts.md` — normative versioned objects and state machines.
- `03-integration-and-migration-map.md` — exact existing WilliamOS/HERMES seams to preserve, adapt, or leave untouched.
- `04-delivery-plan.md` — bounded IF-00 through IF-13 implementation sequence and dependencies.
- `05-acceptance-and-evaluation.md` — capability evaluation, test matrix, chaos acceptance, and terminal V1 proof.
- `06-security-threat-model.md` — trust, privacy, cloud, model supply-chain, context, tool, and credential threats.
- `07-do-not-rebuild-register.md` — hard list of existing mechanisms that new work must integrate rather than duplicate.

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
