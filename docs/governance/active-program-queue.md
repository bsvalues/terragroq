# WilliamOS Active Program Queue

Document: `WILLIAMOS-ACTIVE-PROGRAM-QUEUE-001`

Queue program: `PROGRAM-WILLIAMOS-ACTIVE-QUEUE-001`

Active program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Merged selector baseline: `origin/main = 95cc12c2` after PR #420

Risk ceiling: `R1`

Status: Owner Outcome Delivery is selected from William's standing direction to keep useful bounded WilliamOS-native work moving without repeated activation rituals; Property Workbench/TerraPilot/county placeholders remain owner-gated and nonselectable

## Purpose

Maintain one truthful, deterministic active-program queue while preventing routine
continuation from returning to William. A finite lane may complete, but WilliamOS
must not fall back to `NO_ACTIVE_PROGRAM` while an approved owner outcome still
has useful bounded WilliamOS-native R0/R1 work remaining.

The queue is governance and selection state. It does not itself execute commands,
schedule background work, activate a worker, inspect a host, mutate production, or
change protected authority.

## Current Truth

- `PROGRAM-WILLIAMOS-CODEX-OPERATOR-001` is complete.
- `GOAL-WOS-CODEX-OPERATOR-001` is complete.
- `LOOP-WOS-CODEX-OPERATOR-001` reached goal completion.
- `WO-CODEX-OPERATOR-001` through `024` are complete.
- PRs #333 through #339 are merged.
- Queue reconciliation completed through PR #336.
- County Ops completed through PR #337 at
  `49fa4ffe7917bdc0440950ed7a1fb47cd2c0a837`.
- The Phase 2 dedicated Ubuntu host planning gates already completed through
  `WO-LOCAL-019` to `WO-LOCAL-024`.
- Dedicated-host implementation remains owner-gated because it would require
  host selection and may require OS, package, Docker, network, service,
  backup, or rollback actions.
- Historical recommendations pointing to completed Evidence, Authority,
  Council, Trace, Academy/Wiki, Hermes, Agent Forge, WOE polish, local-status
  refinement, or Ubuntu planning lanes are not active work.
- PR #359 merged the proof-first multi-agent playbook.
- PRs #360 through #362 mechanically quarantined the rejected adapter and
  bound owner-operation evidence surfaces.
- Issue #357 is `FAILED_TERMINAL / CODEX_NETWORK_WALL` and is not retryable.
- Issue #358 is `BLOCKED_DEPENDENCY`; its issue packet records #357 as its
  dependency and its stale ready label has been removed.
- Runtime activation and the local supervisor remain disabled.
- WOE Detail Surfaces completed through PR #420 at
  `95cc12c26404d2b7c566af7557c4d0966e033f83`.
- William's standing direction is to continue useful bounded WilliamOS work
  without making him repeat magic-word authorization or courier routine status.
- `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001` is therefore selected as the
  active WilliamOS-native R1 program.

## Identifier Reconciliation

`GOAL-WOS-009` is preserved as the completed Academy + Wiki reconciliation
identity used by the latest merged evidence. County Ops must not reuse that
identifier.

The canonical County Ops identity is:

`GOAL-COUNTY-001 - County Ops Knowledge Pack`

This preserves historical evidence and removes the goal-ID collision in older
playbook text.

## Completed Queue Reconciliation Work Orders

1. `WO-OPERATOR-QUEUE-001 - Current Truth Reconciliation`
2. `WO-OPERATOR-QUEUE-002 - Goal Registry Status Correction`
3. `WO-OPERATOR-QUEUE-003 - Loop Registry Status Correction`
4. `WO-OPERATOR-QUEUE-004 - Stale Recommendation and Identifier Reconciliation`
5. `WO-OPERATOR-QUEUE-005 - Next Eligible Program Decision and Evidence Rollup`

All five Work Orders completed through PR #336.

## Completed County Ops Program

`GOAL-COUNTY-001 - County Ops Knowledge Pack` completed through PR #337.

## Completed TerraFusion Preflight

`GOAL-TF-COMMAND-PREFLIGHT-001` completed `WO-TF-COMMAND-000A` through
`WO-TF-COMMAND-000F`. It established explicit provenance and staleness
semantics and approved only an R1 static/read-only first implementation slice.

Evidence:
`docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md`

## Completed TerraFusion Command Program

`GOAL-TF-COMMAND-001 - TerraFusion Project Command Layer` completed through
PR #339 at `05fcf18fba8a6a2be5fef7865e3a6842ae9bb747`.

Evidence:
`docs/reports/WO-TF-COMMAND-006-final-rollup.md`

## Canonical Closed Multi-Agent Program

`PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001` was selected under the recorded
owner direction that William is owner-only and the agents execute the complete
program without routine owner contact. Its goal is
`GOAL-WOS-MULTI-AGENT-OPERATOR-001`; its loop is
`LOOP-WOS-MULTI-AGENT-OPERATOR-001`.

WO-MAO-001 through WO-MAO-058 completed. WO-MAO-059 closed as
`COMPLETE_EVIDENCE_BACKED_REJECTION`: PR #414 satisfied the ten-useful-Work-Order
gate, but no durable process continued between sessions for the required 24-hour
unattended interval. WO-MAO-060 completed the zero-owner-touch audit,
WO-MAO-061 rejected unattended certification, and WO-MAO-062 closed the program.

The rejected nested local runtime remains terminal and disabled. Durable provider
dispatch and unattended background operation remain unproven and are not implied
by the current hosted-session continuation work.

