# WilliamOS Production Verification Checklist

Work order: `WO-OPS-006`
Goal: `GOAL-OPS-001 - Codex Operator Mode`
Type: Governance / Verification Gate
Risk: Low, documentation only

## Purpose

This checklist defines how Codex verifies production after a WilliamOS PR merge
when the active work order requires production verification.

The checklist is documentation-only. It does not deploy, promote, release, tag,
change Vercel settings, create monitors, or add production-write behavior.

## When Production Verification Is Required

Production verification is required after merge when the work order touches:

- UI routes
- auth or owner access surfaces
- shell navigation
- runtime status surfaces
- public or protected route behavior
- production health/readiness code
- deployment, hosting, or environment behavior

Production verification is also required when the active work order explicitly
requires it, even for documentation-only changes.

Production verification is not required for docs-only changes unless the active
work order or merge gate asks for a health/readiness proof.

## Standard Checks

Required health checks:

```text
/api/health
/api/auth/readiness
```

Expected result:

- `/api/health` returns HTTP `200`
- health body reports `status=ok`
- `/api/auth/readiness` returns HTTP `200`
- readiness body reports `ready=true`
- readiness body reports `authReady=true`
- readiness body reports `databaseReady=true`

## Surface Checks

Check touched routes after UI, auth, shell, runtime, or route behavior changes.

Auth-sensitive route checks:

- `/sign-in` when auth entry or shell access changes
- `/sign-up` when auth model or signup policy changes
- `/operator` when Primary shell access changes

Shell-sensitive route checks:

- `/`
- `/operator`
- `/goal-console`
- `/work-orders`
- any route changed by the work order

Runtime-sensitive route checks:

- `/runtime`
- `/api/local/runtime/status`
- any runtime status API changed by the work order

## Visible Posture Checks

For auth and shell surfaces, report visible posture:

- Primary/Owner language present when expected
- forbidden public account-creation copy absent
- SaaS onboarding copy absent
- owner access model preserved
- route does not expose new authority or runtime control

## Failure Handling

If production health/readiness fails after merge:

```text
RESULT: MERGED_WITH_REMEDIATION_REQUIRED
```

Codex may remediate only when:

- the failure is narrow
- the fix is inside active authority
- no DB, schema, data, env, package, Vercel, deploy, release, or tag change is
  required
- no secret or credential is required
- no owner access risk is introduced

Otherwise classify:

```text
RESULT: BLOCKED_OWNER_DECISION
```

or:

```text
RESULT: BLOCKED_SAFETY
```

## Evidence Format

Production verification reports should include:

```text
PRODUCTION_VERIFICATION:
- /api/health:
  - status:
  - body status:
- /api/auth/readiness:
  - status:
  - ready:
  - authReady:
  - databaseReady:
- routes checked:
- visible posture:
- result:
```

## Secret Safety

Production verification must not print:

- passwords
- password hashes
- tokens
- cookies
- session values
- private keys
- DB URLs
- credential fields

Codex must not capture credential fields in screenshots, logs, snapshots, or
reports.

## Safe Defaults

- If production verification is required and cannot be completed, do not call
  the loop complete.
- If health/readiness fails, classify and remediate or stop.
- If a protected route requires owner login, verify only non-secret route/result
  state or stop for owner manual action.
- If a check would expose secrets, stop.
- If production was not touched and the work order does not require production
  verification, report `not required for docs-only change`.

## Maintenance

Update this checklist only through a governance work order. Deployment
automation, Vercel configuration, production monitors, or runtime probes require
separate owner authority.
