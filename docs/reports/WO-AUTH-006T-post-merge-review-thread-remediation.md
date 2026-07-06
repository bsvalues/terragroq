# WO-AUTH-006T — Post-Merge Review Thread Remediation for PR #296

## Result

PASS_PENDING_REMEDIATION_PR

## Goal

`GOAL-AUTH-001 — Close Owner-Only Auth Correction`

## Base

`origin/main = 4d4fc63264bce4248342f94ea1bdb5ffa595747f`

## Threads Found

Five unresolved PR #296 review threads were found after merge.

## Classification

| Thread | File | Classification | Remediation |
| --- | --- | --- | --- |
| 1 | `app/api/setup/primary-credential/route.ts` | substantive | Strengthened local setup request checks beyond URL hostname by requiring loopback request URL plus loopback `Origin` or `Referer` for credential setup POSTs. |
| 2 | `app/api/setup/primary-credential/route.ts` | substantive | Blocked credential provisioning when non-primary auth records exist but the declared Primary identity is absent. |
| 3 | `lib/auth-error-copy.ts` | formatting | Fixed accidental indentation on the `message` field. |
| 4 | `components/auth-form.tsx` | formatting | Fixed accidental JSX prop indentation for the password input. |
| 5 | `app/api/setup/primary-credential/route.ts` | substantive | Reworked provisioning/recovery transactions to use one checked-out PostgreSQL client for `begin`, all queries, `commit`, and `rollback`. |

## Safety

- Public signup restored: false
- SaaS onboarding restored: false
- Owner identity changed: false
- Auth provider rewritten: false
- DB/schema migration performed: false
- Env/package/Vercel setting changed: false
- Production write behavior added: false
- Secrets printed or committed: false
- Hermes/MCP/autonomy activated: false

## Validation

Focused auth/setup tests passed before full validation:

- `tests/primary-credential.test.ts`
- `tests/setup-local-config-route.test.ts`
- `tests/auth-ux-state.test.ts`
- `tests/auth-error-copy.test.ts`
- `tests/operator-login-surface.test.ts`

Full validation remains required before merge.
