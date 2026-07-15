# WilliamOS Executable Capability Inventory

Work Order: `WO-MAO-004`

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Machine source: `components/operator/multi-agent-capability-registry.ts`

## Purpose

This inventory separates a surface that exists from a worker that may execute. A governance page,
decision model, tested kernel, model runtime, provider product, or named agent is not an executable
WilliamOS worker merely because it is present or useful.

The inventory is fail-closed. A capability may dispatch only when its machine record is an
`EXECUTABLE_WORKER`, its status is `PROVEN` or narrowly `PILOT_AUTHORIZED`, and it contains a conformant
adapter reference, exact active authority evidence, and the implemented preventive trust-gate reference.
No current provider record meets that complete adapter contract. The hosted Codex session and native
subagent team proved bounded R1 coordination through independent post-merge remediation re-review; that
bounded status remains separate from WilliamOS dispatch eligibility.
Phase 2 additionally proves the local provider-neutral control contracts; those contracts do not turn
any provider candidate into an executable worker.
WO-MAO-024 adds a Phase 3 team-topology and declared-dependency fan-in planning model. That bounded
planning claim remains non-executable and adds no dispatch, authority, provider, runtime, or owner-operation
capability.
WO-MAO-025 adds a fail-closed isolated-workspace lifecycle manager. An authorized coordinator may use it
to create, validate, reattach, and safely clean exact lease/evidence-bound local branches and worktrees.
It never absorbs dirty/foreign changes, uses force, cleans unmerged/shared state, or grants authority.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `PROVEN` | The bounded claim named by the record has repository evidence. It does not imply worker execution. |
| `PILOT_AUTHORIZED` | A bounded provider pilot has an exact active grant and preventive trust proof. It is not durable-runtime certification. |
| `AVAILABLE_UNPROVEN` | The surface is available or reasonably callable, but the program has not proven useful governed delivery. |
| `UNAVAILABLE` | No currently usable, authenticated, conformant execution surface is evidenced. |
| `REJECTED` | The specific adapter or architecture is terminally prohibited and cannot be retried or silently reused. |

Execution class is independent of status:

- `NON_EXECUTABLE` describes control-plane, governance, model-capacity, or kernel claims that are not workers.
- `WORKER_CANDIDATE` describes a provider or adapter that cannot currently dispatch.
- `EXECUTABLE_WORKER` is reserved for an entry that passes every machine gate.

## Current inventory

| Capability | Status | Execution class | Truthful claim |
| --- | --- | --- | --- |
| WilliamOS governance control plane | `PROVEN` | `NON_EXECUTABLE` | Goals, loops, Work Orders, authority boundaries, evidence, and portfolio records exist. |
| Codex operator decision model | `PROVEN` | `NON_EXECUTABLE` | The completed predecessor models continuation and delivery gates; it is not a transport. |
| Serial operational kernel | `PROVEN` | `NON_EXECUTABLE` | The implementation and bounded lifecycle are tested, but its provider path is rejected and it is not multi-agent. |
| Local nested Codex adapter | `REJECTED` | `WORKER_CANDIDATE` | `CODEX_NETWORK_WALL`; terminal quarantine, no dispatch, retry, reactivation, wrapping, or silent reuse. |
| Multi-agent Phase 2 local contracts | `PROVEN` | `NON_EXECUTABLE` | Envelope, DAG, atomic reservation ledger, provider eligibility, lifecycle, leases/checkpoints, evidence ledger, and owner meter are proven locally; no durable dispatch or unattended scheduler. |
| Multi-agent Phase 3 team topology and fan-in plan | `PROVEN` | `NON_EXECUTABLE` | WO-MAO-024 deterministically plans team-role assignments and waits only on declared fan-in dependencies; it executes nothing and grants no authority. |
| Multi-agent Phase 3 isolated workspace manager | `PROVEN` | `NON_EXECUTABLE` | WO-MAO-025 plans and executes bounded owned branch/worktree create, validate, reattach, and safe merged cleanup; it is a coordinator utility, not a dispatchable worker. |
| Supported hosted Codex session | `PROVEN` | `WORKER_CANDIDATE` | Bounded coordination and remediation re-review passed; durable WilliamOS dispatch remains denied. |
| Codex native coordinator and subagents | `PROVEN` | `WORKER_CANDIDATE` | Native fan-out, remediation, and fan-in are proven; no durable adapter or atomic reservation claim is made. |
| Claude Code provider lane | `UNAVAILABLE` | `WORKER_CANDIDATE` | No authenticated supported surface or conformant adapter is evidenced. |
| Brain Council advisory surface | `PROVEN` | `NON_EXECUTABLE` | Static advisory and decision-packet read model only. |
| Agent Forge governance surface | `PROVEN` | `NON_EXECUTABLE` | Skill governance, review, and quarantine read models only. |
| Hermes worker sidecar | `UNAVAILABLE` | `WORKER_CANDIDATE` | Governed boundary concept only; no worker, scheduler, queue, MCP activation, or adapter. |
| Ollama local model capacity | `PROVEN` | `NON_EXECUTABLE` | Local model capacity is recorded; it is not a repository-delivery agent. |

