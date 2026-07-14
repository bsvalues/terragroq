# WilliamOS Multi-Agent Operator Playbook

**Document:** `WILLIAMOS-MULTI-AGENT-OPERATOR-PLAYBOOK-001`

**Program:** `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

**Goal:** `GOAL-WOS-MULTI-AGENT-OPERATOR-001`

**Loop:** `LOOP-WOS-MULTI-AGENT-OPERATOR-001`

**Repository:** `bsvalues/terragroq`

**Audited baseline:** `origin/main = 21ef3f37003d51834b80a458b504a7a2a32ecd6f`

**Status:** `PROPOSED / EXECUTION DISABLED / PLAYBOOK ONLY`

**Risk ceiling:** R3 for control-plane implementation; real pilots are limited to preauthorized R0/R1 work.

## 1. Mission

Make WilliamOS a real multi-agent operating system that selects dependency-cleared work, reserves
non-overlapping scopes, dispatches multiple builders and independent reviewers, completes the GitHub
lifecycle, releases dependent work, and recovers from routine failures without turning William into an
agent, operator, dispatcher, test runner, credential courier, or status courier.

The failed nested local Codex runtime is rejected. Issue #357 is terminal evidence, not a retry target.
Issue #358 remains dependency-blocked and must not be represented as ready.

This program deliberately proves a useful hosted Codex team before building another durable runtime.
Governance, UI, schemas, and simulations cannot substitute for completed repository work.

## 2. Owner-Only Constitution

```text
WILLIAM_ROLE=OWNER_ONLY
WILLIAM_AGENT=false
WILLIAM_OPERATOR=false
WILLIAM_DISPATCHER=false
WILLIAM_ROUTINE_APPROVER=false
WILLIAM_CREDENTIAL_COURIER=false
WILLIAM_DIAGNOSTIC_COURIER=false
```

William may be asked only for a genuinely new authority decision:

- material product scope or policy;
- new spending, contract, account, or provider grant;
- production data mutation or release/cutover authority;
- destructive or irreversible action;
- legal, privacy, or security-risk acceptance that cannot be resolved technically.

William must never be asked to:

- run PowerShell, shell, Git, smoke, test, or diagnostic commands;
- close, reopen, restart, activate, disable, or monitor an application or worker;
- copy prompts, logs, patches, screenshots, tokens, error identifiers, or status between systems;
- repair provider authentication or networking;
- create branches, commit, push, open or promote PRs, monitor CI, answer reviews, merge, or clean up;
- choose routine implementation details already inside the active authority envelope;
- poll a queue or release a dependent Work Order.

Every run records:

```text
OWNER_OPERATION_TOUCH_COUNT
OWNER_CREDENTIAL_TOUCH_COUNT
OWNER_DIAGNOSTIC_TOUCH_COUNT
OWNER_ROUTINE_DECISION_COUNT
```

Certification requires all four counters to equal zero. Any prohibited owner operation produces
`FAIL_OWNER_BABYSITTING` and automatically disqualifies the run.

## 3. Current Truth and Supersession

At the audited baseline:

- the operational kernel is real but serial: one checkpoint, one selected issue, one worktree, one
  branch, one PR, and one `invokeCodex` call;
- the Codex operator registry declares a sequential loop;
- Codex, Claude Code, and Hermes are disabled/proposal-only in the worker registry;
- the agent matrix blocks Codex commit/push/merge and limits Claude to draft/synthesis work;
- Brain Council, Agent Forge, and Hermes are truthful governance/read-model surfaces, not active
  workers;
- the old DevOps playbook says William is the operator;
- issue #357 is blocked terminal after three `CODEX_NETWORK_WALL` attempts;
- issue #358 is dependency-blocked even though its stale GitHub label says ready;
- the local nested-Codex adapter is not an accepted execution surface.

This playbook supersedes conflicting active claims. Historical evidence remains intact.

## 4. Target Operating Model

### WilliamOS control plane

WilliamOS owns dependency resolution, reservations, provider routing, authority matching, leases,
checkpoints, evidence, retry/reroute policy, review assignment, merge eligibility, dependent release,
and owner-decision presentation.

### Hosted Codex team

A supported Codex session uses one coordinator and bounded native subagents:

- Builder A owns one reserved lane.
- Builder B owns another dependency-cleared, non-overlapping lane.
- Assurance owns read-only independent review.
- The coordinator owns dispatch, evidence, GitHub state, continuation, and true-wall detection.

The coordinator does not become the default builder. Slots are reused as work completes.

### Claude provider lane

Claude Code may own a separate repository or independently reserved suite lane only through an already
authenticated, supported execution surface. It gets its own branch/worktree, packet, reservations,
tests, evidence, and reviewer. Claude and Codex may cross-review; remediation returns to the original
builder.

If Claude is unavailable, its lane becomes `PROVIDER_UNAVAILABLE`. William is not asked to launch,
authenticate, or repair it, and healthy Codex lanes continue.

### Rejected adapter

The nested local `codex exec` supervisor used by #357 remains `QUARANTINED_TERMINAL`. This program may
read its evidence but may not reactivate, retry, wrap, rename, or silently reuse it.

## 5. Canonical Execution State

```text
PLANNED
  -> AUTHORITY_MATCHED
  -> DEPENDENCY_CLEARED
  -> RESERVED
  -> LEASED
  -> PROVIDER_DISPATCHED
  -> EXECUTING
  -> VALIDATING
  -> PR_OPEN
  -> INDEPENDENT_REVIEW
  -> REMEDIATING (bounded loop)
  -> MERGE_ELIGIBLE
  -> MERGED
  -> VERIFIED
  -> COMPLETE
  -> DEPENDENTS_RELEASED
