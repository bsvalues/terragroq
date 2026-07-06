# WO-SHELL-006 - Evidence Surface

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-WOS-001 - Primary Shell Completion`

## Base

`origin/main = a81a2979f95748c6bf900d75cf0c327107041d5d`

## Scope

Refine the Evidence shell surface so it reads as the Primary Operator proof
layer for Work Orders, validation, production verification, blockers, and
closure reports.

## Files

- `app/(shell)/audit/page.tsx`
- `components/evidence/evidence-command-surface.ts`
- `components/evidence/evidence-command-panel.tsx`
- `components/evidence/evidence-spine-surface.ts`
- `tests/evidence-command-surface.test.ts`
- `tests/evidence-spine-surface.test.ts`
- `docs/reports/WO-SHELL-006-evidence-surface.md`

## Changes

- Reframed Evidence as the Primary Operator proof layer.
- Added the visible proof sequence: scope, validate, verify, close.
- Added explicit blocked expansion cards for ingestion, proof runners, authority
  grants, and production mutation.
- Added static evidence records for WO-SHELL-004 / PR #308 and WO-SHELL-005 /
  PR #309.
- Updated next lane guidance to WO-SHELL-007 - Systems Status Surface.
- Updated tests to enforce Primary proof framing and blocked expansion posture.

## Safety

- `EVIDENCE_SURFACE_CHANGED: true`
- `DYNAMIC_INGESTION_ADDED: false`
- `FILESYSTEM_SCAN_ADDED: false`
- `GITHUB_API_INTEGRATION_ADDED: false`
- `COMMAND_EXECUTION_ADDED: false`
- `COMMAND_RUNNER_ADDED: false`
- `AUTHORITY_GRANT_ADDED: false`
- `PRODUCTION_MUTATION_ADDED: false`
- `AUTH_BEHAVIOR_CHANGED: false`
- `AUTH_POLICY_CHANGED: false`
- `PUBLIC_SIGNUP_REINTRODUCED: false`
- `DB_SCHEMA_CHANGED: false`
- `ENV_CHANGED: false`
- `PACKAGE_CHANGED: false`
- `AUTONOMY_CHANGED: false`
- `SECRETS_EXPOSED: false`

## Validation

Required before merge:

- focused Evidence shell tests
- forbidden SaaS/auth/analytics/automation language scan on Evidence shell surfaces
- `git diff --check`
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- production `/api/health`
- production `/api/auth/readiness`
- production `/audit`

## Next Recommended Work Order

`WO-SHELL-007 - Systems Status Surface`
