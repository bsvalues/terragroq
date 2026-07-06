# WO-AUTH-006P — Primary Identity Declaration / Test Auth Record Quarantine

## Result

PASS_WITH_OWNER_ACCESS_PROOF_PENDING

## Base

`aa21654061e64b8f3959c841ed34169f6c0b3204`

## Branch

`codex/remove-saas-signup-model`

## Owner Decision

The declared Primary Operator identity for local WilliamOS owner access is:

`bsvalues@gmail.com`

The following local Better Auth records are non-primary and must not be offered
as Primary Operator candidates:

| Email | Classification |
| --- | --- |
| `operator@command.io` | seed/demo/test record |
| `test+wo@example.com` | test/work-order record |
| `diag+1782790395@example.com` | diagnostic/generated record |

## Changes

- Added a code-level Primary identity declaration:
  `DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"`.
- Added local auth identity classification helpers.
- Updated controlled `/setup` Primary credential recovery so it targets only the
  declared Primary identity.
- Made the `/setup` Primary email field read-only and prefilled with the
  declared Primary email.
- Updated the credential API to reject recovery attempts for non-primary local
  auth records.
- Added focused tests proving seed/test/diagnostic records are quarantined from
  owner identity selection.

No local auth records were deleted.

## Investigation Summary

Local Better Auth contained four user records. Three records match seed, test,
or diagnostic naming patterns and were owner-classified as non-primary. The app
had no Primary role flag or durable owner identity declaration before this work,
so the database was incorrectly able to imply owner candidates.

The code now treats the owner declaration as authoritative for local owner
recovery. Fake/test/diagnostic rows remain in the database but are not valid
Primary identities.

## Safety

- Password printed: false
- Password hash printed: false
- Token printed: false
- Cookie printed: false
- Session value printed: false
- Database URL printed: false
- Public signup reintroduced: false
- SaaS onboarding restored: false
- Auth provider rewritten: false
- DB/schema migration performed: false
- Auth records deleted: false
- Env changed: false
- Package/dependency changed: false
- Deploy performed: false
- Vercel changed: false
- Hermes/MCP/autonomy activated: false

## Validation

- Focused auth/setup tests: PASS
  - `tests/primary-credential.test.ts`
  - `tests/setup-local-config-route.test.ts`
  - `tests/auth-ux-state.test.ts`
  - `tests/operator-login-surface.test.ts`

Full validation remains required before PR readiness after owner access proof.

## Next Required Gate

`WO-AUTH-006Q — Recover Password For Declared Primary / Verify Owner Access`

Use `/setup` to recover the password for `bsvalues@gmail.com`, then sign in
through `/sign-in` and verify WilliamOS access. Do not print or store the
password.