```

Typed non-success states:

```text
RETRY_SCHEDULED
REROUTE_PENDING
DEFERRED
BLOCKED_DEPENDENCY
BLOCKED_RESERVATION
BLOCKED_NO_ELIGIBLE_PROVIDER
BLOCKED_POLICY_CHANGED
FAILED_VALIDATION_TERMINAL
FAILED_REVIEW_TERMINAL
FAILED_SECURITY_TERMINAL
FAILED_OWNER_BABYSITTING
OWNER_DECISION_REQUIRED
```

Provider, network, GitHub, CI, worktree, and merge-conflict failures are operational states, not owner
decisions.

## 6. Mandatory Work-Order Packet

```yaml
schemaVersion: 2
workOrderId:
programId:
goalId:
loopId:
objective:
riskClass:
repositories:
baseRefs:
dependencies: []
fanInGate: ALL
laneId:
teamRoles:
  coordinator:
  builder:
  reviewer:
providerRequirements: []
preferredProviders: []
fallbackProviders: []
reservations:
  paths: []
  contracts: []
  environments: []
allowedActions: []
forbiddenActions: []
authorityGrants: []
requiredOutputs: []
requiredValidation: []
reviewRequirements: []
mergeMode:
retryBudget:
remediationBudget:
reroutePolicy:
stopConditions: []
evidenceTargets: []
ownerDecisionConditions: []
ownerOperationsAllowed: false
```

Missing or contradictory fields keep a packet out of `DEPENDENCY_CLEARED`.

## 7. Work-Order Program

Numbering identifies records. Dependencies, reservations, and authority—not numeric order—control
execution. Work Orders in the same wave should run concurrently when their dependency and reservation
sets permit.

### Phase 0 — Truth, containment, and authority

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-001` | Terminalize the rejected local adapter | None | Record #357 as `FAILED_TERMINAL/CODEX_NETWORK_WALL`, mark the adapter `QUARANTINED_TERMINAL`, prohibit retry, preserve sanitized evidence, and keep activation disabled. |
| `WO-MAO-002` | Correct the stale queue | 001 | Remove #358 from the ready set, record its dependency explicitly, and reconcile labels, queue records, goal/loop state, and the active-program queue without executing either issue. |
| `WO-MAO-003` | Ratify the Owner-Only Constitution | None | Make the four owner-touch counters and `FAIL_OWNER_BABYSITTING` binding across goals, loops, WOs, stop packets, UI, and evidence. Every routine action has a non-owner assignee. |
| `WO-MAO-004` | Publish the executable capability inventory | 001 | Mark every surface `PROVEN`, `AVAILABLE_UNPROVEN`, `UNAVAILABLE`, or `REJECTED`. Brain Council, Forge, Hermes, and named agents cannot appear active without a conformant adapter. |
| `WO-MAO-005` | Register the multi-agent program | 002-004 | Register this Program/Goal/Loop as the active successor; mark the local runtime program terminal, preserve historical evidence, and point the umbrella WO playbook to this canonical execution list. |
| `WO-MAO-006` | Reconcile agent authority entrypoints | 003-005 | Add canonical root agent instructions and a Claude provider adapter; supersede “William is the operator,” sequential-only, and provider-specific authority claims. Instructions narrow authority and never create a competing hierarchy. |
| `WO-MAO-007` | Worker registry and authority matrix v2 | 004, 006 | Separate catalog entries from executable workers; express per-WO capabilities and grants; remove blanket reliance on William for writes/commits/promotions; fail closed for unproven providers. |

