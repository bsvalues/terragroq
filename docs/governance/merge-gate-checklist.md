# WilliamOS Merge Gate Checklist

Work order: `WO-OPS-005`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / PR Gate
Risk: Low, documentation only

## Purpose

This checklist defines when Codex may merge a WilliamOS pull request under an
active work-order loop.

The checklist is documentation-only. It does not create automation, change
branch protection, alter GitHub settings, or grant runtime authority.

## Merge Authority Requirement

Codex may merge only when the active goal or work order grants merge authority.

If merge authority is missing:

```text
RESULT: BLOCKED_OWNER_DECISION
```

Codex must ask for a specific merge authority decision.

## Required Pre-Merge Checks

Before merge, Codex must verify:

- branch is the intended work-order branch
- changed files match the active work-order scope
- `.obsidian/` and unrelated untracked files remain untouched
- `git diff --check` passed
- required focused tests passed, if applicable
- full `npm test -- --run` passed, unless the active work order explicitly
  waives full tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build` passed,
  unless the active work order explicitly waives build
- changed-file secret scan passed
- PR is open against the intended base
- PR checks are green or acceptable under the active work order
- Vercel is green when applicable
- review-thread unresolved count is `0`
- requested changes are absent
- no scope-expanding review remains
- no public account-creation or SaaS auth regression is present
- no owner access risk is present
- no secret exposure is present
- no unapproved DB, schema, data, env, package, Vercel, deploy, release, tag,
  production-write, or autonomy change is present

## Review Thread Requirement

Codex must query review threads immediately before merge.

Merge is blocked when:

- any unresolved thread remains
- any substantive thread is unaddressed
- any thread requires owner authority
- any thread indicates possible secret exposure

Already-addressed threads may be resolved only after Codex verifies the
addressing diff or commit.

## Check Handling

Acceptable check states:

- required checks successful
- Sourcery skipped because of known account or rate-limit status
- informational comments with no requested changes

Blocking check states:

- failed required check
- pending required check
- Vercel failed when applicable
- requested changes
- secret scan finding
- unresolved substantive review thread

## Merge Method

Default merge method:

```text
squash merge
```

Codex must not create releases, tags, deployments, or production promotions as
part of a normal merge unless the active work order explicitly authorizes them.

## Post-Merge Verification

After merge, Codex must verify:

- PR state is `MERGED`
- merge commit is recorded
- local `main` and `origin/main` are updated
- worktree is clean except approved untracked files
- production `/api/health` and `/api/auth/readiness` when the merge touches
  production-relevant surfaces or the work order requires production checks
- touched routes when UI, auth, shell, runtime, or public surfaces changed

## Merge Result

Successful merge returns:

```text
RESULT: MERGED
```

Required evidence:

- PR URL
- merge commit
- `origin/main`
- files changed
- validation
- review-thread count
- check summary
- production verification when required
- safety posture
- next recommended work order

## Stop Conditions

Codex must stop before merge when:

- owner decision is required
- credential or secret action is required
- validation fails outside narrow fix scope
- review threads broaden scope
- DB, schema, data, env, package, or Vercel change is needed
- deploy, release, or tag authority is needed
- owner access might be broken
- public account-creation or SaaS behavior might return
- production-write behavior is introduced
- Hermes, MCP, autonomy, or worker activation is involved

## Safe Defaults

- Pending required check: wait.
- Failed required check: fix narrowly or stop.
- Unresolved thread: do not merge.
- Scope expansion: stop.
- Secret concern: stop and rotate if exposure is possible.
- Merge authority unclear: stop.

## Maintenance

Update this checklist only through a governance work order. Runtime merge tools,
branch protection changes, GitHub app configuration, or deployment automation
require separate owner authority.
