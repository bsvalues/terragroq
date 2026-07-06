# WilliamOS Owner Decision Packet Template

Work order: `WO-OPS-007`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / Owner Gate Template
Risk: Low, documentation only

## Purpose

This template defines how Codex asks William for a decision when an active
WilliamOS work-order loop reaches an owner-only gate.

The template is documentation-only. It does not create approvals, permissions,
runtime controls, account grants, database records, or production-write
behavior.

## When To Use

Use this packet when Codex cannot proceed safely because the next action needs:

- product doctrine
- owner identity
- credential or secret handling
- merge authority not already granted
- DB, schema, or data mutation
- env, package, or Vercel changes
- deploy, release, or tag authority
- production-write behavior
- Hermes, MCP, autonomy, or worker activation
- safety exception
- scope expansion beyond the active work order

Do not use this packet for routine next steps already authorized by the active
goal and loop.

## Required Packet

```text
OWNER_DECISION_REQUIRED

DECISION:
<one specific decision>

WHY:
<why Codex cannot proceed safely>

OPTIONS:
A. <option>
B. <option>
C. <option>

RECOMMENDED:
<option and reason>

RISK:
<risk>

SAFE_DEFAULT:
<what happens if no decision is made>

DO_NOT_PROVIDE:
- passwords
- tokens
- cookies
- session values
- private keys
- DB URLs
- secrets
```

## Decision Quality Rules

Codex must:

- ask for one decision at a time
- explain why the gate is owner-only
- give concrete options
- recommend one option when there is a safe default
- name the risk of each unsafe path
- state what Codex will do if no decision is made
- tell William not to provide secrets

Codex must not:

- ask William to paste passwords, tokens, cookies, session values, private keys,
  DB URLs, or secrets
- hide a scope expansion inside a routine question
- ask for broad permission when a narrow decision is enough
- proceed on assumptions when owner authority is required
- convert a blocked owner decision into a runtime implementation without a new
  packet

## Common Owner Decision Types

### Product Doctrine

Use when the question affects what WilliamOS is, how it should feel, or what
product model it follows.

Default: stop and preserve the current doctrine.

### Owner Identity

Use when the question affects the Primary Operator identity or owner access.

Default: stop. Do not guess identity.

### Credential Or Secret Action

Use when private owner action is required.

Default: stop. Do not request or print the secret.

### Scope Expansion

Use when a review thread, validation failure, or implementation need exceeds the
active work order.

Default: stop at the current scope.

### Production Authority

Use when deploy, release, tag, production-write behavior, DB/schema/data/env,
package, or Vercel changes are required.

Default: stop. Do not mutate production.

### Autonomy Or Worker Activation

Use when Hermes, MCP, Brain Council runtime, background workers, or autonomous
execution would be activated.

Default: stop. Advisory/read-only posture remains.

## Return Shape For Blocked Work

```text
RESULT: BLOCKED_OWNER_DECISION
WORK_ORDER:
GOAL:
BLOCKER:
WHY_BLOCKED:
SAFE_TO_CONTINUE:
OWNER_DECISION_NEEDED:
SAFE_DEFAULT:
NEXT_VALID_ACTION:
```

## Safe Defaults

- No decision: do not proceed.
- Ambiguous authority: do not proceed.
- Secret involved: stop and protect the secret boundary.
- Product doctrine conflict: preserve current doctrine.
- Owner access risk: stop.
- Production mutation: stop.
- Autonomy activation: stop.

## Maintenance

Update this template only through a governance work order. Runtime approval
controls, permission models, account grants, database records, or production
automation require separate owner authority.
