# WO-DEPLOY-012B Azure App Service Env and Secret Gate

## Result

OWNER DECISION REQUIRED.

This gate defines how WilliamOS/TerraGroq environment variables and secrets
would be handled for a future Azure App Service proof. It does not authorize
Azure login, Azure resource creation, deployment, env creation, secret creation,
DNS changes, Vercel changes, GitHub settings changes, or production changes.

No secret values are included in this document.

## Purpose

Before Azure App Service provisioning or deployment, the owner must decide:

1. which environment variables are required for a meaningful proof
2. which variables must remain disabled
3. whether the proof may use App Service app settings
4. whether Key Vault is deferred or required
5. whether the proof is allowed to reach `ready:true`
6. whether any production-like secrets may be migrated
7. what must remain blocked

## Recommended Default

Default posture: no real secret migration for first provisioning.

The first Azure App Service proof should be allowed to create infrastructure
only after approval, but it should not receive production secrets until a
separate owner env authorization is explicit.

If the owner wants to prove full auth/database readiness on Azure, approve a
minimal env set in this gate or a follow-up gate.

## Env Classification

| Name | Required for Build | Required for Runtime Ready | Secret | Default Azure Proof Posture |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | no | yes | yes | blocked until owner env approval |
| `BETTER_AUTH_SECRET` | no | yes | yes | blocked until owner env approval |
| `BETTER_AUTH_URL` | no | yes | no | set only after proof hostname exists |
| `BETTER_AUTH_TRUSTED_ORIGINS` | no | yes | no | set only after proof hostname exists |
| `LOCAL_SETUP_ENABLED` | no | policy-dependent | no | keep false/disabled in proof |
| `AUTH_SIGNUP_MODE` | no | yes | no | keep bootstrap/locked posture |
| `GROQ_API_KEY` | no | no for current proof | yes | do not migrate; legacy/provider posture needs separate cleanup |
| `AUTH_EMAIL_OTP_ENABLED` | no | no | no | keep false/unset |
| `RESEND_API_KEY` | no | no | yes | do not configure |
| `AUTH_EMAIL_FROM` | no | no | no | do not configure |
| `AUTH_EMAIL_REPLY_TO` | no | no | no | do not configure |
| `ACCESS_GRANTS_ENABLED` | no | no | no | keep false/unset |
| `ACCESS_GRANT_TOKEN_PEPPER` | no | no | yes | do not configure |
| Social provider secrets | no | no | yes | do not configure |

## Required Minimal Env Sets

### Set A - Infrastructure-only proof

Purpose: provision App Service resources and prove the app artifact can start
only if the platform does not require runtime secrets.

Expected readiness:

- build may pass
- startup may fail if required runtime env is absent
- `/api/auth/readiness` may report missing config

Allowed variables:

- `BETTER_AUTH_URL` only after proof hostname exists, if needed
- `BETTER_AUTH_TRUSTED_ORIGINS` only after proof hostname exists, if needed
- non-secret diagnostics values only

Blocked variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- provider API keys
- access grant secrets

### Set B - Minimal readiness proof

Purpose: prove `/api/health` and `/api/auth/readiness` can pass on Azure.

Requires owner approval for:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `AUTH_SIGNUP_MODE`

Expected readiness:

- `/api/health`: 200 ok
- `/api/auth/readiness`: 200 ready:true
- signup remains bootstrap-locked if operator exists
- access grants remain disabled
- Email OTP remains disabled

### Set C - Extended feature proof

Not recommended now.

Would involve provider secrets or feature-enablement variables such as Email OTP,
access grants, or social auth. These remain blocked unless a separate owner gate
authorizes them.

## App Service Settings vs Key Vault

| Option | Use Now? | Fit | Notes |
| --- | --- | --- | --- |
| App Service app settings | maybe | simplest first proof | acceptable for limited proof if owner approves each variable |
| Key Vault references | defer | stronger long-term posture | requires Key Vault resource, identity, RBAC, and secret lifecycle decisions |
| GitHub Actions secrets | no | future CI/CD only | do not create until deployment automation is approved |
| Committed env files | never | not allowed | no secret values in git |

Recommended path:

1. First provisioning: no real secrets.
2. Readiness proof: owner-approved minimal App Service settings.
3. Later hardening: Key Vault + managed identity + RBAC review.

## Secret Handling Rules

Rules:

