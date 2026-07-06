# WilliamOS Loop Registry

Work order: `WO-OPS-002`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / Registry
Risk: Low, documentation only

## Purpose

This registry records the current authorized loop order for WilliamOS. It gives
Codex a durable sequence to follow after each completed work order, while
preserving owner gates and safety blocks.

The registry is not an automation runtime. It does not schedule background
work, execute commands, mutate memory, or activate workers.

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
- `WO-OPS-003`: active.

## Next Product Loop Order

After `GOAL-OPS-001`, Codex moves to `GOAL-WOS-001` unless William overrides.

1. `WO-SHELL-004 - Primary Navigation Shell`
2. `WO-SHELL-005 - Work Orders Surface`
3. `WO-SHELL-006 - Evidence Surface`
4. `WO-SHELL-007 - Systems Status Surface`
5. `WO-SHELL-008 - Authority / Governance Surface`
6. `WO-SHELL-009 - Memory Surface Placeholder`
7. `WO-SHELL-010 - Shell Polish + Production Verification`

Then Codex moves to `GOAL-WOE-001` unless William overrides.

1. `WO-WOE-008 - Evidence Rollup`
2. `WO-WOE-009 - Goal Detail Surface`
3. `WO-WOE-010 - Loop Detail Surface`
4. `WO-WOE-011 - Active Work Queue`
5. `WO-WOE-012 - Blocked Decision Queue`

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
