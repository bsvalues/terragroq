# WO-OPS-006 - Production Verification Checklist

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-OPS-001 - Codex Operator Mode`

## Scope

Add a docs-only production verification checklist for Codex-operated WilliamOS
work-order merges.

## Files

- `docs/governance/production-verification-checklist.md`
- `docs/governance/goal-registry.md`
- `docs/governance/loop-registry.md`
- `docs/reports/WO-OPS-006-production-verification-checklist.md`

## Content Added

- when production verification is required
- standard health/readiness checks
- touched route checks
- visible posture checks
- failure handling
- evidence format
- secret safety rules
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

`WO-OPS-007 - Owner Decision Packet Template`