**Phase gate:** repository truth is accurate, the failed adapter cannot run, and William's non-operating
role is mechanically testable.

### Phase 1 — Immediate hosted Codex-team proof

This phase occurs before another durable scheduler is built. It proves the multi-agent operating model
using the native team capability available in a supported Codex session.

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-008` | Select a useful proof portfolio | 005, 007 | Deterministically select two independent R0/R1 repository WOs plus one dependent WO. Paths and contracts must be disjoint for the first two lanes. William does not invent or dispatch test work. |
| `WO-MAO-009` | Build the hosted-team dispatch packet | 008 | Produce coordinator, Builder A, Builder B, and assurance packets with explicit reservations, tests, retry limits, evidence targets, and merge authority. |
| `WO-MAO-010` | Execute hosted Codex lane A | 009 | Builder A implements and validates a useful bounded WO in its own branch/worktree without owner operations. |
| `WO-MAO-011` | Execute hosted Codex lane B | 009 | Builder B executes concurrently on non-overlapping reservations; evidence must show overlapping execution intervals and distinct agent identities. |
| `WO-MAO-012` | Independent assurance and collision audit | 009-011 | A non-builder reviews scope, diff, tests, security, and reservation isolation; deliberately conflicting fixture work proves only one writer can own a reservation. |
| `WO-MAO-013` | Hosted PR and remediation lifecycle | 010-012 | Agents commit, push, open PRs, monitor CI, ingest review threads, remediate bounded findings, and reach zero unresolved substantive threads. William performs no GitHub operation. |
| `WO-MAO-014` | Hosted merge, verification, and dependent release | 013 | Merge only under recorded authority, verify main and scope-appropriate routes/artifacts, clean worktrees, and automatically release the dependent WO. |
| `WO-MAO-015` | Hosted-team proof rollup | 010-014 | Record `CODEX_NATIVE_TEAM=PROVEN` only if useful work merged, concurrency and independent review were real, the dependent released automatically, and all four owner-touch counters are zero. This does not yet claim durable unattended operation. |

**Phase gate:** native Codex team execution is proven on real work. Failure stops architecture inflation and
produces a provider/platform gap; it does not send William to a terminal.

### Phase 2 — Canonical machine contracts

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-016` | Work-order envelope v2 | 015 | Implement and validate the mandatory packet, including dependencies, providers, roles, reservations, retries, fallback, fan-in, authority, evidence, and zero-owner-operation fields. |
| `WO-MAO-017` | DAG and eligible-set resolver | 016 | Replace global sequential selection with cycle-safe dependency evaluation that releases all eligible WOs and preserves explicit defer semantics. |
| `WO-MAO-018` | Reservation ledger | 016 | Implement atomic read/write reservations for paths, contracts, environments, repositories, and protected resources; collision occurs before dispatch. |
| `WO-MAO-019` | Provider capability and dispatch contract | 016 | Define provider-neutral capability discovery, dispatch, status, cancellation, artifact, and evidence interfaces. Unsupported work is never dispatched. |
| `WO-MAO-020` | Canonical lifecycle and escalation taxonomy | 016-019 | Implement the state machine and typed retry/reroute/defer/block/security/owner-decision vocabulary; transport failures cannot map to owner decisions. |
| `WO-MAO-021` | Per-lane leases and checkpoints | 017-020 | Replace the global checkpoint with atomic, expiring, renewable per-WO/per-lane leases, heartbeats, idempotency keys, and durable checkpoints. |
| `WO-MAO-022` | Evidence ledger and owner-touch meter | 003, 016-021 | Persist sanitized authority, worker, provider, reservation, transition, test, commit, PR, review, merge, cleanup, failure, and owner-contact events. Raw auth material is forbidden. |

