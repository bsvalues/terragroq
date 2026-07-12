# WilliamOS Loop Registry

Work order: `WO-RUNTIME-IDENTITY-001 through WO-RUNTIME-IDENTITY-038`
Goal: `GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001 (playbook active; runtime disabled)`
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

## Active Loop State

### `LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Status: `playbook active / OMEN runtime disabled`

Goal: `GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001`

Program: `PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001`

Current Work Order:
`WO-RUNTIME-IDENTITY-001 - Live Baseline and Containment Reconciliation`.

Selection: first incomplete Work Order whose dependencies and authority gates
are satisfied.

Continuation: execute `WO-RUNTIME-IDENTITY-001` through
`WO-RUNTIME-IDENTITY-038`, owning routine implementation, validation, PR,
review remediation, eligible merge, evidence, and next-WO resolution.

Owner stops occur only for interactive `codex login`, interactive
`gh auth login`, local activation/revocation, physical or elevated host
administration, or a typed scope/risk wall. Pending checks, review feedback,
recoverable failures, PR merge, restart, context compaction, and completed Work
Orders are nonterminal.

Canonical playbook:
`docs/governance/local-identity-runtime-operator-playbook.md`

### `LOOP-PORTFOLIO-OPERATOR-001`

Status: `standing`

Selection rule: finish active work and PR remediation first, then rank the
ratified backlog and activate the highest-priority dependency-cleared program
inside standing authority. Stop only when no approved executable program
exists or a typed authority wall is reached.

### `LOOP-RELEASE-ENGINEERING-001`

Status: `ready / deferred behind runtime operator activation`

Goal: `GOAL-RELEASE-ENGINEERING-001`

Active Work Order: `WO-RELEASE-001`

Continuation: complete the six bounded release-engineering Work Orders, then
return to `LOOP-PORTFOLIO-OPERATOR-001` for the next program selection.

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

1. Reconcile containment and retire the raw credential-file contract.
2. Establish ChatGPT and GitHub CLI browser-login contracts with keyring-only
   storage.
3. Move the identity-bearing supervisor to William's native Windows user
   context.
4. Keep Docker validation-only and credential-free.
5. Implement native checkpoint, lease, patch, GitHub, audit, budget, and safety
   controls.
6. Prove disabled, authenticated read-only, pilot, review/merge, kill, restart,
   and recovery behavior.
7. Close the runtime goal and return automatically to the portfolio resolver.

Runtime activation remains disabled until the explicit owner activation gate at
`WO-RUNTIME-IDENTITY-029`.

Historical Shell, WOE, Evidence, Authority, Council, Trace/Eval, Memory,
Academy/Wiki, Hermes-boundary, Agent Forge, local-status refinement,
dedicated-host planning, Codex Operator adoption, queue reconciliation, County
Ops, TerraFusion preflight, TerraFusion command, portfolio selection, GitHub
Actions containment, and raw-file local-host work remain evidence rather than
active queue entries.

## Stop Gates

Codex stops before:

- live Hermes activation
- autonomous worker execution
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
```

## Registry Maintenance

Update this registry when a loop completes, a new authorized loop is inserted,
a loop is blocked, or William explicitly changes the execution order.
