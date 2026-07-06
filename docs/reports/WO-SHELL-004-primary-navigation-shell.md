# WO-SHELL-004 - Primary Navigation Shell

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-WOS-001 - Primary Shell Completion`

## Base

`origin/main = 029e547f8952e060a7a0175e2ad330b21c2021dc`

## Scope

Implement the first coherent Primary Navigation Shell for WilliamOS in the
existing shell navigation components.

## Files

- `components/shell/nav-items.ts`
- `components/shell/sidebar-nav.tsx`
- `components/shell/mobile-nav.tsx`
- `components/shell/app-shell.tsx`
- `tests/nav-items.test.ts`
- `docs/reports/WO-SHELL-004-primary-navigation-shell.md`

## Changes

- Reordered navigation around Primary Operator command areas.
- Added Primary vs Supporting group posture to navigation groups.
- Promoted Work Orders, Evidence, Projects, Systems, Authority, Decisions,
  Doctrine, Memory, Council, Forge, and Hermes into a coherent operator shell sequence.
- Added accessible `aria-current` state for active navigation links.
- Updated mobile navigation title to "Primary Navigation".
- Updated the existing shell sidebar and mobile header branding from
  "Operator Shell" to "Primary Shell".
- Expanded navigation tests to block SaaS/account/team/workspace language.

## Safety

- `NAVIGATION_CHANGED: true`
- `AUTH_BEHAVIOR_CHANGED: false`
- `AUTH_POLICY_CHANGED: false`
- `PUBLIC_SIGNUP_REINTRODUCED: false`
- `OWNER_ACCESS_MODEL_PRESERVED: true`
- `DB_SCHEMA_CHANGED: false`
- `ENV_CHANGED: false`
- `PACKAGE_CHANGED: false`
- `VERCEL_SETTINGS_CHANGED: false`
- `PRODUCTION_WRITE_BEHAVIOR: false`
- `AUTONOMY_CHANGED: false`
- `SECRETS_EXPOSED: false`

## Validation

Required before merge:

- focused shell/navigation tests
- forbidden SaaS/auth language scan on operator-facing shell surfaces
- `git diff --check`
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- production `/api/health`
- production `/api/auth/readiness`
- production `/operator`
- production touched shell route

## Next Recommended Work Order

`WO-SHELL-005 - Work Orders Surface`
