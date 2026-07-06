# WO-OPS-007 - Owner Decision Packet Template

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-OPS-001 - Codex Operator Mode`

## Scope

Add a docs-only owner decision packet template for Codex-operated WilliamOS
work-order loops.

## Files

- `docs/governance/owner-decision-packet-template.md`
- `docs/governance/goal-registry.md`
- `docs/governance/loop-registry.md`
- `docs/reports/WO-OPS-007-owner-decision-packet-template.md`

## Content Added

- when to use an owner decision packet
- required packet shape
- decision quality rules
- common owner decision types
- blocked-work return shape
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

`WO-OPS-008 - Operator Continuation Rule / Stop-Only-On-Gate Policy`
