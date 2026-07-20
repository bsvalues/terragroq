# WilliamOS Loop Registry

Work order: `WO-OWNER-OUTCOME-001 through WO-OWNER-OUTCOME-006`
Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001 (active)`
Type: Governance / Registry / Continuation
Risk: `R1`

## Purpose

This registry records the current authorized loop order for WilliamOS. It gives
Codex a durable sequence to follow after each completed Work Order while
preserving owner gates and safety blocks.

The registry is not an unattended automation runtime. It does not schedule
background work, execute commands, mutate memory, or activate workers. It does,
however, bind supported hosted-session continuation and GitHub lifecycle work to
the current selected program.

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
in-scope failures, owns eligible pull-request and merge work, records post-merge
proof, and continues. The loop returns to the Primary only for a true authority
wall or final outcome.

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
- Decision: R1 static/read-only implementation was eligible
- Evidence:
  `docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md`

## Canonical Completed TerraFusion Command Loop

### `LOOP-WILLIAMOS-TF-COMMAND-001`

- Goal: `GOAL-TF-COMMAND-001`
- Program: `PROGRAM-WILLIAMOS-TF-COMMAND-001`
- Mode: sequential R1 static/read-only product slice
- Completion: `WO-TF-COMMAND-001` through `WO-TF-COMMAND-006`
- Product posture: repository-local static records, UI read models, tests, and
  evidence only
- Stopped before: external repository access, live ingestion, deployment
  inspection, credentials, county/PACS interaction, persistence, command
  execution, runtime activation, or mutation

Completion merged through PR #339 at
`05fcf18fba8a6a2be5fef7865e3a6842ae9bb747`.

Evidence:
`docs/reports/WO-TF-COMMAND-006-final-rollup.md`

## Closed Multi-Agent Operator Loop

### `LOOP-WOS-MULTI-AGENT-OPERATOR-001`

Status: `CLOSED / CERTIFICATION_REJECTED / PORTFOLIO_CONTINUATION`

Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Selection used dependency-cleared, reservation-compatible Work Orders within
provider and risk budgets. Agents owned implementation, isolated branches,
validation, PRs, review remediation, eligible merge, verification, evidence, and
dependent release. No routine Git, diagnostic, retry, approval, or status-courier
task could be assigned to William.

The local OMEN runtime loop is terminal, non-selectable, and disabled. Issue #357
will not be retried, and #358 remains dependency-blocked.

WO-MAO-001 through WO-MAO-058 completed. WO-MAO-059 rejected sustained
zero-touch certification because useful-work proof passed but no durable
unattended process continued across the 24-hour interval. WO-MAO-060 preserved
the zero-owner-touch audit, WO-MAO-061 rejected unattended multi-agent
certification, and WO-MAO-062 closed the program into portfolio continuation.

## Standing Portfolio Loop

### `LOOP-PORTFOLIO-OPERATOR-001`

Status: `standing`

Selection rule: finish active work and PR remediation first, then rank the
ratified backlog and activate the highest-priority dependency-cleared program
inside standing authority.

Static seed exhaustion is not a valid owner-decision wall when a recorded owner
outcome remains incomplete and useful bounded WilliamOS-native work remains.

## Active Owner Outcome Delivery Loop

### `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Status: `ACTIVE / ORDERED_QUEUE / R1`

Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Active Work Order: `WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation`

Ordered queue:

1. `WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation`
2. `WO-OWNER-OUTCOME-002 - Owner Outcome Intake Contract`
3. `WO-OWNER-OUTCOME-003 - Rolling WilliamOS-Native Backlog`
4. `WO-OWNER-OUTCOME-004 - No-Idle Resolver Invariant`
5. `WO-OWNER-OUTCOME-005 - Useful WilliamOS Feature Delivery Proof`
6. `WO-OWNER-OUTCOME-006 - Safety and Continuation Rollup`

Continuation rule:

```text
CONTINUE_THROUGH_ROLLING_OWNER_OUTCOME_QUEUE
DO_NOT_RETURN_TO_NO_ACTIVE_PROGRAM_WHILE_APPROVED_USEFUL_WILLIAMOS_R0_R1_WORK_REMAINS
```

