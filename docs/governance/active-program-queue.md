# WilliamOS Active Program Queue

Document: `WILLIAMOS-ACTIVE-PROGRAM-QUEUE-001`

Queue program: `PROGRAM-WILLIAMOS-ACTIVE-QUEUE-001`

Active program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001 - WilliamOS Multi-Agent Operator`

Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`

Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`

Merged scheduler baseline: `origin/main = 6239cd90` after WO-MAO-023 PR #369

Risk ceiling: `R3` for control-plane implementation; useful delivery pilots remain `R0/R1`

Status: owner-authorized multi-agent program active; rejected local runtime terminal and disabled

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
- PRs #333 through #339 are merged.
- Queue reconciliation completed through PR #336.
- County Ops completed through PR #337 at
  `49fa4ffe7917bdc0440950ed7a1fb47cd2c0a837`.
- At the recorded baseline, before this reconciliation branch and PR were
  created, no open pull request or issue was found.
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

All five Work Orders completed through PR #336. The queue now advances to the
County Ops program.

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

## Canonical Active Program

`PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001` is selected under the recorded
owner direction that William is owner-only and the agents execute the complete
program without routine owner contact. Its goal is
`GOAL-WOS-MULTI-AGENT-OPERATOR-001`; its loop is
`LOOP-WOS-MULTI-AGENT-OPERATOR-001`. Phase 0 and the bounded hosted-team proof
through `WO-MAO-015` are complete. Phase 2 Work Orders `WO-MAO-016` through `WO-MAO-022`, the
WO-MAO-023 eligible-set scheduler, the WO-MAO-024 team-topology contract, the bounded WO-MAO-025
isolated-workspace manager, the WO-MAO-026 reservation-aware handoff contract, the WO-MAO-027 durable
concurrency/fairness scheduler extension, the WO-MAO-028 pure deterministic scheduler model-check
harness, provider conformance `WO-MAO-029`, the post-merge-hardened current-session coordinator
adapter `WO-MAO-030`, re-proved role adapters `WO-MAO-031`, provider assessment `WO-MAO-032`,
provider health/reroute `WO-MAO-035`, provider conformance `WO-MAO-036`, branch/commit/push
automation `WO-MAO-037`, PR creation/packet linkage `WO-MAO-038`, CI/review ingestion
`WO-MAO-039`, remediation/re-review `WO-MAO-040`, and bounded merge-controller `WO-MAO-041` are
complete.
`WO-MAO-033` is `DEFERRED / PROVIDER_UNAVAILABLE` and resumable; the exact canonical settlement is
verified and independently assured `WO-MAO-034` is `COMPLETE`.
The separately ratified graph correction removes only the redundant direct WO-MAO-033 edges from
WO-MAO-035/036. WO-MAO-035 through WO-MAO-054 are now `COMPLETE`; WO-MAO-055 is
`READY`, and the selected MAO loop resumes at WO-MAO-055 without owner contact.
The program
grant is limited to repository-scoped, reversible work and
does not authorize runtime activation, credentials, secrets, production writes,
deployment, protected data, or destructive operations.

Phase 2 and the first Phase 3 slices prove local envelope, DAG, atomic reservation,
provider-eligibility, lifecycle, lease, checkpoint, evidence-ledger, owner-meter, recoverable
eligible-set scheduling, deterministic team-topology, lease/evidence-bound isolated-workspace lifecycle,
one-writer handoff, hard-ceiling priority/fairness admission planning, and hardened current-session
coordinator assignment translation, role lifecycle proof, and zero-input canonical routing/review
proof. Provider health/reroute and provider conformance are re-proved through zero-input canonical
registries with no executable-worker certification. Branch/commit/push automation is proven as a
zero-input lifecycle plan with no command execution by the model.
The deferred WO-MAO-033 edge into WO-MAO-034 is settled by the exact,
independently verified `WO-MAO-034<-WO-MAO-033` record bound to completed WO-MAO-032, the canonical
consumer envelope, and the immutable source-assessment hash. The
redundant direct WO-MAO-033 dependencies on WO-MAO-035/036 have been removed by the narrow ratified
graph correction; every retained dependency remains fail-closed. Durable
provider dispatch and automated GitHub delivery remain unproven. The WO-MAO-028 harness proves only
pure/static model behavior; it performs no provider dispatch or runtime execution.

`PROGRAM-WILLIAMOS-LOCAL-IDENTITY-RUNTIME-001` is terminal and non-selectable.
Its rejected nested-Codex adapter cannot be retried or reused. Release
Engineering and other independent approved R0/R1 programs remain eligible for
parallel reservation-safe delivery; multi-agent control-plane work does not
monopolize the portfolio.

Selection is deterministic: completed, blocked, deferred, superseded,
dependency-blocked, and owner-gated programs are filtered out; remaining
programs are ranked by operational and engineering value, dependency
readiness, risk, evidence readiness, reversibility, and bounded scope.
Equal scores are resolved by stable ascending `programId` order.

Completed County Ops work-order sequence:

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

## Completed TerraFusion Preflight Work Orders

1. `WO-TF-COMMAND-000A - Existing WilliamOS TerraFusion Reference Inventory`
2. `WO-TF-COMMAND-000B - Project Identity and Provenance Contract`
3. `WO-TF-COMMAND-000C - Static Project Card and Feed Contracts`
4. `WO-TF-COMMAND-000D - Deployment and Staleness Semantics`
5. `WO-TF-COMMAND-000E - Authority and Safety Classification`
6. `WO-TF-COMMAND-000F - Implementation Decision and Evidence Rollup`

Canonical preflight:
`docs/governance/terrafusion-command-preflight.md`

## Completed TerraFusion Command Work Orders

1. `WO-TF-COMMAND-001 - TerraFusion Project Card`
2. `WO-TF-COMMAND-002 - TerraFusion Work Order Feed`
3. `WO-TF-COMMAND-003 - TerraFusion Evidence Feed`
4. `WO-TF-COMMAND-004 - TerraFusion Blocker Queue`
5. `WO-TF-COMMAND-005 - TerraFusion Deployment Status Read Model`
6. `WO-TF-COMMAND-006 - TerraFusion Next Move Recommendation`

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

Codex completed `WO-TF-COMMAND-001` through `WO-TF-COMMAND-006`, then invoked
the ratified portfolio resolver. A completed program routes to the next
approved executable program instead of returning routine planning to the
Primary. Owner involvement is required only when no approved executable
program remains or a typed authority wall is reached.

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
