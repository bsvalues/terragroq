# WO-DEPLOY-018B Azure Minimal Runtime Env Gate

## Result

OWNER DECISION REQUIRED.

This gate defines the minimum runtime environment posture required before the
Azure App Service proof app can receive another repaired standalone artifact.
It does not authorize Azure app settings, secret creation, Key Vault creation,
deployment, DNS changes, Vercel changes, production cutover, GitHub settings
changes, package/runtime changes, DB/schema changes, auth/access behavior
changes, or Hermes/MCP/autonomy.

No secret values are included in this document.

## Context

`WO-DEPLOY-018A` proved the Azure packaging path:

- Next.js standalone output is enabled.
- A sanitized standalone artifact can be generated.
- The artifact contains no `.env*` files.
- UI routes can serve when a disposable local placeholder auth secret is present.
- True no-secret startup emits Better Auth runtime errors because
  `BETTER_AUTH_SECRET` is required.

The current blocker is no longer Azure artifact delivery or standalone
packaging. The blocker is the minimum runtime environment required for startup.

## Current Azure Proof State

| Item | State |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| App settings | none |
| Connection strings | none |
| Startup command | empty |
| DNS | unchanged |
| Vercel | unchanged |
| Production cutover | none |

## Minimal Env Sets

### Set 0 - No Env

Status: proven insufficient.

| Variable | Posture |
| --- | --- |
| `BETTER_AUTH_SECRET` | absent |
| `BETTER_AUTH_URL` | absent |
| `BETTER_AUTH_TRUSTED_ORIGINS` | absent |
| `DATABASE_URL` | absent |

Expected result:

- server may start at process level
- Better Auth emits runtime errors
- Azure startup/readiness remains unreliable
- `/api/health` and `/api/auth/readiness` do not pass

Set 0 should not be used for another Azure deploy because it would reproduce the
known startup gate.

### Set A - Startup-Only Proof

Purpose: prove the repaired standalone artifact can boot and serve UI routes on
Azure without production data access.

Required variable names:

| Variable | Value Type | Secret | Production Value Allowed? | Purpose |
| --- | --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | non-production proof secret | yes | no | satisfy Better Auth startup requirement |
| `BETTER_AUTH_URL` | Azure default hostname | no | no | align auth origin with proof hostname |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Azure default hostname | no | no | keep origin diagnostics explicit |

Explicitly excluded:

- `DATABASE_URL`
- `POSTGRES_URL`
- provider API keys
- Email OTP settings
- access grant token pepper
- social provider secrets
- production auth secrets

Expected result:

- Azure default hostname should serve UI routes
- `/` should return 200
- `/goal-console` should return 200 if auth/session posture allows public shell
  rendering
- `/api/health` may remain 503 if database readiness is required
- `/api/auth/readiness` should report missing database/readiness dependencies if
  those remain unconfigured

Set A is the recommended next proof posture because it tests startup and serving
without migrating production secrets or data access.

### Set B - Minimal Readiness Proof

Purpose: prove Azure can return health/readiness successfully.

Additional required variable names:

| Variable | Value Type | Secret | Production Value Allowed? | Purpose |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` or approved equivalent | non-production database URL | yes | no unless separately approved | health/readiness database checks |

Expected result:

- `/api/health` can return 200
- `/api/auth/readiness` can return 200 only if auth/database policy is satisfied
- still no Email OTP, access grants, social login, or production cutover

Set B is not recommended until the owner explicitly approves a database posture
for Azure proof. It may require separate database provisioning, network access,
or secret handling decisions.

### Set C - Production-Like Env

Status: blocked.

This would involve production secrets, production database access, provider
keys, DNS, or production origin changes. It is not authorized for the Azure
proof lane.

## Placeholder vs Real Secret Policy

| Secret Class | Allowed Now? | Notes |
| --- | --- | --- |
| Disposable local placeholder secret | already used locally only | never commit, never deploy as production |
| Non-production Azure proof `BETTER_AUTH_SECRET` | owner decision required | may be acceptable for Set A |
| Production `BETTER_AUTH_SECRET` | no | requires separate production migration gate |
| Production database URL | no | requires separate DB/env/cutover gate |
| Provider API keys | no | out of scope |
| Access grant token pepper | no | access grants remain disabled |

Rules:

- do not print secret values in terminal output, docs, PRs, screenshots, or logs
- record variable names and presence only
- do not reuse production secrets for a proof app
- do not commit `.env*` files
- rotate any secret that is accidentally disclosed

## App Service Settings Plan

If Set A is approved, the next implementation WO may configure only:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`

