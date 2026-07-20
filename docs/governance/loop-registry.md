# WilliamOS Loop Registry

Work order: `WO-MAO-001 through WO-MAO-062`
Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001 (closed; local runtime terminal and disabled)`
Type: Governance / Registry
Risk: Low, documentation only

## Purpose

This registry records the current authorized loop order for WilliamOS. It gives
Codex a durable sequence to follow after each completed work order, while
preserving owner gates and safety blocks.

The registry is not an automation runtime. It does not schedule background
work, execute commands, mutate memory, or activate workers.

## Canonical Completed Operator Loop

### `LOOP-WOS-CODEX-OPERATOR-001`

- Goal: `GOAL-WOS-CODEX-OPERATOR-001`
- Program: `PROGRAM-WILLIAMOS-CODEX-OPERATOR-001`
- Mode: sequential
- Continue until: goal complete or typed authority wall
- Selection: first incomplete Work Order whose dependencies are complete
- Current transition: goal complete after `WO-CODEX-OPERATOR-024`
- Product posture: static/read-only decision model; no runtime executor

Codex refreshes live baseline truth before acting, remediates recoverable
in-scope failures, owns eligible pull-request and merge work, records
post-merge proof, and continues. The loop returns to the Primary only for a
true authority wall or final goal closure.

Final pilot proof: PR #333 merged at
`9e3a48395945d7b26449cf2e462bc65142aa136c`; all required production routes
returned HTTP 200 and auth readiness remained healthy with signup closed.

## Canonical Completed Queue Reconciliation Loop

### `LOOP-WOS-ACTIVE-PROGRAM-QUEUE-001`

The queue reconciliation loop completed through PR #336 and advanced to the
County Ops knowledge program.

## Canonical Completed County Ops Loop

### `LOOP-WILLIAMOS-COUNTY-OPS-001`

- Goal: `GOAL-COUNTY-001`
- Program: `PROGRAM-WILLIAMOS-COUNTY-OPS-001`
- Completion: `WO-COUNTY-001` through `WO-COUNTY-010`
- Merge proof: PR #337 at
  `49fa4ffe7917bdc0440950ed7a1fb47cd2c0a837`
- Product posture: static/read-only knowledge; standing safety boundaries remain

## Canonical Completed TerraFusion Preflight Loop

### `LOOP-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

- Goal: `GOAL-TF-COMMAND-PREFLIGHT-001`
- Program: `PROGRAM-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`
- Completion: `WO-TF-COMMAND-000A` through `WO-TF-COMMAND-000F`
- Decision: R1 static/read-only implementation is eligible
- Evidence:
  `docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md`

## Canonical Completed TerraFusion Command Loop

### `LOOP-WILLIAMOS-TF-COMMAND-001`

- Goal: `GOAL-TF-COMMAND-001`
- Program: `PROGRAM-WILLIAMOS-TF-COMMAND-001`
- Mode: sequential R1 static/read-only product slice
- Start: `WO-TF-COMMAND-001`
- Continue until: `WO-TF-COMMAND-006` is verified complete or a typed
  authority wall is reached
- Selection: first incomplete Work Order in declared order
- Product posture: repository-local static records, UI read models, tests, and
  evidence only
- Stop before: external repository access, live ingestion, deployment
  inspection, credentials, county/PACS interaction, persistence, command
  execution, runtime activation, or mutation

Completion: `WO-TF-COMMAND-001` through `WO-TF-COMMAND-006` merged
through PR #339 at `05fcf18fba8a6a2be5fef7865e3a6842ae9bb747`.

Evidence:
`docs/reports/WO-TF-COMMAND-006-final-rollup.md`

## Closed Multi-Agent Operator Loop

### `LOOP-WOS-MULTI-AGENT-OPERATOR-001`

Status: `CLOSED / CERTIFICATION_REJECTED / PORTFOLIO_CONTINUATION`

Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Selection: compute every dependency-cleared Work Order, then dispatch the
largest reservation-compatible set within provider and risk budgets. Numeric
order is an identifier, not a global mutex.

Continuation: agents own implementation, isolated branches/worktrees, focused
and full validation, PRs, review remediation, eligible merge, merged-main
verification, cleanup, evidence, and dependent release. Routine failures are
retried, rerouted, deferred, or terminalized by stable machine reason codes.

Owner communication is final-only except for a genuinely new authority wall.
No run command, diagnostic, provider repair, approval relay, Git operation, or
status courier task may be assigned to William. All owner-operation counters,
including `OWNER_ROUTINE_CONTACT_COUNT`, must remain zero.