- never print secret values in logs, PRs, docs, screenshots, or comments
- never commit `.env.local` or production env files
- record variable names and presence only
- use owner-provided values only in approved Azure settings surfaces
- rotate any value that was ever accidentally committed or disclosed
- prefer managed identity and Key Vault for durable Azure posture
- do not reuse example credential-like values from older TerraFusion docs

If a secret-like value is discovered:

1. do not copy it
2. record only path and variable/key name
3. recommend owner review and rotation if it appears real
4. stop before provisioning if the value is required

## Auth and Access Safety Rules

The Azure proof must preserve:

- no public signup reopening
- bootstrap/invite posture unchanged
- Email OTP disabled unless separately authorized
- access grants disabled unless separately authorized
- no social login configuration
- no auth provider secret setup
- no access grant token pepper setup

## DNS and Origin Rules

Default posture:

- use Azure default hostname only
- do not change DNS
- do not alter Vercel aliases
- do not cut over production traffic

If a proof hostname exists later, then `BETTER_AUTH_URL` and
`BETTER_AUTH_TRUSTED_ORIGINS` must be updated only under explicit env approval.

## Owner Input Checklist

| Input | Owner Answer |
| --- | --- |
| Allow any Azure env variables now? | Pending |
| Env set approved | Set A / Set B / Set C / none |
| Allow `DATABASE_URL` migration? | Pending |
| Allow `BETTER_AUTH_SECRET` migration? | Pending |
| Allow proof `BETTER_AUTH_URL`? | Pending |
| Allow proof `BETTER_AUTH_TRUSTED_ORIGINS`? | Pending |
| Allow App Service app settings? | Pending |
| Require Key Vault before secrets? | Pending |
| Allow Email OTP config? | NO recommended |
| Allow access grant secrets? | NO recommended |
| Allow social provider secrets? | NO recommended |
| Allow DNS changes? | NO recommended |

## Go / No-Go Table

| Gate | Current Status |
| --- | --- |
| Azure env migration authorized | Not approved |
| Secret values available to agent | Not approved |
| App Service settings authorized | Not approved |
| Key Vault resource authorized | Not approved |
| Database connection migration authorized | Not approved |
| Auth secret migration authorized | Not approved |
| DNS/origin change authorized | Not approved |
| Email OTP enablement authorized | Not approved |
| Access grants enablement authorized | Not approved |
| Social login enablement authorized | Not approved |

## Stop Conditions

Stop if:

- provisioning requires real secrets but env set is not approved
- a secret value appears in git, logs, PRs, docs, or terminal output
- Azure readiness requires auth/access behavior changes
- Azure readiness requires DB/schema changes
- Azure readiness requires provider setup
- Azure readiness requires DNS or Vercel changes
- Azure readiness requires package/runtime code changes
- Azure readiness requires Hermes/MCP/autonomy

## Next Work Order Split

If owner approves provisioning with no env migration:

- WO-DEPLOY-012A - Azure App Service Proof Provisioning

If owner approves minimal env readiness proof:

- WO-DEPLOY-012A - Azure App Service Proof Provisioning, followed by
  WO-DEPLOY-013A - Azure App Service Minimal Env Configuration

If owner requires Key Vault before any secret:

- WO-DEPLOY-012C - Azure Key Vault Proof Design Packet

If owner defers Azure:

- WO-DEPLOY-012D - Azure Proof Hold / Product Work Resume Packet

## Explicitly Not Authorized

This packet does not authorize:

- Azure login/access
- Azure resource creation
- deployment
- DNS changes
- Vercel changes
- env secret creation or migration
- GitHub settings/rules changes
- package/dependency changes
- code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior
- secret disclosure

## Owner Decision Block

```text
OWNER_DECISION:
Azure env migration approved: YES/NO
Approved env set: none / Set A / Set B / Set C
Allow App Service app settings: YES/NO
Require Key Vault before secrets: YES/NO
Allow DATABASE_URL migration: YES/NO
Allow BETTER_AUTH_SECRET migration: YES/NO
Allow BETTER_AUTH_URL for proof hostname: YES/NO
Allow BETTER_AUTH_TRUSTED_ORIGINS for proof hostname: YES/NO
Allow Email OTP config: NO unless separately approved
Allow access grant secrets: NO unless separately approved
Allow social provider secrets: NO unless separately approved
Allow DNS changes: NO unless separately approved
Allow Vercel changes: NO unless separately approved
Next authorized WO:
```
