# WO-SHELL-005 - Work Orders Surface

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-WOS-001 - Primary Shell Completion`

## Base

`origin/main = 4938134e4ccdc5e960197f5b90af0c7b0890fe87`

## Scope

Refine the Work Orders shell surface so it reads as a Primary Operator work-control
console, not a generic work-management or automation launcher surface.

## Files

- `app/(shell)/work-orders/page.tsx`
- `components/work-orders/work-orders-command-surface.ts`
- `components/work-orders/work-orders-command-panel.tsx`
- `components/work-orders/active-work-queue.ts`
- `components/work-orders/active-work-queue-panel.tsx`
- `tests/work-orders-command-surface.test.ts`
- `tests/active-work-queue.test.ts`
- `docs/reports/WO-SHELL-005-work-orders-surface.md`

## Changes

- Reframed Work Orders as the Primary Operator work-control surface.
- Moved the Primary work queue ahead of deeper WOE detail panels.
- Added a visible Primary sequence: `/goal`, Work Order gate, `/loop`, Evidence.
- Added blocked expansion cards for command runners, authority grants, autonomy,
  and production writes.
- Updated active queue language from generic active work to Primary work.
- Updated tests to enforce Primary shell framing and blocked expansion posture.

## Safety

- `NAVIGATION_CHANGED: false`
- `WORK_ORDERS_SURFACE_CHANGED: true`
- `AUTH_BEHAVIOR_CHANGED: false`
- `AUTH_POLICY_CHANGED: false`
- `PUBLIC_SIGNUP_REINTRODUCED: false`
- `OWNER_ACCESS_MODEL_PRESERVED: true`
- `DB_SCHEMA_CHANGED: false`
- `ENV_CHANGED: false`
- `PACKAGE_CHANGED: false`
- `VERCEL_SETTINGS_CHANGED: false`
- `PRODUCTION_WRITE_BEHAVIOR: false`
- `COMMAND_RUNNER_ADDED: false`
- `AUTONOMY_CHANGED: false`
- `SECRETS_EXPOSED: false`

## Validation

Required before merge:

- focused Work Orders shell tests
- forbidden SaaS/auth/task-board language scan on Work Orders shell surfaces
- `git diff --check`
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- production `/api/health`
- production `/api/auth/readiness`
- production `/work-orders`

## Next Recommended Work Order

`WO-SHELL-006 - Evidence Surface`
