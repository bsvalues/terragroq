# WilliamOS Goal Registry

Work order: `WO-OWNER-OUTCOME-001 through WO-OWNER-OUTCOME-009`
Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001 (active; R1 WilliamOS-native continuation)`
Type: Governance / Registry / Owner Outcome Delivery
Risk: `R1`

## Purpose

This registry records the current WilliamOS goal sequence so Codex can operate
authorized `/goal` and `/loop` work without making William act as the courier.

The registry is not an execution engine. It does not mutate runtime state,
databases, credentials, production, authority, or user access. It is a durable
governance reference for the Codex Operator playbook and portfolio resolver.

## Registry Rules

- Goals define governed intent.
- Goals do not grant unrestricted execution.
- Each goal must name allowed work, blocked work, validation, evidence, and the
  first loop.
- Codex may continue only through work authorized by the active goal, loop, or a
  recorded standing owner direction that explicitly covers the bounded scope.
- Plain-language owner direction is sufficient; no magic authorization keyword is
  required when the bounded outcome is already clear.
- Owner gates override registry sequence.
- Any protected scope expansion requires a concise new owner-decision packet.

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

## Canonical Completed Queue Reconciliation Goal

### `GOAL-WOS-ACTIVE-PROGRAM-QUEUE-001 - Active Program Queue Reconciliation`

Completed through PR #336 at
`123b95eed0a0017f2b4fda7b21df7cc471297c2d`.

The reconciliation closed stale active labels, superseded historical next-work
lists, preserved `GOAL-WOS-009` for Academy/Wiki evidence, and selected the
collision-free County Ops identity.

## Canonical Completed County Ops Goal

### `GOAL-COUNTY-001 - County Ops Knowledge Pack`

Program: `PROGRAM-WILLIAMOS-COUNTY-OPS-001`

Loop: `LOOP-WILLIAMOS-COUNTY-OPS-001`

Completion state: `WO-COUNTY-001` through `WO-COUNTY-010` completed
through PR #337 at `49fa4ffe7917bdc0440950ed7a1fb47cd2c0a837`.
The result is a static/read-only Washington county-assessor knowledge pack;
its PACS, county-data, legal-decision, runtime, and production boundaries remain
in force.

Canonical evidence:
`docs/reports/WO-COUNTY-010-county-ops-final-rollup.md`

## Canonical Completed TerraFusion Preflight Goal

### `GOAL-TF-COMMAND-PREFLIGHT-001 - TerraFusion Command Layer Preflight`

Program: `PROGRAM-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

