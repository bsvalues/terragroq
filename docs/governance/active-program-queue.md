# WilliamOS Active Program Queue

Document: `WILLIAMOS-ACTIVE-PROGRAM-QUEUE-001`

Program: `PROGRAM-WILLIAMOS-ACTIVE-QUEUE-001`

Goal: `GOAL-WOS-ACTIVE-PROGRAM-QUEUE-001`

Loop: `LOOP-WOS-ACTIVE-PROGRAM-QUEUE-001`

Baseline: `origin/main = e5a396ce19c3c19fb2ef66c32b43aaee20f41cc9`

Risk ceiling: `R0`

Status: active reconciliation

## Purpose

Restore one truthful, deterministic next-program queue after the Codex Operator
adoption goal completed. This queue prevents Codex from stopping on stale
recommendations, completed goals marked active, or reused goal identifiers.

The queue is governance only. It does not execute commands, schedule work,
activate a worker, inspect a host, mutate production, or change authority.

## Current Truth

- `PROGRAM-WILLIAMOS-CODEX-OPERATOR-001` is complete.
- `GOAL-WOS-CODEX-OPERATOR-001` is complete.
- `LOOP-WOS-CODEX-OPERATOR-001` reached goal completion.
- `WO-CODEX-OPERATOR-001` through `024` are complete.
- PRs #333, #334, and #335 are merged.
- Canonical baseline is
  `e5a396ce19c3c19fb2ef66c32b43aaee20f41cc9`.
- No open pull request or issue was found during queue reconciliation.
- The Phase 2 dedicated Ubuntu host planning gates already completed through
  `WO-LOCAL-019` to `WO-LOCAL-024`.
- Dedicated-host implementation remains owner-gated because it would require
  host selection and may require OS, package, Docker, network, service,
  backup, or rollback actions.
- Historical recommendations pointing to completed Evidence, Authority,
  Council, Trace, Academy/Wiki, Hermes, Agent Forge, WOE polish, local-status
  refinement, or Ubuntu planning lanes are not active work.

## Identifier Reconciliation

`GOAL-WOS-009` is preserved as the completed Academy + Wiki reconciliation
identity used by the latest merged evidence. County Ops must not reuse that
identifier.

The canonical County Ops identity is:

`GOAL-COUNTY-001 - County Ops Knowledge Pack`

This preserves historical evidence and removes the goal-ID collision in older
playbook text.

## Active Reconciliation Work Orders

1. `WO-OPERATOR-QUEUE-001 - Current Truth Reconciliation`
2. `WO-OPERATOR-QUEUE-002 - Goal Registry Status Correction`
3. `WO-OPERATOR-QUEUE-003 - Loop Registry Status Correction`
4. `WO-OPERATOR-QUEUE-004 - Stale Recommendation and Identifier Reconciliation`
5. `WO-OPERATOR-QUEUE-005 - Next Eligible Program Decision and Evidence Rollup`

All five Work Orders are R0 documentation/governance work and may share one
coherent pull request. Codex owns branch, validation, PR, review remediation,
eligible merge, post-merge verification, and continuation.

## Deterministic Next Program

After this reconciliation merges and verifies, the next eligible program is:

`GOAL-COUNTY-001 - County Ops Knowledge Pack`

Why:

- it is the first incomplete goal in the authorized goal sequence;
- its first slice can remain static, read-only, and documentation/governance
  only;
- it can improve WilliamOS usefulness for the Primary without connecting to or
  mutating PACS, TerraFusion, county systems, databases, or production;
- the more consequential dedicated-host implementation lane remains correctly
  owner-gated.

Initial County Ops work-order sequence:

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
- secrets, connection strings, screenshots containing protected data, or
  copied production logs;
- DB/schema/env/package/Vercel changes;
- auth/access behavior;
- dynamic ingestion, memory write/retrieval runtime, RAG, embeddings, or vector
  storage;
- command runner, background worker, scheduler, Hermes/MCP/skill activation,
  autonomy, deployment, release, or tag.

Any need for real county data or system access becomes a typed authority wall.

## Continuation Rule

After the queue reconciliation PR is merged and verified, Codex starts
`GOAL-COUNTY-001` at `WO-COUNTY-001` without asking the Primary to relay
another packet. Codex stops only if the work requires a blocked capability,
sensitive source, material policy choice, or other true authority wall.

## Validation

Required for this R0 reconciliation:

- changed-file scope inspection;
- Markdown and identifier consistency inspection;
- secret and forbidden-path scan on changed files;
- `git diff --check` or equivalent patch whitespace verification;
- pull-request checks;
- zero unresolved substantive review threads;
- merged `origin/main` verification.

## Safety

```text
RUNTIME_CODE_CHANGED: false
COMMAND_EXECUTION_ADDED: false
BACKGROUND_WORKER_ADDED: false
AUTH_CHANGED: false
DB_SCHEMA_DATA_CHANGED: false
ENV_PACKAGE_VERCEL_CHANGED: false
PRODUCTION_WRITE_ADDED: false
HERMES_MCP_SKILL_ACTIVATED: false
MEMORY_RUNTIME_CHANGED: false
DYNAMIC_INGESTION_ADDED: false
TERRAFUSION_PACS_COUNTY_TOUCHED: false
SECRETS_EXPOSED: false
```
