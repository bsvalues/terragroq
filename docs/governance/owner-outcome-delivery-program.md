# Owner Outcome Delivery Program

Program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`

Status: `SELECTED / STANDING`

Risk ceiling: `R1`

Authority mode: `OWNER_AUTHORIZED_STANDING_R0_R1`

## Owner Authorization

The owner authorizes this program, goal, and loop as the standing delivery lane
for bounded WilliamOS-native owner outcomes. The authorization covers routine,
reversible R0/R1 repository work through the normal hosted Codex branch, test,
pull-request, review-remediation, eligible-merge, verification, and evidence
lifecycle.

The authorization does not make a persisted goal self-executing, expand a Work
Order, waive dependency or reservation gates, or grant protected, production,
financial, credential, runtime, or external-system authority.

## Mission

Turn approved owner outcomes into completed WilliamOS-native results without
making William the operator or returning to an empty queue while useful work is
already approved. Keep intake durable through the existing `/goal` path and keep
execution bounded by explicit Work Orders and recorded authority.

## Persistence Reuse

The existing `/goal` flow already classifies and persists owner intent. This
program reuses that persistence as rolling owner-outcome intake. It does not add
a database, table, schema migration, storage service, runtime, command runner,
scheduler, or background worker.

Persistence and authority remain distinct:

- a persisted goal records intent, classification, risk, and lifecycle state;
- an approved bounded Work Order records executable scope and validation;
- standing authority may activate only matching R0/R1 WilliamOS-native work;
- unmatched, expanded, or protected work stops at a typed authority wall.

## Delivery Model

Supported hosted Codex sessions perform the GitHub lifecycle. They reconcile
live repository state, implement reserved work, validate it, create and maintain
branches and pull requests, remediate review findings, merge when authorized and
eligible, verify the result, and preserve evidence.

This delivery model is session-hosted. It is not a durable WilliamOS provider
runtime, an unattended scheduler, or a background worker. The rejected nested
local adapter evidenced by issue #357 remains terminal, quarantined, disabled,
and ineligible for reuse.

## Work Orders

1. `WO-OWNER-OUTCOME-001 - Program Activation and Authority Record` (`COMPLETE`)
2. `WO-OWNER-OUTCOME-002 - Owner Outcome Contract` (`COMPLETE`)
3. `WO-OWNER-OUTCOME-003 - Primary Outcome Intake Integration` (`COMPLETE`)
4. `WO-OWNER-OUTCOME-004 - Generated Program, Goal, Loop, and Work Order Model` (`COMPLETE`)
5. `WO-OWNER-OUTCOME-005 - Rolling Queue and No-Dead-End Invariant` (`COMPLETE`)
6. `WO-OWNER-OUTCOME-006 - Durable Session Handoff Evidence` (`COMPLETE`)
7. `WO-OWNER-OUTCOME-007 - Real WilliamOS Feature Delivery Proof` (`READY`)
8. `WO-OWNER-OUTCOME-008 - Safety, Validation, and Program Rollup` (`PENDING`)
9. `WO-OWNER-OUTCOME-009 - Rolling Owner Outcome Intake` (`PENDING`)

Work Orders 001-006 establish the bounded implementation candidate. Work Order
007 remains ready until review, merge, and merged-main verification prove the
real feature. Only then may a follow-up evidence PR complete WO-008 and release
WO-009 as the standing intake node.

## Activation Rules

A persisted owner outcome may activate when all of the following are true:

- the outcome is explicitly approved or already covered by standing authority;
- the risk is R0 or R1;
- the work is WilliamOS-native, reversible, and repository-bounded;
- dependencies are complete and reservations do not collide;
- required validation and evidence are named;
- no blocked boundary is implicated.

The hosted coordinator records the exact Work Order before consequential work.
It cannot infer protected authority from the standing program or from a goal row.

## Hard Invariant

`NO_ACTIVE_PROGRAM` is forbidden while an approved owner outcome has unfinished
useful work. The program remains `SELECTED`, activates the next eligible bounded
outcome, or records a typed authority wall. Completed feature delivery does not
empty the queue while `WO-OWNER-OUTCOME-009` is ready to receive covered work.

## Boundaries

Allowed:

- approved R0/R1 WilliamOS-native product, documentation, test, and governance
  work inside exact Work Order reservations;
- existing `/goal` classification and persistence;
- supported hosted Codex session coordination;
- normal Git and GitHub delivery lifecycle under recorded authority;
- merged-main verification and repository evidence capture.

Blocked:

- Property Workbench;
- TerraPilot;
- county programs, county data, or county systems;
- PACS access, queries, exports, credentials, or writes;
- production mutation, deployment, release, cutover, or protected-data access;
- secrets or credentials;
- paid overages, new spending, contracts, accounts, or provider grants;
- database, schema, runtime, command runner, scheduler, or background-worker
  creation or activation;
- local WilliamOS runtime or supervisor activation;
- issue #357 retry, reactivation, wrapping, renaming, or reuse.

## Continuation

After each completed outcome, the loop checks persisted approved intake and
activates the next dependency-cleared outcome covered by standing authority.
Routine GitHub lifecycle and recoverable failures stay with hosted Codex
sessions. A new owner decision is required only for genuinely new authority,
not for routine implementation, diagnostics, provider repair, Git operations,
review remediation, or status relay.

Canonical evidence:
`docs/reports/WO-OWNER-OUTCOME-008-owner-outcome-delivery-rollup.md`