Loop: `LOOP-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

Completion state: `WO-TF-COMMAND-000A` through
`WO-TF-COMMAND-000F` completed as an R0 repository-local preflight.

Canonical evidence:
`docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md`

Decision: the first implementation slice may proceed as R1 static/read-only
records with explicit provenance and staleness. External or live integration
remains owner-gated.

## Canonical Completed TerraFusion Command Goal

### `GOAL-TF-COMMAND-001 - TerraFusion Project Command Layer`

Program: `PROGRAM-WILLIAMOS-TF-COMMAND-001`

Loop: `LOOP-WILLIAMOS-TF-COMMAND-001`

Risk ceiling: `R1`

Purpose: represent TerraFusion OS as a governed project under WilliamOS command
using repository-local, explicitly sourced static records that cannot be
mistaken for live deployment or runtime state.

Work Orders:

1. `WO-TF-COMMAND-001 - TerraFusion Project Card`
2. `WO-TF-COMMAND-002 - TerraFusion Work Order Feed`
3. `WO-TF-COMMAND-003 - TerraFusion Evidence Feed`
4. `WO-TF-COMMAND-004 - TerraFusion Blocker Queue`
5. `WO-TF-COMMAND-005 - TerraFusion Deployment Status Read Model`
6. `WO-TF-COMMAND-006 - TerraFusion Next Move Recommendation`

Required semantics: each record is declared, observed, stale, unknown, or
blocked; observed claims require dated proof; historical evidence never becomes
current truth implicitly.

Completion state: `WO-TF-COMMAND-001` through `WO-TF-COMMAND-006` merged
through PR #339 at `05fcf18fba8a6a2be5fef7865e3a6842ae9bb747`.

Canonical evidence:
`docs/reports/WO-TF-COMMAND-006-final-rollup.md`

Standing blocked scope: external repository access, dynamic ingestion,
deployment inspection, credentials, county/PACS access, runtime activation,
persistence, command execution, and any production mutation.

## Closed Multi-Agent Operator Goal

### `GOAL-WOS-MULTI-AGENT-OPERATOR-001 - WilliamOS Multi-Agent Operator`

Status: `CLOSED / WO-MAO-059 THROUGH WO-MAO-062 COMPLETE / UNATTENDED CERTIFICATION REJECTED`

Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Risk model: Phase 0 truth/registry integration and Phase 1 provider proof are
`R1`; machine-control-plane Phases 2-6 may reach `R3`; Phase 7 certification is
`R2`. Useful product delivery remains limited to authorized `R0` and `R1` work.

Purpose: make WilliamOS select dependency-cleared work, reserve non-overlapping
scope, dispatch multiple builders and independent assurance, own the complete
GitHub lifecycle, and continue without making William an agent or operator.

Canonical playbook:
`docs/governance/multi-agent-operator-playbook.md`

Work Orders: `WO-MAO-001` through `WO-MAO-062`. Dependencies and reservations,
not numeric serialization, determine the eligible set. The executable registry
is `components/operator/multi-agent-operator-registry.ts`.

WO-MAO-001 through WO-MAO-058 are complete. WO-MAO-059 is complete as an
evidence-backed rejection because PR #414 satisfied the ten-useful-Work-Order
gate but no durable unattended process continued between sessions for the
required 24-hour interval. WO-MAO-060 completed the zero-owner-touch audit,
WO-MAO-061 rejected unattended multi-agent certification, and WO-MAO-062 closed
the program into portfolio continuation.

`WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable. Claude
remains unavailable and disabled. Durable provider dispatch and sustained
unattended builder certification remain unproven.

Communication contract: routine implementation, diagnosis, retry, review,
merge, verification, cleanup, and continuation remain agent-owned. William is
contacted only for a genuinely new authority decision or the final program
outcome. `OWNER_ROUTINE_CONTACT_COUNT` and all owner-operation counters must be
zero for certification.

The separate local-identity runtime goal is terminal historical evidence.
Issue #357 is `FAILED_TERMINAL` with reason `CODEX_NETWORK_WALL`; it will not be
retried. Issue #358 is `BLOCKED_DEPENDENCY`. The supervisor and runtime remain
disabled and are not prerequisites for supported hosted agent execution.

### `GOAL-PORTFOLIO-OPERATOR-001 - Continuous Program and Goal Selection`

Status: `complete / standing continuation contract`

Loop: `LOOP-PORTFOLIO-OPERATOR-001`

Evidence: `docs/reports/WO-PORTFOLIO-001-010-portfolio-operator-evidence.md`

The standing portfolio resolver selects the highest-priority approved,
dependency-cleared program without returning routine planning to the Primary.

### `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001 - Owner Outcome Delivery`

Status: `ACTIVE / DELIVERY CANDIDATE / WO-OWNER-OUTCOME-007 READY`

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Risk ceiling: `R1`

Owner authorization: recorded for the program, goal, and loop as a standing
WilliamOS-native R0/R1 owner-outcome delivery lane.

Purpose: accept owner outcomes through the existing `/goal` classification and
persistence path, convert only authority-matched outcomes into bounded Work
Orders, and deliver useful repository outcomes without making William the Git,
GitHub, test, diagnostic, or status operator.

Work Orders `WO-OWNER-OUTCOME-001` through `WO-OWNER-OUTCOME-006` are complete.
`WO-OWNER-OUTCOME-007 - Real WilliamOS Feature Delivery Proof` is `READY`;
WOs 008 and 009 remain pending until review, merge, and merged-main verification
make their claims true.

