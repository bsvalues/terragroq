# WO-OPS-005 - Merge Gate Checklist

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-OPS-001 - Codex Operator Mode`

## Scope

Add a docs-only merge gate checklist for Codex-operated WilliamOS work-order
PRs.

## Files

- `docs/governance/merge-gate-checklist.md`
- `docs/governance/goal-registry.md`
- `docs/governance/loop-registry.md`
- `docs/reports/WO-OPS-005-merge-gate-checklist.md`

## Content Added

- merge authority requirement
- required pre-merge checks
- review-thread requirement
- check handling
- merge method
- post-merge verification
- merge result evidence
- stop conditions
- safe defaults
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

`WO-OPS-006 - Production Verification Checklist`
