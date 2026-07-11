# WilliamOS Goal Registry

Work order: `WO-OPERATOR-QUEUE-002`
Goal: `GOAL-WOS-ACTIVE-PROGRAM-QUEUE-001 - Active Program Queue Reconciliation`
Type: Governance / Registry
Risk: Low, documentation only

## Purpose

This registry records the current WilliamOS goal sequence so Codex can operate
authorized `/goal` and `/loop` work without making William act as the courier.

The registry is not an execution engine. It does not mutate runtime state,
databases, credentials, production, authority, or user access. It is a durable
governance reference for the Codex Operator playbook.

## Registry Rules

- Goals define governed intent.
- Goals do not grant unrestricted execution.
- Each goal must name allowed work, blocked work, validation, evidence, and the
  first loop.
- Codex may continue only through work already authorized by the active goal and
  loop.
- Owner gates override registry sequence.
- Any scope-expanding change requires a new owner-authorized packet.

## Canonical Completed Operator Goal

### `GOAL-WOS-CODEX-OPERATOR-001 - WilliamOS Codex Operator System`

Document: `WILLIAMOS-CODEX-OPERATOR-PLAYBOOK-001`

Loop: `LOOP-WOS-CODEX-OPERATOR-001`

Risk ceiling: `R1`

Merge policy: Codex-eligible for registered R0/R1 work after all gates pass

Production policy: read-only verification only

Purpose: make Codex the Work Order Operator for the complete eligible chain
while the Primary retains authority over auth, secrets, schemas, production,
external systems, runtime activation, destructive operations, and scope/risk
expansion.

Completion state: `WO-CODEX-OPERATOR-001` through
`WO-CODEX-OPERATOR-024` are evidenced complete. The low-risk pilot merged as
PR #333 at `9e3a48395945d7b26449cf2e462bc65142aa136c`.

The typed source of truth is
`components/operator/codex-operator-registry.ts`. The registry is static and
does not execute, schedule, ingest, persist, approve, or mutate work.

## Canonical Active Goal

### `GOAL-WOS-ACTIVE-PROGRAM-QUEUE-001 - Active Program Queue Reconciliation`

Program: `PROGRAM-WILLIAMOS-ACTIVE-QUEUE-001`

Loop: `LOOP-WOS-ACTIVE-PROGRAM-QUEUE-001`

Risk ceiling: `R0`

Purpose: reconcile completed goals, stale next-lane recommendations, and reused
goal identifiers so Codex has one truthful next eligible program.

Work Orders:

1. `WO-OPERATOR-QUEUE-001 - Current Truth Reconciliation`
2. `WO-OPERATOR-QUEUE-002 - Goal Registry Status Correction`
3. `WO-OPERATOR-QUEUE-003 - Loop Registry Status Correction`
4. `WO-OPERATOR-QUEUE-004 - Stale Recommendation and Identifier Reconciliation`
5. `WO-OPERATOR-QUEUE-005 - Next Eligible Program Decision and Evidence Rollup`

Canonical queue:
`docs/governance/active-program-queue.md`

Next on verified completion:
`GOAL-COUNTY-001 - County Ops Knowledge Pack`.

County Ops uses `GOAL-COUNTY-001`; it must not reuse `GOAL-WOS-009`, which is
preserved as the completed Academy + Wiki reconciliation identity.

### Closed Goal Preservation Register

- `GOAL-WOS-004 - Brain Memory Spine`: closed and preserved at PRs #329,
  #330, and #332; it is not reopened by this adoption.
- `GOAL-WOS-007 - Agent Forge Skill Governance`: closed and preserved at PR
  #331; its static/read-only boundary remains unchanged.
- Earlier shell, Work Order Engine, Academy/Wiki, Hermes boundary, Brain
  Council, Trace/Eval, Evidence, Authority, and Owner Decision goals retain
  their existing evidence and closed state.

## Historical Operator Goal

### `GOAL-OPS-001 - Codex Operator Mode`

System: WilliamOS Work Order Governance / Codex Operations

Purpose: make Codex the active operator of the WilliamOS `/goal` and `/loop`
system so William no longer has to carry routine repo operations between tools.

Success state:

- durable Codex Operator playbook exists
- goal registry exists
- loop registry exists
- standard result classifier exists
- review-thread protocol exists
- merge gate checklist exists
- production verification checklist exists
- owner decision packet template exists
- operator continuation rule exists

Owner authority:

