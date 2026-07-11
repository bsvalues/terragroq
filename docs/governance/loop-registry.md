# WilliamOS Loop Registry

Work order: `WO-TF-COMMAND-000A through WO-TF-COMMAND-000F`
Goal: `GOAL-TF-COMMAND-PREFLIGHT-001 - TerraFusion Command Layer Preflight`
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

## Canonical Active Loop

### `LOOP-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

- Goal: `GOAL-TF-COMMAND-PREFLIGHT-001`
- Program: `PROGRAM-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`
- Mode: sequential R0 preflight
- Start: `WO-TF-COMMAND-000A`
- Continue until: `WO-TF-COMMAND-000F` is verified complete or a typed
  authority wall is reached
- Selection: first incomplete preflight Work Order in declared order
- Product posture: repository-local static inventory, contracts, governance,
  and evidence only
- Stop before: external repository access, live status ingestion, deployment
  inspection, credentials, county/PACS interaction, runtime activation,
  persistence, or mutation

Codex owns this eligible chain through validation, PR, review remediation,
eligible merge, post-merge verification, evidence, and next-goal resolution.

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

1. Inventory existing WilliamOS TerraFusion references.
2. Define project identity and provenance states.
3. Define static project-card and feed contracts.
4. Define deployment and staleness semantics.
5. Classify authority and safety boundaries.
6. Record the implementation decision and preflight evidence.
7. Merge, verify, and resolve whether the R1 static implementation may begin.

Historical Shell, WOE, Evidence, Authority, Council, Trace/Eval, Memory,
Academy/Wiki, Hermes-boundary, Agent Forge, local-status refinement,
dedicated-host planning, Codex Operator adoption, queue reconciliation, and
County Ops work remain evidence rather than active queue entries.

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