**Phase gate:** WilliamOS can represent and evaluate concurrent execution mechanically without invoking a
provider.

### Phase 3 — Multi-agent scheduler and isolation

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-023` | Eligible-set scheduler and worker pool | 017-022 | Dispatch all safe eligible work subject to provider, repository, risk, and concurrency budgets; no `.find()` single-WO bottleneck remains. |
| `WO-MAO-024` | Team topology and fan-out/fan-in | 019, 021-023 | Assign coordinator, builders, reviewers, remediators, merge controller, and verifier; fan-in waits only on declared dependencies. |
| `WO-MAO-025` | Isolated workspace manager | 018, 021-024 | Create, validate, reconcile, and clean per-lane branches/worktrees; foreign changes and shared worktrees are never absorbed. |
| `WO-MAO-026` | Reservation-aware handoff | 018, 024-025 | Transfer work from builder to reviewer/remediator/verifier without enabling a second writer or releasing unsafe reservations. |
| `WO-MAO-027` | Concurrency budgets, priority, and fairness | 023-026 | Enforce per-provider/repo/global ceilings, aging, starvation prevention, rate-limit backpressure, and security preemption. |
| `WO-MAO-028` | Scheduler simulation and model checking | 017-027 | Pass deterministic DAG, cycle, collision, fan-in, duplicate-delivery, expiry, starvation, deadlock, cancellation, and replay tests with zero owner contact. |

### Phase 4 — Provider adapters and federation

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-029` | Supported Codex capability proof | 015, 019 | Record the exact supported coordinator/subagent/tool/persistence limits of the chosen Codex surface. No interactive auth surface is represented as a service transport. |
| `WO-MAO-030` | Hosted Codex coordinator adapter | 024, 028-029 | Translate a team plan into bounded native agent assignments, messaging, cancellation, and evidence without requiring William to relay prompts or results. |
| `WO-MAO-031` | Codex builder, assurance, and remediation adapters | 026, 029-030 | Prove isolated build, independent review, requested-changes remediation, and bounded re-review using the common provider contract. |
| `WO-MAO-032` | Claude capability and transport proof | 019, 022 | From Claude's own supported managed environment, prove capabilities and authenticated readiness without exposing credentials or asking William to run a smoke. Unavailable means disabled, not an owner wall. |
| `WO-MAO-033` | Claude separate-repository/suite adapter | 025, 028, 032 | Execute one bounded candidate in a separate repo or disjoint suite with its own packet, branch, reservation, tests, and evidence. |
| `WO-MAO-034` | Cross-provider routing and review | 024, 031, 033 | Match capabilities to WOs, keep secrets and workspaces isolated, and support Codex reviewing Claude and Claude reviewing Codex where permitted. |
| `WO-MAO-035` | Provider health, circuit breakers, and reroute | 020-022, 030-034 | Classify 401/403, 429, network, 5xx, malformed output, timeout, and deterministic failure; quarantine or back off and reroute within budget. William is never the fallback worker. |
| `WO-MAO-036` | Provider conformance suite | 028-035 | Every enabled provider passes the same dispatch, status, cancel, evidence, isolation, retry, and recovery contract. Provider-specific exceptions cannot weaken the scheduler. |

