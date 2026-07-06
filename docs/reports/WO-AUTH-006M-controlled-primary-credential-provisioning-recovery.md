# WO-AUTH-006M — Controlled Primary Credential Provisioning / Recovery

## Result

BLOCKED_OWNER_RECOVERY_ACTION_REQUIRED

## Base

`aa21654061e64b8f3959c841ed34169f6c0b3204`

## Branch

`codex/remove-saas-signup-model`

## Finding

`WO-AUTH-006L` was correctly reclassified. The owner credential source was not
established, so manual sign-in could not proceed.

WilliamOS uses Better Auth with email/password credentials stored in the local
PostgreSQL Better Auth tables:

- `user`
- `account`
- `session`

Local aggregate evidence showed existing credential-backed auth records:

- Primary/auth records exist: yes
- Credential provider records exist: yes
- Password-backed credential records exist: yes
- Credential values printed: no
- Email identities printed: no

Because records already exist, the current local state is recovery, not
first-owner provisioning.

## Implemented Gate

Added a loopback-only local setup endpoint:

`/api/setup/primary-credential`

The endpoint:

- runs only outside production
- rejects non-loopback requests
- validates Primary email and password confirmation
- uses Better Auth password hashing
- creates the first Primary credential only when no auth records exist
- recovers an existing Primary credential when records exist and the entered
  Primary email matches a local record
- revokes existing sessions for the recovered Primary record
- does not return password hashes, tokens, cookies, database URLs, or secret
  values

Updated `/setup` so configured local auth no longer routes owner provisioning
through `/sign-up`. It now exposes a controlled Primary credential form on the
local setup surface.

## Owner Action Still Required

The Primary Operator must use `/setup` locally to establish or recover the
Primary credential, then sign in through `/sign-in`.

This report is not a PASS because owner access has not yet been proven.

## Validation

- `git diff --check`: PASS
- focused auth tests: PASS (`tests/primary-credential.test.ts`,
  `tests/auth-ux-state.test.ts`, `tests/auth-error-copy.test.ts`)
- full test suite: PASS (`120` files, `563` tests)
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: PASS
- browser verification: PASS for `/setup` controlled Primary credential form
  visibility and no setup link to `/sign-up`

Note: The first build attempt hit the known stale local `.next` EPERM scandir
failure. Only the workspace-local generated `.next` artifact was removed before
rerunning the build.

## Safety

- Public signup reintroduced: false
- SaaS onboarding restored: false
- Password printed: false
- Secrets exposed: false
- Cookie/token printed: false
- Credential value committed: false
- Auth provider rewritten: false
- DB schema changed: false
- Env changed: false
- Package/dependency changed: false
- Deploy performed: false
- Vercel changed: false
- Hermes/MCP/autonomy activated: false

## Next Required Gate

Resume owner proof after the Primary Operator uses controlled recovery:

`WO-AUTH-006N — Primary Credential Recovery Execution and Owner Access Proof`

Acceptance remains:

- Primary credential source established
- owner signs in successfully
- `/operator` reachable after authentication
- Primary/Home reachable after authentication
- protected routes no longer redirect after authentication
- `/sign-up` remains closed
- owner is not locked out
- PR remains blocked until owner access proof passes