Codex owns implementation, branch/PR lifecycle, focused and full validation,
review remediation, eligible merge, merged-main verification, evidence, and
successor release. William is contacted only for a genuinely new protected
authority boundary or the final owner outcome.

No magic authorization word, prompt relay, terminal command, diagnostic courier,
PR monitoring, merge action, or routine successor choice may be assigned to
William.

The loop must deliver at least one real WilliamOS feature. Governance-only
completion is insufficient.

Stop only for:

- R2+ authority expansion;
- Property Workbench, TerraPilot, county, PACS, or TerraFusion selection;
- production or deployment mutation;
- secrets, credentials, identity inspection, or protected data;
- new spending or paid overage;
- runtime, command runner, background worker, Hermes, MCP, or rejected issue
  `#357` activation;
- destructive or irreversible operations;
- terminal evidence-backed safety rejection;
- verified completion of the actual owner outcome with no useful bounded
  successor remaining.

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

## Completed WOE Detail Surfaces Loop

### `LOOP-WOE-DETAIL-SURFACES-001`

Status: `complete / closed evidence`

Goal: `GOAL-WOE-DETAIL-SURFACES-001`

Active Work Order: `none`

Continuation: closed after `WO-WILLIAMOS-WOE-DETAIL-SURFACES-001` through
`WO-WILLIAMOS-WOE-DETAIL-SURFACES-004` and PRs #418-#420; it is not the active
continuation target while the owner-outcome delivery loop is selected.

The portfolio loop remains the default continuation path after each program.
Routine implementation, review remediation, already-authorized or otherwise
eligible merge, verification, evidence, and next-program activation do not
require the Primary to courier a new loop. This does not authorize a merge or
other consequential action that lacks authority under the operator playbook.

## Loop Rules

- Codex continues to the next listed Work Order when it remains inside active
  authority.
- Codex stops for genuine owner decisions, secrets, credentials, safety
  exceptions, protected scope expansion, or terminal rejection.
- Each loop validates, records evidence, inspects PR checks and review threads,
  remediates in scope, and verifies merged-main state.
- A merged PR with newly discovered substantive review threads becomes
  `MERGED_WITH_REMEDIATION_REQUIRED` and immediately starts a remediation loop.
- Plain-language owner direction is enough to establish a bounded outcome; no
  magic keyword may be required for routine continuation.

## Historical `GOAL-OPS-001` Loop Order

1. `WO-OPS-001 - Codex Operator Doctrine / No-Go-Between Playbook`
2. `WO-OPS-002 - Goal Registry / Loop Registry Files`
3. `WO-OPS-003 - Standard Result Classifier`
4. `WO-OPS-004 - Review Thread Monitor Protocol`
5. `WO-OPS-005 - Merge Gate Checklist`
6. `WO-OPS-006 - Production Verification Checklist`
7. `WO-OPS-007 - Owner Decision Packet Template`
8. `WO-OPS-008 - Operator Continuation Rule / Stop-Only-On-Gate Policy`

All eight are complete as historical operator-doctrine evidence.

## Stop Gates

Codex stops before:

- unauthorized live Hermes/MCP/worker activation;
- unauthorized background or rejected-adapter execution;
- DB writes or schema migration;
- production county-system integration;
- deployment, release, or tag outside authority;
- env or package changes outside authority;
- secrets or credential handling;
- owner identity changes;
- public account-creation restoration;
- SaaS onboarding restoration;
- paid overage or automatic credit purchase.

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

Every loop return carries the five owner-operation/contact counters. Zero values
are unverified until linked to independent durable evidence for the same run.
Genuine consequential owner authority decisions do not count as routine
operations; using the Owner for courier, credential, diagnostic, routine
decision, or progress contact does.

## Registry Maintenance

Update this registry when a loop completes, a genuinely new protected authority
boundary is authorized, an outcome closes, or William explicitly pauses a lane.
Routine bounded successor generation under the active owner outcome does not
require a new activation packet.
