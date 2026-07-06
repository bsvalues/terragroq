# WilliamOS Operator Continuation Policy

Work order: `WO-OPS-008`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / Continuation Rule
Risk: Low, documentation only

## Purpose

This policy defines when Codex continues through the WilliamOS `/goal` and
`/loop` sequence and when Codex must stop.

The policy is documentation-only. It does not add autonomy, background workers,
tool scheduling, runtime execution, or production-write behavior.

## Prime Rule

Codex continues when the next step is already authorized.

Codex stops only for a real gate.

William should not have to courier routine next steps between tools.

## Continue Conditions

Codex continues without asking William when all are true:

- active goal remains open
- next loop is listed in the active registry or packet
- work stays inside allowed scope
- merge authority is already granted when a merge is needed
- validation failures can be fixed narrowly inside scope
- review threads are narrow and in scope
- no owner-only decision is required
- no secret, credential, or manual private action is required
- no DB, schema, data, env, package, Vercel, deploy, release, or tag change is
  required
- no production-write behavior is introduced
- no Hermes, MCP, autonomy, or worker activation is involved

## Stop Conditions

Codex stops for:

- owner product decision
- owner identity decision
- credential or secret action
- secret exposure or possible exposure
- validation failure requiring scope expansion
- review request that broadens scope
- missing merge authority
- DB, schema, data, env, package, or Vercel change
- deploy, release, or tag authority
- owner access risk
- public account-creation or SaaS behavior risk
- production-write behavior
- Hermes, MCP, autonomy, Brain Council runtime, or worker activation
- TerraFusion, PACS, county production system, or unrelated container touch

## Continuation After Merge

After a clean merge, Codex must:

1. verify the PR is merged
2. verify `origin/main`
3. verify required production or read-only checks
4. report safety posture
5. move to the next authorized loop when one exists

Codex does not stop at merge unless the active goal is complete or a gate is
present.

## Continuation After Review Feedback

Codex continues when review feedback is narrow and in scope.

Codex stops when review feedback requires:

- product doctrine decision
- owner authority
- runtime behavior expansion
- auth behavior change outside scope
- DB, schema, data, env, package, Vercel, deploy, release, or tag change
- secret handling
- production-write behavior
- autonomy or worker activation

## Continuation After Validation Failure

Codex applies a narrow fix and reruns validation when the fix is inside scope.

Codex stops when the fix requires:

- scope expansion
- owner decision
- new dependency
- environment mutation
- schema or data mutation
- cloud or deployment change
- production-write behavior

## Required Stop Report

When Codex stops, it must return:

```text
RESULT:
WORK_ORDER:
GOAL:
BLOCKER:
WHY_BLOCKED:
SAFE_TO_CONTINUE:
OWNER_DECISION_NEEDED:
NEXT_VALID_ACTION:
DO_NOT_PROVIDE:
- passwords
- tokens
- cookies
- session values
- private keys
- DB URLs
- secrets
```

## Goal Completion Rule

Codex may mark a goal complete only when:

- all required work orders are complete
- all required PRs are merged
- review threads are resolved
- validation passed
- required production/read-only checks passed
- safety posture remains inside scope
- no owner decision remains for the active goal

## Current Handoff

After `GOAL-OPS-001` completes, the next authorized product goal is:

```text
GOAL-WOS-001 - Primary Shell Completion
```

First loop:

```text
WO-SHELL-004 - Primary Navigation Shell
```

## Maintenance

Update this policy only through a governance work order. Do not add scheduling,
background execution, autonomy, worker activation, GitHub app behavior, or
runtime command execution without separate owner authority.