## Non-inference rules

- `PROVEN` modifies only the claim in that record. It never promotes a neighboring worker claim.
- A tested kernel with a rejected adapter is not an active worker.
- Proven local contracts are not a provider adapter, unattended scheduler, or GitHub delivery worker.
- A proven Phase 3 topology plan does not dispatch roles, activate a runtime, grant authority, or perform
  provider, GitHub, production, or owner operations.
- Provider availability, authentication, adapter conformance, authority, and trust controls are separate gates.
- `coordinationEligible` records bounded supported-session team coordination; it never implies
  WilliamOS registry dispatch, a durable adapter, or atomic reservation acquisition.
- Brain Council, Agent Forge, Hermes, and named agent roles cannot be shown as active workers without an
  `EXECUTABLE_WORKER` record.
- Claude unavailability becomes `PROVIDER_UNAVAILABLE`; William is not asked to launch, authenticate, or
  diagnose it, and unrelated Codex work remains eligible.
- The rejected local adapter cannot become available through a registry edit. Its terminal quarantine is
  governed separately and remains in force.

## Promotion rule

Promotion is a reviewed state transition, not a label change. A candidate needs provider identity,
adapter conformance, exact Work Order and action scope, current unrevoked authority evidence, path confinement,
an enforced recognized prompt boundary, provider-output redaction, cancellation, and independent control
evidence capture. `validate_preventive_trust_gate_v2` implements those pre-dispatch checks for registered
workers, and `workers.py` redacts captured provider output before persistence. A provider remains a candidate
until its actual adapter invokes that path; a reference to the gate alone is not conformance.

## Preventive trust gate v2

The machine schema lives under `preventive_trust_gate_v2` on registered external workers in
`control-center/backend/worker_registry.json`. The enforcement anchor is
`control-center/backend/workers.py#validate_preventive_trust_gate_v2`.

The gate rejects missing, false, unrecognized, or mismatched controls. It requires attributable worker,
provider, and surface identity; `rawCredentialInspection=false`; the recognized
`trusted-work-order-envelope-v1` prompt boundary; unique relative wildcard-free paths that exactly match
between dispatch scope and grant; output redaction; pre-dispatch cancellation; and a separate sanitized
trust-evidence record that contains no prompt or provider output.

## Safety

This inventory adds no provider call, worker process, queue, scheduler, command runner, runtime
activation, credential handling, GitHub write, production mutation, database/schema change, package
change, dynamic ingestion, or owner operation. Runtime activation remains disabled, all owner-touch
counters remain zero, and the rejected nested local Codex adapter remains terminally quarantined.