**Phase gate:** Codex is active only when conformant. Claude is active only when independently available
and conformant. One unavailable provider cannot block unrelated healthy lanes.

### Phase 5 — GitHub delivery engine

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-037` | Branch, commit, and push automation | 007, 025-026, 036 | Create governed branches, commit only reserved files, exclude foreign changes/secrets, push with attributable identity, and preserve rollback. |
| `WO-MAO-038` | PR creation and packet linkage | 022, 037 | Open draft/ready PRs as authorized and generate the PR body from verified WO, authority, validation, and evidence records. |
| `WO-MAO-039` | CI and review ingestion | 020, 022, 038 | Observe checks and threads to terminal state; distinguish product, flaky infrastructure, provider, policy, and stale-base failures. |
| `WO-MAO-040` | Automated remediation and re-review | 026, 031, 039 | Route actionable findings to the original builder, apply bounded repairs, rerun validation, and obtain independent re-review. |
| `WO-MAO-041` | Bounded merge controller | 007, 020, 039-040 | Merge only when authority, freshness, scope, reservations, checks, security, and zero unresolved substantive review gates pass. No branch-protection bypass. |
| `WO-MAO-042` | Post-merge verification and cleanup | 022, 025, 041 | Verify main, deployment/routes/artifacts as applicable, release reservations, remove only proven-safe worktrees, and preserve evidence. |
| `WO-MAO-043` | Automatic dependent release | 017, 020, 042 | Recompute the eligible set and dispatch newly cleared dependents without owner polling or activation. |
| `WO-MAO-044` | GitHub lifecycle conformance | 037-043 | Prove ready queue through verified merge and dependent release with zero manual Git/GitHub actions. |

### Phase 6 — Security, resilience, and owner-safe operations

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-045` | Secret, identity, and trust boundary | 022, 036-044 | Prove no raw token/keyring/cache inspection, no cross-provider credential sharing, prompt-injection resistance, path confinement, redaction, attribution, and revocation. |
| `WO-MAO-046` | Retry, idempotency, and duplicate prevention | 021, 035, 044 | Bounded state-specific retries and idempotency prevent duplicate branches, commits, PRs, comments, merges, deploys, or cleanup. |
| `WO-MAO-047` | Worker and coordinator recovery | 021, 025, 030-031, 046 | Recover from death before write, during edit, after commit, after push, and with PR open; reconstruct from durable state without concurrent writers. |
| `WO-MAO-048` | Provider outage and failover drill | 035-036, 046-047 | Inject network, 401/403, 429, 5xx, timeout, and stream failures; retry, quarantine, reroute, or block without owner diagnostics. |
| `WO-MAO-049` | Stale-base, CI, review, and merge-race drill | 039-041, 046 | Rebase/revalidate safely, repair deterministic failures, allow one classified flaky retry, and prevent stale or concurrently changed candidates from merging. |
| `WO-MAO-050` | Malicious/defective worker drill | 045-049 | Stop scope escape, fabricated evidence, secret requests, policy override, prompt injection, unauthorized production intent, and unsafe cleanup. |
| `WO-MAO-051` | Status, evidence, and owner-decision UX | 003, 022, 044-050 | Show outcomes, lanes, dependencies, reservations, providers, evidence, and exact genuine authority walls. No routine run/retry/fix/merge controls are assigned to William. |
| `WO-MAO-052` | Kill, revoke, rollback, and incident procedure | 045-051 | Quarantine a worker/provider, cancel leases, preserve safe checkpoints, roll back only owned changes, continue isolated healthy lanes, and present owner decisions only when necessary. |
| `WO-MAO-053` | Resilience and safety rollup | 045-052 | Independent assurance confirms every injected failure is bounded, evidence is complete, and no critical defect is waived as pilot friction. |