- Codex may implement docs/governance/report-only changes.
- Codex may open PRs.
- Codex may monitor checks and review threads.
- Codex may remediate narrow docs-only review feedback.
- Codex may merge when checks are green, review threads are resolved, scope
  remains docs-only, and no runtime/product behavior changes occur.

Blocked:

- no runtime code changes
- no auth behavior or policy changes
- no public account-creation restoration
- no DB, schema, data, env, package, or Vercel changes
- no deploy, release, or tag beyond normal PR merge
- no production-write behavior
- no Hermes, MCP, autonomy, or worker activation
- no secrets

First loop:

`WO-OPS-001 - Codex Operator Doctrine / No-Go-Between Playbook`

Current loop:

`WO-OPS-008 - Operator Continuation Rule / Stop-Only-On-Gate Policy`

## Authorized Goal Sequence

1. `GOAL-OPS-001 - Codex Operator Mode`
2. `GOAL-WOS-001 - Primary Shell Completion`
3. `GOAL-WOE-001 - Make /goal and /loop Native`
4. `GOAL-COUNCIL-001 - Brain Council Advisory Layer`
5. `GOAL-MEMORY-001 - Brain Memory Spine`
6. `GOAL-TRACE-001 - Trace Ledger + Failure-to-Eval`
7. `GOAL-ACADEMY-001 - Academy + Wiki`
8. `GOAL-WOS-007 - Agent Forge Skill Governance`
9. `GOAL-HERMES-001 - Hermes Sidecar Boundary`
10. `GOAL-COUNTY-001 - County Ops Knowledge Pack`
11. `GOAL-TF-COMMAND-001 - TerraFusion Project Command Layer`

## Goal Summaries

### `GOAL-WOS-001 - Primary Shell Completion`

Purpose: finish the WilliamOS Primary Operator shell so the system feels
unified, personal, calm, private, and governed.

First loop: `WO-SHELL-004 - Primary Navigation Shell`

Blocked until: `GOAL-OPS-001` completes or William explicitly overrides.

### `GOAL-WOE-001 - Make /goal and /loop Native`

Purpose: make the Work Order Engine visible and native inside WilliamOS.

First loop: `WO-WOE-008 - Evidence Rollup`

Blocked until: Primary shell work reaches the authorized handoff point.

### `GOAL-COUNCIL-001 - Brain Council Advisory Layer`

Purpose: make Brain Council an advisory reasoning layer that prepares decisions
and work orders without executing them.

First loop: `WO-COUNCIL-001 - Brain Council Doctrine Page`

Blocked: autonomous execution.

### `GOAL-MEMORY-001 - Brain Memory Spine`

Purpose: create governed memory records for decisions, procedures,
contradictions, stale items, sensitivity, and review.

First loop: `WO-MEMORY-001 - Brain Memory Directory + Schema`

Blocked: unscoped memory writes or secret storage.

### `GOAL-TRACE-001 - Trace Ledger + Failure-to-Eval`

Purpose: record reasoning and failures so WilliamOS can turn failures into eval
proposals without granting autonomy.

First loop: `WO-TRACE-001 - Trace Ledger Schema`

Blocked: autonomous evaluation execution.

### `GOAL-ACADEMY-001 - Academy + Wiki`

Purpose: make WilliamOS teachable and self-documenting.

First loop: `WO-ACADEMY-001 - Academy/Wiki Directory Map`

Blocked: product behavior changes unless separately scoped.

### `GOAL-WOS-007 - Agent Forge Skill Governance`

Purpose: prepare and review skills safely before any worker can use them.

First loop: `WO-FORGE-001 - Agent Forge Doctrine Page`

Blocked: skill activation or execution.

### `GOAL-HERMES-001 - Hermes Sidecar Boundary`

Purpose: define Hermes as a governed worker sidecar boundary.

First loop: `WO-HERMES-001 - Hermes Doctrine Page`

Blocked: live Hermes activation, autonomous work, or command execution.

### `GOAL-COUNTY-001 - County Ops Knowledge Pack`

Purpose: organize county operations knowledge without touching production county
systems.

First loop: `WO-COUNTY-001 - County Ops Knowledge Map`

Blocked: production county-system integration.

### `GOAL-TF-COMMAND-001 - TerraFusion Project Command Layer`

Purpose: represent TerraFusion OS as a governed project under WilliamOS command.

First loop: `WO-TF-COMMAND-001 - TerraFusion Project Card`

Blocked: TerraFusion production mutation unless separately authorized.

## Registry Maintenance

Update this registry when William authorizes a new goal, changes execution
order, closes a goal, or explicitly pauses a lane.