Existing `/goal` persistence is reused. A persisted goal is governed intent,
not execution authority, and the existing Work Order and authority gates still
apply. This goal adds no database, schema, runtime, command runner, scheduler,
or background worker.

Supported hosted Codex sessions perform branch, commit, push, pull-request,
review-remediation, eligible-merge, and verification work. This is not a claim
that WilliamOS has a durable provider runtime or unattended background worker.

Allowed: approved, reversible R0/R1 WilliamOS-native owner outcomes whose exact
repository scope and actions are covered by standing authority.

Blocked: Property Workbench, TerraPilot, county work, PACS, production actions,
secrets, paid overages, runtime activation, and any retry, reactivation, or
reuse of issue #357.

Invariant: the registry must not report `NO_ACTIVE_PROGRAM` while an approved
owner outcome has unfinished useful work. The active goal remains selected
until the outcome completes or reaches a typed authority wall.

Canonical program:
`docs/governance/owner-outcome-delivery-program.md`

Evidence:
`docs/reports/WO-OWNER-OUTCOME-001-owner-outcome-delivery-rollup.md`

### `NO_ACTIVE_GOAL - Inactive Sentinel Only`

Status: `inactive sentinel / not current`

Program: `NO_ACTIVE_PROGRAM`

Loop: `NO_ACTIVE_LOOP`

Active Work Order: `none`

This sentinel is valid only when no approved executable program and no approved
owner outcome with unfinished useful work exists. It is not the current goal.
Property Workbench, TerraPilot, county work, PACS, production, secrets, paid
overages, runtime activation, and issue #357 remain blocked rather than becoming
fallback work.

### `GOAL-WOE-DETAIL-SURFACES-001 - Work Order Engine Detail Surfaces`

Status: `complete / closed evidence`

Loop: `LOOP-WOE-DETAIL-SURFACES-001`

Active Work Order: `none`

The owner-authorized activation packet selected this WilliamOS-native lane after
PR #417. Codex completed the bounded Work Orders as read-only/detail-surface
work through PRs #418-#420. The lane remains closed evidence and is not the
active continuation target.

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

- Codex may implement bounded authorized repository changes.
- Codex may open PRs.
- Codex may monitor checks and review threads.
- Codex may remediate in-scope review feedback.
- Codex may merge when the active authority and all merge gates allow it.

Blocked:

- no unauthorized runtime code or activation
- no auth behavior or policy changes without authority
- no public account-creation restoration
- no DB, schema, data, env, or package changes without authority
- no deployment or production-write behavior without authority
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
12. `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001 - Owner Outcome Delivery`

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

### `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001 - Owner Outcome Delivery`

Purpose: prevent bounded useful WilliamOS-native work from stopping merely
because a finite static seed list was exhausted.

First loop: `WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation`

Blocked: protected external projects, production, secrets, spending, runtime
activation, destructive operations, and R2+ expansion without a new decision.

## Registry Maintenance

Every active goal records the five owner-operation/contact counters when evidence
exists, an independent evidence reference when available, and one current
lifecycle state: `NO_OWNER_OPERATION_EVIDENCE`,
`UNVERIFIED_ZERO_OWNER_OPERATIONS`, `CERTIFIED_ZERO_OWNER_OPERATIONS`, or
`FAILED_OWNER_BABYSITTING`.

`CERTIFIED_ZERO_OWNER_OPERATIONS` requires independent context-bound evidence,
complete checkpoint/source-log chains, and current trusted-host anchors.
Caller-supplied zeros cannot certify a goal. Genuine consequential owner
authority decisions are excluded from routine-operation counts; owner courier,
credential, diagnostic, routine implementation, and progress-contact actions
are counted and disqualify certification with reason `FAIL_OWNER_BABYSITTING`.

Update this registry when William gives a new consequential direction, changes
protected authority, closes an outcome, or explicitly pauses a lane. Routine
bounded successor generation inside the active owner outcome does not require a
new activation ritual.
