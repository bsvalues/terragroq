# WO-AUTH-006O — Primary Identity Discovery / Declaration Gate

## Result

BLOCKED_PRIMARY_IDENTITY_UNDECLARED

## Base

`aa21654061e64b8f3959c841ed34169f6c0b3204`

## Branch

`codex/remove-saas-signup-model`

## Finding

The local Better Auth database contains multiple auth user records and WilliamOS
does not yet have a Primary role flag or Primary identity declaration field.

Because multiple local identities exist, Codex cannot infer which one is the
Primary Operator. Credential recovery must not proceed until the owner confirms
the Primary email.

## Local Auth Candidates

Secret-bearing fields were not queried or printed. Password hashes, tokens,
cookies, session values, and database connection values were not exposed.

| Candidate | Email | Display name | Credential provider | Password present |
| --- | --- | --- | --- | --- |
| 1 | `operator@command.io` | `Ops Lead` | yes | yes |
| 2 | `test+wo@example.com` | `Test Operator` | yes | yes |
| 3 | `bsvalues@gmail.com` | `bill` | yes | yes |
| 4 | `diag+1782790395@example.com` | `Diag User` | yes | yes |

## Decision Required

The owner must select which email is the Primary Operator identity before
credential recovery can continue.

If none of these records is the intended Primary Operator, the next step is a
controlled Primary identity redeclaration/remediation gate. Do not create a
random new identity and do not restore public signup.

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
- Env changed: false
- Package/dependency changed: false
- Deploy performed: false
- Vercel changed: false
- Hermes/MCP/autonomy activated: false

## Next Required Gate

`WO-AUTH-006P — Primary Identity Declaration / Owner Selection`

The next gate should record the owner-confirmed Primary email and then resume
controlled credential recovery and owner access proof.