Recommended proof values:

| Variable | Recommended Proof Posture |
| --- | --- |
| `BETTER_AUTH_SECRET` | owner-provided non-production random secret; value never printed |
| `BETTER_AUTH_URL` | `https://williamos-proof-westus2.azurewebsites.net` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `https://williamos-proof-westus2.azurewebsites.net` |

Blocked App Service settings:

- any production database URL
- any production auth secret
- Email OTP provider settings
- access grant settings
- social provider settings
- Groq/xAI/provider keys
- feature-enablement settings not needed for startup

## Key Vault Decision

Recommended now: defer Key Vault for Set A.

Reason:

- Set A is a short-lived startup proof, not production migration.
- Key Vault introduces managed identity, RBAC, secret lifecycle, and IaC design
  work that should be handled in a separate hardening lane.

Key Vault should be required before:

- production-like secrets
- long-lived staging
- database credentials
- provider API keys
- any migration away from proof-only posture

## Validation Plan For Next Approved WO

Before deployment:

1. Confirm owner-approved env set.
2. Confirm no production secret values are used.
3. Configure only approved App Service settings.
4. Build with `npm run build`.
5. Generate artifact with `scripts/build_azure_standalone_artifact.ps1`.
6. Confirm artifact has zero `.env*` files.

After deployment:

1. Verify Azure root route.
2. Verify `/goal-console`.
3. Verify `/api/health`.
4. Verify `/api/auth/readiness`.
5. Record route results and expected limitations.
6. Confirm DNS and Vercel remain unchanged.
7. Confirm no production cutover occurred.

## Rollback / Removal Plan

If Set A is approved and fails:

1. remove only the proof App Service settings added in that WO
2. leave DNS and Vercel unchanged
3. leave production unchanged
4. record Azure logs in sanitized form
5. decide between startup-command repair, database/readiness gate, or cleanup

If cost containment is required:

- proceed to `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Go / No-Go Table

| Gate | Current Status |
| --- | --- |
| No-env proof sufficient | no |
| Set A startup-only proof recommended | yes |
| Set A authorized | pending owner decision |
| Set B readiness proof authorized | no |
| Production-like env authorized | no |
| Key Vault required before Set A | no, recommended defer |
| Azure app settings authorized | no |
| New Azure deploy authorized | no |
| DNS/Vercel/cutover authorized | no |

## Owner Decision Block

```text
OWNER_DECISION:
Approve Azure Set A startup-only proof: YES/NO
Allow App Service settings for Set A only: YES/NO
BETTER_AUTH_SECRET source: owner-provided non-production value / generate in Azure-safe command / no
Allow BETTER_AUTH_URL proof hostname: YES/NO
Allow BETTER_AUTH_TRUSTED_ORIGINS proof hostname: YES/NO
Require Key Vault before Set A: YES/NO
Approve Azure repair redeploy after Set A settings: YES/NO
Allow DATABASE_URL or readiness DB config: NO unless separately approved
Allow production secrets: NO
Allow DNS/Vercel/cutover: NO
Next authorized WO:
```

## Next Work Order Split

If Set A is approved:

- `WO-DEPLOY-019A - Azure Startup Env Configuration + Repair Redeploy`

If owner wants Key Vault before any App Service secret:

- `WO-DEPLOY-019K - Azure Key Vault Proof Gate`

If owner wants readiness to pass, not just startup:

- `WO-DEPLOY-019B - Azure Database/Readiness Env Gate`

If cost containment is preferred:

- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Explicitly Not Authorized

This gate does not authorize:

- Azure app setting changes
- secret creation
- real secret values
- Key Vault creation
- new Azure deploy
- DNS changes
- Vercel changes
- production cutover
- GitHub settings/rules changes
- package/code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior
