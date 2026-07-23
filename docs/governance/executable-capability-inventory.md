# WilliamOS Executable Capability Inventory

Work Order: `WO-MAO-004`

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Machine source: `components/operator/multi-agent-capability-registry.ts`

## Purpose

This inventory is the human-readable AC-12 projection of the machine registry. Every current
registry capability appears exactly once below with its exact status, execution class,
`runtimeReality`, proof classification, and bounded claim. The machine registry remains authoritative;
the parity test fails when this document is missing a record or preserves stale truth.

Only the Hermes resident Codex worker currently passes the complete `EXECUTABLE_WORKER` dispatch
contract. It is a native non-elevated Windows supervisor using Codex App Server transport for one
fenced WilliamOS-native R0/R1 outcome at a time. The production web app does not host the worker,
and current host liveness is verified separately from retained runtime proof. The nested local Codex
adapter from issue #357 remains terminal and excluded.

## Taxonomy

Status and execution class retain their machine meanings:

- `PROVEN` means the bounded claim has repository evidence; it does not by itself imply runtime execution.
- `PILOT_AUTHORIZED` means a bounded worker has exact authority and preventive trust proof.
- `AVAILABLE_UNPROVEN` means a surface may be callable but has no governed-delivery proof.
- `UNAVAILABLE` means no usable, authenticated, conformant surface is evidenced.
- `REJECTED` means the specific adapter or architecture is terminally prohibited.
- `NON_EXECUTABLE` is a control-plane, governance, model, drill, or read-model capability.
- `WORKER_CANDIDATE` cannot dispatch through the durable WilliamOS registry.
- `EXECUTABLE_WORKER` passes the machine dispatch gates.

`runtimeReality` provides the finer runtime taxonomy:

| Runtime reality | Required combination | AC-12 proof classification |
| --- | --- | --- |
| `NON_RUNTIME` | `PROVEN` plus `NON_EXECUTABLE`; no coordination eligibility | `STATIC_READ_ONLY` |
| `HOSTED_SESSION_ONLY` | `PROVEN` plus `WORKER_CANDIDATE`; bounded hosted-session coordination only | `RUNTIME_PROVEN` |
| `LIVE_BOUNDED_RESIDENT` | `PROVEN` or `PILOT_AUTHORIZED` plus `EXECUTABLE_WORKER`; coordination eligible | `RUNTIME_PROVEN` |
| `EXCLUDED` | `UNAVAILABLE` or `REJECTED` plus `WORKER_CANDIDATE`; no coordination eligibility | `EXCLUDED` |

The AC-12 proof classifications are exhaustive:

- `RUNTIME_PROVEN` records bounded execution proof. `HOSTED_SESSION_ONLY` does not imply a resident
  worker, and `LIVE_BOUNDED_RESIDENT` does not imply that the production web app hosts the worker or
  that retained proof establishes current host liveness.
- `STATIC_READ_ONLY` records repository-proven control contracts, models, drills, and surfaces that
  are intentionally not runtime workers.
- `EXCLUDED` records unavailable or terminally rejected capabilities outside the V1 completion claim.

## Current Inventory

| Capability ID | Capability | Status | Execution class | Runtime reality | Proof classification | Truthful claim |
| --- | --- | --- | --- | --- | --- | --- |
| `williamos-governance-control-plane` | WilliamOS governance control plane | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | Goals, loops, Work Orders, authority boundaries, evidence, and portfolio decisions exist as governed control-plane records. |
| `codex-operator-decision-model` | Codex operator decision model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | The completed Codex Operator program models continuation, authority walls, review, merge eligibility, and evidence. |
| `serial-operational-kernel` | Serial operational kernel | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | The serial kernel implementation and its bounded lifecycle behavior are covered by repository tests. |
| `local-nested-codex-adapter` | Local nested Codex adapter | `REJECTED` | `WORKER_CANDIDATE` | `EXCLUDED` | `EXCLUDED` | The local nested codex exec path is terminally quarantined after the authenticated transport wall. |
| `multi-agent-phase-two-local-contracts` | Multi-agent Phase 2 local contracts | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | Provider-neutral envelope, DAG, reservation and atomic-ledger, provider-eligibility, lifecycle, per-lane lease, checkpoint, evidence-ledger, and owner-meter contracts are proven locally. |
| `multi-agent-phase-three-team-topology-plan` | Multi-agent Phase 3 team topology and fan-in plan | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-024 provides a deterministic planning model for assigning team roles and waiting only on declared fan-in dependencies; it does not execute the plan. |
| `multi-agent-phase-three-isolated-workspace-manager` | Multi-agent Phase 3 isolated workspace manager | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-025 provides deterministic planning plus bounded create, validate, reconcile, and clean operations for lease- and evidence-bound per-lane branches and worktrees. |
| `multi-agent-phase-three-reservation-aware-handoff` | Multi-agent Phase 3 reservation-aware handoff | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-026 provides a durable, fail-closed handoff contract that transfers role custody without releasing the builder reservation, lease, or one-writer fence. |
| `multi-agent-phase-three-concurrency-fairness` | Multi-agent Phase 3 concurrency, priority, and fairness | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-027 extends the durable eligible-set scheduler with trust-signed priority claims, scheduler-derived aging, starvation protection, bounded security drain requests, and exact-dispatch backpressure from pinned-signed provider 429 observations. |
| `multi-agent-phase-three-scheduler-model-check` | Multi-agent Phase 3 scheduler simulation and model checking | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-028 performs bounded canonical-state exploration for scheduler DAG, cycle, collision, fan-in, duplicate-delivery, expiry, starvation, deadlock, cancellation, and replay behavior without external effects; incomplete searches are explicitly inconclusive. |
| `hosted-codex-session` | Supported hosted Codex session | `PROVEN` | `WORKER_CANDIDATE` | `HOSTED_SESSION_ONLY` | `RUNTIME_PROVEN` | A hosted Codex session completed the bounded Phase 1 R1 coordination proof through independent remediation re-review and zero unresolved substantive threads. |
| `codex-native-subagent-team` | Codex native coordinator and subagents | `PROVEN` | `WORKER_CANDIDATE` | `HOSTED_SESSION_ONLY` | `RUNTIME_PROVEN` | Native coordinator, independent builders, assurance, original-builder remediation, and fan-in roles completed the bounded Phase 1 proof. |
| `hosted-codex-coordinator-adapter` | Hosted Codex coordinator adapter | `PROVEN` | `WORKER_CANDIDATE` | `HOSTED_SESSION_ONLY` | `RUNTIME_PROVEN` | WO-MAO-030 compiles canonical team plans into opaque, host-trusted current-session native assignments with bridge-backed messaging, cancellation, sanitized evidence, replay sealing, and ambiguous-side-effect quarantine without durable dispatch. |
| `hosted-codex-role-adapters` | Hosted Codex builder, assurance, remediation, and re-review adapters | `PROVEN` | `WORKER_CANDIDATE` | `HOSTED_SESSION_ONLY` | `RUNTIME_PROVEN` | WO-MAO-031 proves a reusable current-session one-cycle builder, independent assurance, original-builder remediation, and zero-unresolved-thread re-review lifecycle through the atomically authority-fenced WO-MAO-030 bridge. |
| `cross-provider-routing-review-model` | Cross-provider routing and review model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-034 proves a zero-input canonical control-plane route to hosted Codex and a distinct logical same-provider review route while excluding unavailable Claude; exact independent candidate assurance is bound separately. |
| `provider-health-reroute-model` | Provider health, circuit breaker, and reroute model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-035 proves a zero-input canonical provider-health registry with trusted observations, stateful breaker transitions, bounded static reroute selection, and explicit unavailable-provider deferment. |
| `provider-conformance-suite-model` | Provider conformance suite model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-036 proves a zero-input canonical provider conformance suite: hosted Codex is session-only conformant, Claude remains deferred, and the rejected local nested adapter remains rejected. |
| `branch-commit-push-automation-model` | Branch, commit, and push automation model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-037 proves a zero-input governed branch/commit/push lifecycle plan with active-grant, trust-gate, reservation, lease-fence, reserved-path, secret-scan, attribution, and rollback gates. |
| `pr-creation-packet-linkage-model` | PR creation and packet linkage model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-038 provides a deterministic PR packet linkage model that derives PR title/body/linkage requirements from verified Work Order, authority, validation, and evidence records. |
| `ci-review-ingestion-model` | CI and review ingestion model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-039 provides a deterministic CI and review ingestion model that classifies check terminal states, review threads, and failure sources for downstream remediation gates. |
| `remediation-rereview-model` | Automated remediation and re-review model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-040 provides a deterministic bounded remediation and independent re-review model that routes actionable findings back to the original builder contract. |
| `bounded-merge-controller-model` | Bounded merge controller model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-041 provides a deterministic merge-eligibility model that verifies authority, freshness, checks, review-thread, security, authority, and branch-protection gates. |
| `post-merge-verification-cleanup-model` | Post-merge verification and cleanup model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-042 provides a deterministic post-merge verification and safe-cleanup decision model that records main, production-route, evidence-preservation, and cleanup denial gates. |
| `automatic-dependent-release-model` | Automatic dependent release model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-043 provides a deterministic dependent-release decision model that recomputes the eligible set and releases only dependency-cleared work without owner polling. |
| `github-lifecycle-conformance-model` | GitHub lifecycle conformance model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-044 proves the Phase 5 GitHub lifecycle model chain from branch delivery through dependent release without executing GitHub operations. |
| `independent-secret-identity-trust-audit-model` | Independent secret, identity, and trust-boundary audit model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-045 proves a sealed independent audit over secret, identity, GitHub authority, runtime, and owner-operation boundaries. |
| `retry-idempotency-duplicate-prevention-model` | Retry, idempotency, and duplicate prevention model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-046 proves bounded retry classification, compare-and-swap idempotency, and duplicate prevention fences without executing a scheduler or provider. |
| `worker-coordinator-recovery-model` | Worker and coordinator recovery model | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-047 proves durable recovery decisions for worker or coordinator death before write, during edit, after commit, after push, and with PR open. |
| `provider-outage-failover-drill-model` | Provider outage and failover drill | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-048 proves network, 401/403, 429, 5xx, timeout, and stream-failure classification with bounded retry, quarantine, reroute, or block decisions. |
| `stale-base-ci-review-merge-race-model` | Stale-base, CI, review, and merge-race drill | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-049 proves stale-base, CI failure, review, and merge-race classification without rebasing, rerunning CI, resolving review threads, or merging. |
| `malicious-defective-worker-drill-model` | Malicious/defective worker drill | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-050 proves scope escape, fabricated evidence, secret request, policy override, prompt injection, unauthorized production intent, and unsafe cleanup containment. |
| `status-evidence-owner-decision-ux-model` | Status, evidence, and owner-decision UX | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-051 makes outcomes, active lanes, dependencies, reservations, providers, evidence, and exact owner authority walls visible in the Portfolio Operator surface. |
| `kill-revoke-rollback-incident-procedure-model` | Kill, revoke, rollback, and incident procedure | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-052 proves static incident procedure decisions for worker/provider quarantine, checkpoint preservation, owned rollback, foreign cleanup denial, and genuine owner authority walls. |
| `resilience-safety-rollup-model` | Resilience and safety rollup | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-053 proves the Phase 6 resilience and safety evidence chain across secret trust, retry/idempotency, recovery, failover, race handling, defective-worker containment, owner-decision UX, and incident procedure. |
| `certification-portfolio-selection-model` | Certification portfolio selection | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-054 selects two independent useful Codex certification lanes, one dependent fan-in lane, and excludes Claude with the existing provider-unavailable finding. |
| `concurrent-certification-lanes-model` | Concurrent certification lanes | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-055 executes two independent static useful Codex certification lanes with disjoint reservations and records the dependent fan-in projection. |
| `cross-review-ci-remediation-certification-model` | Cross-review and CI remediation certification | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-056 records one requested-changes cycle, one classified CI repair cycle, zero unresolved review threads, and corrected WO-MAO-055 reservation accounting. |
| `live-failure-recovery-certification-model` | Live failure and recovery certification | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-057 records five bounded live recovery injections during useful repository delivery: worker death, coordinator restart, provider/network failure, reservation collision, and stale-base refresh. |
| `merge-verify-clean-fanin-release-model` | Merge, verification, cleanup, and fan-in release certification | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | WO-MAO-058 records the merged PR #411 and PR #412 fan-in, main/prod verification, owned disposable branch cleanup classification, and release of WO-MAO-059. |
| `claude-code-provider` | Claude Code provider lane | `UNAVAILABLE` | `WORKER_CANDIDATE` | `EXCLUDED` | `EXCLUDED` | The completed static provider assessment finds no authenticated supported Claude transport or conformant adapter; the provider is disabled and its affected lane remains resumably deferred. |
| `brain-council-advisory` | Brain Council advisory surface | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | Brain Council is a static advisory and decision-packet read model. |
| `agent-forge-governance` | Agent Forge governance surface | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | Agent Forge provides skill governance, quarantine, review, and safety read models. |
| `hermes-worker-sidecar` | Hermes resident Codex worker | `PROVEN` | `EXECUTABLE_WORKER` | `LIVE_BOUNDED_RESIDENT` | `RUNTIME_PROVEN` | A native non-elevated Windows supervisor has proven one fenced WilliamOS-native R0/R1 outcome at a time through Codex App Server with persisted execution projection; current host liveness is verified separately. |
| `ollama-local-model` | Ollama local model capacity | `PROVEN` | `NON_EXECUTABLE` | `NON_RUNTIME` | `STATIC_READ_ONLY` | The existing registry records local reasoning capacity; model availability is not an agent or repository-delivery worker claim. |