### Phase 7 — Real unattended certification

| WO | Title | Depends on | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| `WO-MAO-054` | Select the certification portfolio | 036, 044, 053 | Select two independent useful Codex WOs, one dependent fan-in WO, and one separate Claude repo/suite WO if Claude is conformant. No synthetic evidence-only file is sufficient. |
| `WO-MAO-055` | Execute concurrent certification lanes | 054 | Run at least two builders concurrently with isolated reservations and an independent assurance agent; Claude runs separately when enabled. |
| `WO-MAO-056` | Cross-review, CI, and remediation certification | 055 | Complete at least one requested-changes cycle and one CI repair with zero unresolved substantive threads and no owner involvement. |
| `WO-MAO-057` | Failure and recovery certification | 055 | During real delivery inject one worker death, one coordinator restart, one provider/network failure, one reservation collision, and one stale-base event; recover or block safely. |
| `WO-MAO-058` | Merge, verify, clean, and fan-in release | 056-057 | Merge at least two authorized useful PRs, verify results, clean owned resources, and automatically release and execute the dependent WO. |
| `WO-MAO-059` | Sustained zero-touch soak | 058 | Run a minimum 24-hour or ten-consecutive-WO soak, whichever is more demanding, with bounded concurrency, recovery, evidence continuity, and no operational owner contact. |
| `WO-MAO-060` | Zero-owner-touch audit | 054-059 | Independent audit proves all four owner-touch counters are zero and that any genuine owner decision was authority-only and outside the execution path. |
| `WO-MAO-061` | Unattended multi-agent certification | 060 | Accept only if real useful work merged, concurrency, fan-in, review, remediation, provider isolation, recovery, and successor release all passed. Otherwise publish an evidence-backed rejection. |
| `WO-MAO-062` | Program closure and portfolio continuation | 061 | Update the capability matrix, close the goal only on proof, keep failed providers quarantined, and return routine work to automatic portfolio selection. William receives outcomes, not chores. |

## 8. Dependency Waves

```text
Wave 0A: 001, 003, 004
Wave 0B: 002, 005, 006, 007
Wave 1:  008-015       immediate hosted-team proof
Wave 2:  016-022       machine contracts
Wave 3:  023-028       scheduler and isolation
Wave 4A: 029-031       Codex adapter
Wave 4B: 032-036       Claude/federation and conformance
Wave 5:  037-044       GitHub delivery
Wave 6:  045-053       safety and recovery
Wave 7:  054-062       real unattended certification
```

The eligible-set resolver may run independent WOs inside a wave concurrently. The ranges are planning
groups, not a global serialization rule.

## 9. Failure Matrix

| Failure | Required machine behavior | Budget | Forbidden response |
| --- | --- | ---: | --- |
| DNS/TLS/stream reset | checkpoint, bounded retry, alternate provider if compatible | 3 attempts + 1 reroute | ask William to run a smoke |
| 401/403 | quarantine provider; do not inspect credentials | 0 same-provider retries | ask William to expose or repair auth |
| 429 | honor retry timing and reschedule | 2 | manual retry loop |
| 500/502/503 | bounded backoff, then reroute/defer | 3 | repeated owner diagnostics |
| Worker death | expire lease and resume safe checkpoint | 2 replacements | duplicate branch/PR |
| Coordinator death | reconstruct from leases, repo, GitHub, and ledger | 2 restarts | ask William for status |
| Duplicate delivery | idempotent no-op | 0 duplicate effects | second commit/PR/merge |
| Reservation collision | queue or replan before write | no spin | concurrent writers |
| Deterministic validation failure | return to original builder | 3 repairs | owner fixes code |
| Flaky CI | one classified rerun | 1 | indefinite reruns |
| Review changes requested | builder remediates, reviewer rechecks | 3 cycles | owner answers threads |
| GitHub 409/422/base movement | refresh/rebase and fully revalidate | 2 | force push shared work |
| Policy/branch-protection change | stop merge and record changed policy | 0 bypasses | weaken protection |
| No eligible provider | preserve queue and block affected lane | 0 owner diagnostics | make William the worker |