The local OMEN runtime loop is terminal, non-selectable, and disabled.
Issue #357 will not be retried, and #358 remains dependency-blocked. Supported hosted
Codex team work does not depend on that rejected adapter.

Canonical playbook:
`docs/governance/multi-agent-operator-playbook.md`

Current transition: `WO-MAO-001` through `WO-MAO-032` are complete, with `WO-MAO-033`
remaining `DEFERRED / PROVIDER_UNAVAILABLE`.
The merged WO-MAO-023 scheduler, deterministic WO-MAO-024 team topology, and WO-MAO-025 isolated-workspace
manager plus WO-MAO-026 reservation-aware handoff and WO-MAO-027 hard-ceiling concurrency admission
policy preserve dependency-, reservation-, and ownership-driven selection. WO-MAO-028 adds pure/static
scheduler model checking without creating provider or runtime authority. WO-MAO-030 adds a current-session hosted
Codex coordinator adapter with host-trusted opaque assignments, replay sealing, and ambiguous-effect quarantine,
without durable provider dispatch, runtime activation, or owner relay. WO-MAO-031 is re-proved
against the hardened opaque-handle role lifecycle contract. Historical WO-MAO-035 and WO-MAO-036
evidence was invalidated and then re-proved through sealed canonical registries.
`WO-MAO-033` is `DEFERRED / PROVIDER_UNAVAILABLE` and resumable. The canonical settlement of its
exact edge into WO-MAO-034 is verified against WO-MAO-032, the consumer envelope, and source-
assessment hash. WO-MAO-034 is complete through independently approved exact-candidate routing
evidence. WO-MAO-035/036 previously kept redundant direct WO-MAO-033 edges fail-closed. The separately ratified graph
correction removes only those redundant edges. WO-MAO-035 through WO-MAO-058 are now complete.
WO-MAO-059 through WO-MAO-062 are complete. WO-MAO-059 rejected the sustained
zero-touch soak certification because the useful-work gate passed but no
durable unattended background process continued across the 24-hour period.
WO-MAO-060 preserved the zero-owner-touch audit, WO-MAO-061 rejected unattended
multi-agent certification, and WO-MAO-062 closed the program into portfolio
continuation.

### `LOOP-PORTFOLIO-OPERATOR-001`

Status: `standing`

Selection rule: finish active work and PR remediation first, then rank the
ratified backlog and activate the highest-priority dependency-cleared program
inside standing authority. Stop only when no approved executable program
exists or a typed authority wall is reached.

### `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Status: `ACTIVE / STANDING / SELECTED`

Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Risk ceiling: `R1`

Selection: use the existing persisted `/goal` records as owner-outcome intake,
then activate only approved, dependency-cleared, reversible WilliamOS-native
R0/R1 Work Orders covered by the standing authority. Goal persistence records
intent and classification; it does not grant execution authority.

Current transition: `WO-OWNER-OUTCOME-001` through
`WO-OWNER-OUTCOME-008` are complete with the feature delivery.
`WO-OWNER-OUTCOME-009 - Rolling Owner Outcome Intake` is `READY`.

Continuation: hosted Codex sessions own routine implementation, validation,
branch and PR lifecycle, review remediation, eligible merge, verification, and
evidence. The loop does not run as a durable WilliamOS runtime or background
worker, and it adds no database or schema.

Allowed: standing R0/R1 WilliamOS-native owner outcomes inside exact recorded
authority and bounded repository reservations.

Blocked: Property Workbench, TerraPilot, county work, PACS, production actions,
secrets, paid overages, runtime activation, and issue #357 retry, reactivation,
wrapping, renaming, or reuse.

Hard invariant: do not transition to `NO_ACTIVE_PROGRAM` or `NO_ACTIVE_LOOP`
while an approved owner outcome has unfinished useful work. Continue selection
and delivery until completion or a typed authority wall.

### `NO_ACTIVE_LOOP`

Status: `inactive sentinel / not current`

Goal: `NO_ACTIVE_GOAL`

Active Work Order: `none`

Continuation: use this sentinel only when no approved executable program and no
approved owner outcome with unfinished useful work exists. The standing owner-
outcome loop is current; blocked programs do not become fallback work.

### `LOOP-WOE-DETAIL-SURFACES-001`

Status: `complete / closed evidence`

Goal: `GOAL-WOE-DETAIL-SURFACES-001`

Active Work Order: `none`

Continuation: closed after `WO-WILLIAMOS-WOE-DETAIL-SURFACES-001` through
`WO-WILLIAMOS-WOE-DETAIL-SURFACES-003`; it is not the active continuation
target while the owner-outcome delivery loop is selected.