## Non-Inference Rules

- A `PROVEN` static model is not a worker.
- `HOSTED_SESSION_ONLY` records bounded current-session proof, not durable resident dispatch.
- `LIVE_BOUNDED_RESIDENT` records retained Hermes delivery proof; application health and actual worker
  liveness remain separate checks.
- The production web app reads persisted execution projections but does not host the Hermes worker.
- Only the Hermes resident capability is an `EXECUTABLE_WORKER`.
- The issue #357 local nested Codex adapter remains terminally rejected and cannot be retried,
  reactivated, wrapped, renamed, or silently reused.
- Claude remains unavailable and excluded without owner diagnostic or credential work.
- Hermes excludes unrestricted runtime, TerraFusion, TerraPilot, Property Workbench, county/PACS or
  protected data, secrets or credential inspection, production mutation or deployment, paid overage,
  release/tag operations, and destructive operations.

## Promotion Rule

Promotion is a reviewed state transition, not a documentation label change. A candidate needs provider
identity, adapter conformance, exact authority evidence, path confinement, preventive trust enforcement,
provider-output redaction, cancellation, and independent evidence capture. The machine registry and its
dispatch evaluator remain the enforcement source.

## Safety

This document and its parity tests add no provider call, worker process, queue, scheduler, command
runner, credential handling, GitHub write, production mutation, database/schema change, package change,
dynamic ingestion, or owner operation. They describe the already-proven bounded resident Hermes reality
without activating it.