## 10. Immediate Terminal Stop Conditions

The affected envelope self-disables on:

- secret, token, keyring, browser, or auth-cache exposure;
- out-of-scope filesystem, repository, environment, production, or data write;
- concurrent writers on the same reservation;
- duplicate commit, PR, merge, deployment, or external side effect;
- branch-protection, review, authority, or evidence bypass;
- evidence deletion, mutation, fabrication, or unexplained gap;
- worker identity, lease, repository, or base ambiguity;
- successful prompt injection or provider impersonation;
- corrupted repository state without a verified rollback point;
- any request that converts William into an agent or operator;
- any attempt to reactivate or retry the quarantined #357 adapter.

Other isolated lanes may continue only when the failure cannot have crossed their trust boundary.

## 11. Required Repository Integration

Implementation of this playbook must update or create, through normal reviewed PRs:

- `docs/governance/multi-agent-operator-playbook.md` — this canonical playbook;
- `docs/governance/active-program-queue.md` — terminalize the local runtime program and select this one;
- `docs/governance/goal-registry.md` and `docs/governance/loop-registry.md`;
- `docs/governance/williamos-work-order-playbook.md` — cross-reference only;
- `docs/governance/work-order-template.md` — packet v2 and owner-only fields;
- root `AGENTS.md` and `CLAUDE.md` provider adapter;
- `components/operator/multi-agent-operator-registry.ts`;
- `tests/multi-agent-operator-registry.test.ts`;
- `docs/reports/WO-MAO-000-multi-agent-operator-rollup.md`;
- later runtime work under a new `scripts/multi-agent-operator/**` boundary.

The rejected `scripts/runtime-operator/**` local adapter remains evidence and quarantine surface; it is
not incrementally promoted into the new architecture.

## 12. Certification Verdict

WilliamOS is fully realized as an unattended multi-agent builder only when:

```text
CONTROL_PLANE=PROVEN
DAG_ELIGIBLE_SET_SCHEDULER=PROVEN
ATOMIC_RESERVATIONS=PROVEN
CODEX_NATIVE_TEAM=PROVEN
CLAUDE_LANE=PROVEN_OR_TYPED_UNAVAILABLE
PROVIDER_ROUTING_AND_FAILOVER=PROVEN
GITHUB_DELIVERY_LIFECYCLE=PROVEN
INDEPENDENT_REVIEW_REMEDIATION=PROVEN
BOUNDED_OPERATOR_MERGE=PROVEN
DEPENDENT_AUTO_RELEASE=PROVEN
FAILURE_RECOVERY=PROVEN
SECURITY_ISOLATION=PROVEN
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
USEFUL_WORK=MERGED_AND_VERIFIED
UNATTENDED_MULTI_AGENT_BUILDER=PROVEN
```

Until `WO-MAO-061` passes, the truthful state is:

```text
WILLIAMOS_CONTROL_PLANE=REAL
WILLIAMOS_UNATTENDED_MULTI_AGENT_BUILDER=NOT_PROVEN
LOCAL_NESTED_CODEX_RUNTIME=QUARANTINED_TERMINAL
RUNTIME_ACTIVATION=DISABLED
OWNER_ROLE=AUTHORITY_ONLY
```
