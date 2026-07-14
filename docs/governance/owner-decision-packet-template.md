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

DECISION_ID:
BLOCKED_WORK_ORDER:
WALL_TYPE:

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

RESUME_ACTION:
<the exact blocked Work Order and next action Codex resumes after the decision>

OWNER_OPERATION_TOUCH_COUNT:
OWNER_CREDENTIAL_TOUCH_COUNT:
OWNER_DIAGNOSTIC_TOUCH_COUNT:
OWNER_ROUTINE_DECISION_COUNT:
OWNER_ROUTINE_CONTACT_COUNT:
OWNER_OPERATION_EVIDENCE_REF:
OWNER_OPERATION_CERTIFICATION_STATE:

DO_NOT_PROVIDE:
- passwords
- tokens
- cookies
- session values
- private keys
- DB URLs
- secrets
```

The packet is resumable state, not a handoff to another operator. After the
Primary records the decision, Codex resumes the blocked Work Order itself.

The five owner-touch/contact counters and evidence state are mandatory even on a stop
packet. A genuine owner authority decision requested by this packet is not a
routine operation and does not increment `OWNER_ROUTINE_DECISION_COUNT`.
Asking the Owner to courier work, run diagnostics, repair credentials, receive routine status, or make
a routine implementation choice does increment the applicable counter and
disqualifies zero-owner-operation certification.

Zero counters supplied by a caller are not certification evidence. The packet
remains `UNVERIFIED_ZERO_OWNER_OPERATIONS`; the independently anchored,
context-bound verifier required for certification is not implemented in this
phase. Any nonzero counter is `FAILED_OWNER_BABYSITTING`; a stop packet must
never describe either state as certified.

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
- count a genuine consequential authority decision as a routine owner decision
- label caller-supplied zero counters certified without an independent evidence
  reference
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

## Owner Decision Queue Mapping

When a packet should later be represented in the Owner Decision Queue, map it to
the existing `OwnerDecisionRecord` shape:

```text
decisionId:
title:
category:
status:
riskLevel:
blockedLane:
whyBlocked:
authorityRequired:
evidenceRequired:
relatedAuthorityRecords:
relatedEvidenceRecords:
relatedWorkOrders:
safeDefault:
ownerActionRequired:
nextValidAction:
blockedActions:
```

Mapping guidance:

- `DECISION` maps to `title`.
- `WHY` maps to `whyBlocked`.
- `RISK` maps to `riskLevel` plus `blockedActions` when relevant.
- `SAFE_DEFAULT` maps to `safeDefault`.
- `RECOMMENDED` maps to `nextValidAction` only when the recommendation is a
  safe next action, not approval.
- `OPTIONS` remain packet guidance unless a future queue work order records
  them in evidence or related records.
- `DO_NOT_PROVIDE` remains a secret-safety instruction and must not become a
  stored secret field.

The queue remains read-only. Mapping a packet to the queue does not approve,
deny, authorize, execute, or mutate work.

## Return Shape For Blocked Work

```text
RESULT: BLOCKED_OWNER_DECISION
WORK_ORDER:
BLOCKER:
WHY_BLOCKED:
SAFE_TO_CONTINUE:
OWNER_DECISION_NEEDED:
NEXT_VALID_ACTION:
OWNER_OPERATION_TOUCH_COUNT:
OWNER_CREDENTIAL_TOUCH_COUNT:
OWNER_DIAGNOSTIC_TOUCH_COUNT:
OWNER_ROUTINE_DECISION_COUNT:
OWNER_ROUTINE_CONTACT_COUNT:
OWNER_OPERATION_EVIDENCE_REF:
OWNER_OPERATION_CERTIFICATION_STATE:
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
