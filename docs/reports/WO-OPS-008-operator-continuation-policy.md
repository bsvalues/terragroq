# WO-OPS-008 - Operator Continuation Rule / Stop-Only-On-Gate Policy

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-OPS-001 - Codex Operator Mode`

## Scope

Add a docs-only operator continuation policy for Codex-operated WilliamOS
work-order loops.

## Files

- `docs/governance/operator-continuation-policy.md`
- `docs/governance/goal-registry.md`
- `docs/governance/loop-registry.md`
- `docs/reports/WO-OPS-008-operator-continuation-policy.md`

## Content Added

- continue conditions
- stop conditions
- continuation after merge
- continuation after review feedback
- continuation after validation failure
- required stop report
- goal completion rule
- next goal handoff to `GOAL-WOS-001`
- registry status updates

## Safety

- `RUNTIME_CHANGED: false`
- `AUTH_CHANGED: false`
- `DB_SCHEMA_CHANGED: false`
- `ENV_CHANGED: false`
- `PACKAGE_CHANGED: false`
- `VERCEL_SETTINGS_CHANGED: false`
- `PRODUCTION_WRITE_BEHAVIOR: false`
- `AUTONOMY_CHANGED: false`
- `SECRETS_EXPOSED: false`

## Validation

Required before merge:

- `git diff --check`
- docs checks if present
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- if the merge touches production-relevant surfaces:
  - production `/api/health`
  - production `/api/auth/readiness`

## Next Recommended Work Order

`WO-SHELL-004 - Primary Navigation Shell`
