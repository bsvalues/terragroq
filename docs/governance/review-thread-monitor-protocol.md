# WilliamOS Review Thread Monitor Protocol

Work order: `WO-OPS-004`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / PR Protocol
Risk: Low, documentation only

## Purpose

This protocol defines how Codex monitors, classifies, remediates, and reports
GitHub PR review threads during WilliamOS work-order loops.

The protocol is documentation-only. It does not create a GitHub integration,
background monitor, webhook, worker, or autonomous process.

Under `LOOP-WOS-CODEX-OPERATOR-001`, review monitoring is routine Codex
operator work. A normal in-scope thread resolves to remediation and revalidation;
only a scope-expanding, higher-risk, secret, security, or owner-policy thread
creates a typed `/stop` wall.

## Required Monitoring Points

Codex checks review threads:

1. after opening a PR
2. after remote checks first complete
3. immediately before merge
4. after merge when the active goal requires post-merge verification
5. whenever GitHub reports new review activity

Codex must report:

- total review threads
- unresolved review threads
- substantive unresolved threads
- stale or already-addressed threads
- owner-gated threads
- action taken

## Thread Classes

### `substantive_in_scope`

The thread identifies a real issue inside the active work-order scope.

Codex action:

- patch narrowly
- rerun required validation
- push to the same PR
- recheck threads and checks
- resolve the thread only after the fix is present

### `formatting_in_scope`

The thread identifies formatting, naming, documentation alignment, or wording
inside the active scope.

Codex action:

- patch narrowly
- rerun appropriate validation
- push to the same PR
- resolve after patch

### `already_addressed`

The thread is still unresolved in GitHub state, but a later commit already
addressed it.

Codex action:

- verify the addressing commit or diff
- resolve the thread
- report why it was safe to resolve

### `stale_or_non_actionable`

The thread no longer applies to the current diff, is informational only, or has
no actionable request.

Codex action:

- report classification
- resolve only when evidence is clear
- otherwise leave unresolved and stop before merge

### `scope_expanding`

The thread asks for work outside the active work order.

Examples:

- runtime code change during a docs-only loop
- auth behavior change outside an auth work order
- DB, schema, data, env, package, Vercel, deploy, release, or tag change
- production-write behavior
- Hermes, MCP, autonomy, or worker activation

Codex action:

- stop
- classify `BLOCKED_OWNER_DECISION` or `BLOCKED_SAFETY`
- do not broaden the PR

### `secret_or_credential_risk`

The thread involves secrets, credentials, tokens, cookies, session values,
password hashes, private keys, or DB URLs.

Codex action:

- stop
- classify `BLOCKED_SECRET_EXPOSURE_ROTATION_REQUIRED` if exposure may have
  occurred
- never repeat the secret value

## Pre-Merge Gate

Codex may merge only when:

- total unresolved review threads is `0`
- requested changes are absent
- checks are green or acceptable by the active work order
- all substantive threads are remediated or owner-blocked
- no scope-expanding thread remains unresolved
- no secret exposure is present

## Post-Merge Gate

If a substantive thread appears after merge, classify:

```text
RESULT: MERGED_WITH_REMEDIATION_REQUIRED
```

Then Codex must immediately run a remediation loop when:

- the fix is narrow
- the fix remains inside granted authority
- no owner decision is required

Codex must stop when the remediation requires:

- product doctrine changes
- owner identity changes
- secret handling
- auth behavior changes outside scope
- DB, schema, data, env, package, Vercel, deploy, release, or tag changes
- production-write behavior
- autonomy or worker activation

## Evidence Format

Review-thread evidence should include:

```text
REVIEW_THREADS:
- total:
- unresolved:
- substantive_in_scope:
- formatting_in_scope:
- already_addressed:
- stale_or_non_actionable:
- scope_expanding:
- secret_or_credential_risk:
- action:
```

For each remediated thread, report:

- PR number
- thread class
- affected file
- fix summary
- validation rerun
- resolution status

## Safe Defaults

- If a thread is unresolved, do not merge.
- If a thread is in scope, fix it.
- If a thread is already addressed, verify and resolve it.
- If a thread expands scope, stop.
- If a thread touches secrets, stop.
- If GitHub state is unclear, re-query before merge.

## Maintenance

Update this protocol only through a governance work order. Do not add background
monitoring, webhooks, scheduled jobs, or GitHub write integrations unless a
future owner-authorized packet explicitly grants that authority.