The portfolio loop remains the default continuation path after each program.
Routine implementation, review remediation, already-authorized or otherwise
eligible merge, verification, evidence, and next-program activation do not
require the Primary to courier a new loop. This does not authorize a merge or
other consequential action that lacks authority under the operator playbook.

## Loop Rules

- Codex continues to the next listed loop only when it remains inside active
  authority.
- Codex stops for owner decisions, secrets, credentials, safety exceptions, or
  scope expansion.
- Each loop must validate, report evidence, inspect PR checks, inspect review
  threads, and verify production when the merge touches production-relevant
  surfaces.
- A merged PR with newly discovered substantive review threads becomes
  `MERGED_WITH_REMEDIATION_REQUIRED` and immediately starts a remediation loop.

## `GOAL-OPS-001` Loop Order

1. `WO-OPS-001 - Codex Operator Doctrine / No-Go-Between Playbook`
2. `WO-OPS-002 - Goal Registry / Loop Registry Files`
3. `WO-OPS-003 - Standard Result Classifier`
4. `WO-OPS-004 - Review Thread Monitor Protocol`
5. `WO-OPS-005 - Merge Gate Checklist`
6. `WO-OPS-006 - Production Verification Checklist`
7. `WO-OPS-007 - Owner Decision Packet Template`
8. `WO-OPS-008 - Operator Continuation Rule / Stop-Only-On-Gate Policy`

Current status:

- `WO-OPS-001`: complete through PR #300.
- `WO-OPS-002`: complete through PR #301.
- `WO-OPS-003`: complete through PR #302.
- `WO-OPS-004`: complete through PR #303.
- `WO-OPS-005`: complete through PR #304.
- `WO-OPS-006`: complete through PR #305.
- `WO-OPS-007`: complete through PR #306.
- `WO-OPS-008`: complete as a historical operator-doctrine step.

## Current Continuation Order

1. Preserve the completed Phase 0 executable truth and preventive controls.
2. Preserve the completed Phase 1 hosted proof and Phase 2 local-contract evidence.
3. Preserve completed `WO-MAO-034` and the corrected dependency graph; re-prove the now-ready
   `WO-MAO-035`, then `WO-MAO-036`, before Phase 5.
4. Keep useful independent R0/R1 product lanes moving whenever dependencies and
   reservations permit.

The rejected local runtime remains disabled and is not a continuation gate.

Historical Shell, WOE, Evidence, Authority, Council, Trace/Eval, Memory,
Academy/Wiki, Hermes-boundary, Agent Forge, local-status refinement,
dedicated-host planning, Codex Operator adoption, queue reconciliation, County
Ops, TerraFusion preflight, TerraFusion command, portfolio selection, GitHub
Actions containment, and raw-file local-host work remain evidence rather than
active queue entries.

## Stop Gates

Codex stops before:

- live Hermes activation
- unauthorized background or rejected-adapter worker execution (supported hosted lanes inside the
  active multi-agent Work Order are allowed)
- DB writes
- schema migration
- production county-system integration
- deploy, release, or tag
- env changes
- package changes
- Vercel setting changes
- secrets or credential handling
- owner identity changes
- public account-creation restoration
- SaaS onboarding restoration

## Loop Return Shape

Every loop returns:

```text
RESULT:
WORK_ORDER:
GOAL:
BASE:
BRANCH:
COMMIT:
PR:
MERGED:
origin/main:
FILES_CHANGED:
VALIDATION:
REVIEW_THREADS:
PRODUCTION_VERIFICATION:
SAFETY_POSTURE:
OWNER_DECISION_REQUIRED:
NEXT_RECOMMENDED_WO:
OWNER_OPERATION_TOUCH_COUNT:
OWNER_CREDENTIAL_TOUCH_COUNT:
OWNER_DIAGNOSTIC_TOUCH_COUNT:
OWNER_ROUTINE_DECISION_COUNT:
OWNER_ROUTINE_CONTACT_COUNT:
OWNER_OPERATION_EVIDENCE_REF:
OWNER_OPERATION_CERTIFICATION_STATE:
```

Every loop return carries the five owner-operation/contact counters. Zero values are unverified until linked
to independent durable evidence for the same run. Genuine owner authority decisions do not count as
routine operations; using the Owner for courier, credential, diagnostic, routine decision, or progress
contact does.

## Registry Maintenance

Update this registry when a loop completes, a new authorized loop is inserted,
a loop is blocked, or William explicitly changes the execution order.