## Completed WOE Detail Surfaces Program

`PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001` was explicitly activated and
completed as a WilliamOS-native read-only R0/R1 lane:

1. `WO-WILLIAMOS-WOE-DETAIL-SURFACES-001 - Evidence Reconciliation`
2. `WO-WILLIAMOS-WOE-DETAIL-SURFACES-002 - Bounded First Slice`
3. `WO-WILLIAMOS-WOE-DETAIL-SURFACES-003 - Safety and Rollup`
4. `WO-WILLIAMOS-WOE-DETAIL-SURFACES-004 - Review Remediation`

PRs #418, #419, and #420 are merged. The completed lane remains closed evidence
and is not reopened by the active continuation program.

## Active Owner Outcome Delivery Program

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Active Work Order: `WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation`

Ordered Work Orders:

1. `WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation`
2. `WO-OWNER-OUTCOME-002 - Owner Outcome Intake Contract`
3. `WO-OWNER-OUTCOME-003 - Rolling WilliamOS-Native Backlog`
4. `WO-OWNER-OUTCOME-004 - No-Idle Resolver Invariant`
5. `WO-OWNER-OUTCOME-005 - Useful WilliamOS Feature Delivery Proof`
6. `WO-OWNER-OUTCOME-006 - Safety and Continuation Rollup`

The active program converts plain-language owner outcomes into bounded program,
goal, loop, and Work Order packets. It must deliver at least one real WilliamOS
feature; governance-only closure is insufficient.

The controlling invariant is:

```text
DO_NOT_RETURN_TO_NO_ACTIVE_PROGRAM_WHILE_APPROVED_USEFUL_WILLIAMOS_R0_R1_WORK_REMAINS
```

## Selection Rule

Selection remains deterministic: completed, blocked, deferred, superseded,
dependency-blocked, and owner-gated programs are filtered out; remaining
programs are ranked by operational and engineering value, dependency readiness,
risk, evidence readiness, reversibility, and bounded scope.

Static backlog exhaustion is not a legitimate owner decision when a recorded
owner outcome remains incomplete and useful bounded WilliamOS-native work is
available. The active owner-outcome program owns generating the successor chain.

## Completed County Ops Work-Order Sequence

1. `WO-COUNTY-001 - County Ops Knowledge Map`
2. `WO-COUNTY-002 - PACS Read-Only Rules Page`
3. `WO-COUNTY-003 - Levy Workflow Page`
4. `WO-COUNTY-004 - BOE Evidence Page`
5. `WO-COUNTY-005 - Permit Import Knowledge Page`
6. `WO-COUNTY-006 - Public Data Redaction Policy`
7. `WO-COUNTY-007 - Ratio Study Knowledge Page`
8. `WO-COUNTY-008 - Appeals Packet Playbook`
9. `WO-COUNTY-009 - Academy/Wiki and Navigation Cross-Links`
10. `WO-COUNTY-010 - Safety, Validation, and Final Rollup`

## County Ops Standing Boundaries

Allowed:

- generic doctrine and workflow documentation;
- static/read-only registry records and surfaces;
- tests for static/read-only content;
- public statutes, standards, and already-approved non-sensitive concepts;
- cross-links to Work Orders, Evidence, Academy, Wiki, and Authority.

Blocked:

- PACS connectivity, queries, credentials, exports, or writes;
- parcel, taxpayer, owner, appeal, exemption, permit, or assessment records;
- county network, server, VPN, database, file share, or production access;
- TerraFusion integration or mutation;
- secrets, connection strings, screenshots containing protected data, or copied
  production logs;
- DB/schema/env/package changes;
- auth/access behavior;
- dynamic ingestion, memory write/retrieval runtime, RAG, embeddings, or vector
  storage;
- command runner, background worker, scheduler, Hermes/MCP/skill activation,
  autonomy, deployment, release, or tag.

Any need for real county data or system access becomes a typed authority wall.

## Continuation Rule

Codex owns routine implementation, branch and PR lifecycle, focused and full
validation, review remediation, eligible merge, merged-main verification,
evidence, and successor release inside the active R1 authority.

William is contacted only for a genuinely new authority boundary, protected
external project selection, spending, secrets, production/destructive action, or
the final owner outcome. He is not asked to repeat activation words, run commands,
relay logs, diagnose providers, monitor checks, merge PRs, or select routine
successor work.

## Validation

Required for this R1 program:

- focused portfolio, queue, goal, loop, and surface tests;
- changed-file scope inspection;
- secret and forbidden-path scan on changed files;
- `git diff --check`;
- lint;
- full test suite;
- build;
- pull-request checks;
- zero unresolved substantive review threads;
- merged `origin/main` verification.

## Safety

```text
RUNTIME_ACTIVATED: false
COMMAND_RUNNER_ADDED: false
BACKGROUND_WORKER_ADDED: false
AUTH_CHANGED: false
DB_SCHEMA_DATA_CHANGED: false
ENV_PACKAGE_CHANGED: false
PRODUCTION_WRITE_ADDED: false
HERMES_MCP_SKILL_ACTIVATED: false
MEMORY_RUNTIME_CHANGED: false
DYNAMIC_INGESTION_ADDED: false
PROPERTY_WORKBENCH_SELECTED: false
TERRAPILOT_SELECTED: false
TERRAFUSION_PACS_COUNTY_TOUCHED: false
PAID_OVERAGE_AUTHORIZED: false
REJECTED_ISSUE_357_RETRIED: false
SECRETS_EXPOSED: false
OWNER_OPERATION_REQUIRED: false
```
