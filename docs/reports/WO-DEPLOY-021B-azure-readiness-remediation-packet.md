# WO-DEPLOY-021B Azure Readiness Remediation Packet

## Result

PASS / OWNER DECISION GATE.

This work order does not remediate Azure readiness. It defines the owner
authority required before configuring the database dependency that would allow
Azure `/api/health` and `/api/auth/readiness` to become green.

## Base

`origin/main = 4bd35365ac3495e63396dc9d75f773de210274e8`

## Current Azure Proof

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| Startup command | `node server.js` |

Current route posture:

| Route | Result |
| --- | --- |
| `/` | 200 |
| `/goal-console` | 200 |
| `/operator` | 200 |
| `/runtime` | 200 |
| `/work-orders` | 200 |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |

Current Azure configuration names:

| Category | Result |
| --- | --- |
| App settings | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` |
| Connection strings | 0 |
| Secret values disclosed | no |

## Root Cause

Azure readiness is degraded because `DATABASE_URL` is not configured.

The route implementations intentionally require database readiness:

- `app/api/health/route.ts` calls `getAuthReadiness({ probeDatabase: true })`
  and returns 503 when full readiness is false.
- `app/api/auth/readiness/route.ts` calls `getAuthReadiness({ probeDatabase:
  true })` and returns 503 when readiness is false.
- `lib/auth-readiness.ts` marks database readiness false when `DATABASE_URL` is
  missing or when the database probe fails.

The Azure response bodies confirm:

- database readiness is false
- auth readiness is true
- runtime readiness is true
- the missing dependency is `DATABASE_URL`

This means the server and standalone routing are working. The remaining failure
is dependency configuration.

## Required Owner Decision

Owner approval is required before any remediation because the next step would
configure a database dependency or intentionally accept shell-only Azure proof
status.

The owner must choose one path:

1. Configure `DATABASE_URL` as an Azure App Service app setting using a
   non-production proof database.
2. Configure an Azure connection string only after code is changed to support it.
3. Keep Azure as shell-only proof and accept readiness 503 until database
   authority is granted.

No option should use production database credentials unless a separate
production-migration work order explicitly authorizes it.

## Option A: Azure `DATABASE_URL` App Setting

Recommended if the next goal is to prove full Azure runtime readiness.

Required setting name:

`DATABASE_URL`

Required properties:

- non-production proof database only
- secret value provided out-of-band
- value never committed to git
- value never printed in logs or reports
- configured as Azure App Service app setting or Key Vault reference after a
  separate owner decision
- database must be reachable from Azure App Service
- database must contain the schema expected by the current app

Expected result after successful configuration:

- `/api/health` returns 200 with database, auth, and runtime checks healthy
- `/api/auth/readiness` returns 200 with `ready: true`
- shell routes remain 200

Risks:

- accidental production database use
- leaking a database URL in shell history, logs, PR comments, or reports
- database network/firewall mismatch
- schema mismatch
- persistent proof resource cost
- confusion between Azure proof readiness and production cutover readiness

Stop conditions:

- value is production credentials
- value appears in command output or logs
- database requires schema migration not separately authorized
- database connectivity fails for network or credential reasons
- remediation requires DNS, Vercel, package, code, auth, or schema changes

## Option B: Azure Connection String

Not recommended for the current code path.

Azure App Service connection strings are not equivalent to `DATABASE_URL` unless
the application reads the corresponding Azure-provided environment variable.
The current readiness code checks `process.env.DATABASE_URL`.

Option B is only viable after a separate code work order that explicitly maps an
Azure connection string name to `DATABASE_URL` semantics. That is blocked in this
packet.

Risks:

- configuring a connection string that does not affect readiness
- creating false confidence that Azure has a database dependency configured
- requiring code/runtime behavior changes outside this work order

Decision posture:

Do not use Option B for WO-DEPLOY-022A unless a prior owner-approved code change
adds explicit support.

## Option C: Keep Azure Shell-Only

Recommended if cost and safety matter more than proving full runtime readiness
right now.

Under this option:

- no database setting is configured
- `/api/health` remains 503
- `/api/auth/readiness` remains 503
- shell routes remain the only proven Azure surface
- the Azure proof is documented as platform/artifact/startup proof, not runtime
  readiness proof

Risks:

- ongoing Azure proof cost without full readiness
- future confusion if shell route 200 is mistaken for full runtime readiness
- inability to use Azure as replacement production until the DB gate is resolved

## Secret Handling Rules

Mandatory rules for any future remediation:

- never print the database URL
- never commit secret values
- never paste secret values into PR descriptions, reports, or chat transcripts
- report only setting names and presence
- prefer Key Vault reference for durable posture if the proof advances beyond
  short-lived staging
- rotate any value that is accidentally exposed
- treat `DATABASE_URL` as a secret even in proof environments

## Rollback Plan

If Option A is later approved and fails:

1. Remove the Azure App Service `DATABASE_URL` app setting.
2. Restart the proof App Service only if required by Azure after the setting
   change.
3. Verify shell routes still return 200.
4. Verify `/api/health` and `/api/auth/readiness` return the expected 503
   database-missing posture.
5. Record the rollback evidence without secret values.

Rollback must not change DNS, Vercel, production traffic, GitHub rules, schema,
auth/access behavior, Hermes/MCP/autonomy, release, or tag state.

## Post-Remediation Validation

Exact routes to verify after a future authorized remediation:

```powershell
$azure = "https://williamos-proof-westus2.azurewebsites.net"
Invoke-WebRequest "$azure/" -UseBasicParsing
Invoke-WebRequest "$azure/goal-console" -UseBasicParsing
Invoke-WebRequest "$azure/operator" -UseBasicParsing
Invoke-WebRequest "$azure/runtime" -UseBasicParsing
Invoke-WebRequest "$azure/work-orders" -UseBasicParsing
Invoke-WebRequest "$azure/api/health" -UseBasicParsing
Invoke-WebRequest "$azure/api/auth/readiness" -UseBasicParsing
```

Exact canonical production routes to verify remain unchanged:

```powershell
Invoke-WebRequest "https://terragroq.vercel.app/api/health" -UseBasicParsing
Invoke-WebRequest "https://terragroq.vercel.app/api/auth/readiness" -UseBasicParsing
Invoke-WebRequest "https://terragroq.vercel.app/goal-console" -UseBasicParsing
```

Azure configuration evidence should report names and counts only:

```powershell
az webapp config appsettings list `
  --subscription "<subscription-id>" `
  --resource-group "rg-williamos-proof-westus2" `
  --name "williamos-proof-westus2" `
  --query "[].name" `
  -o tsv

az webapp config connection-string list `
  --subscription "<subscription-id>" `
  --resource-group "rg-williamos-proof-westus2" `
  --name "williamos-proof-westus2" `
  -o json
```

Do not print setting values.

## Explicit Non-Remediation Statement

This work order does not apply the fix.

No Azure app setting was changed. No `DATABASE_URL` was configured. No
connection string was changed. No database was created. No schema was changed.
No deployment was attempted.

## Next Recommended Work Order

`WO-DEPLOY-022A - Azure Database Dependency Authority Gate`

Purpose:

Obtain an explicit owner decision for one of:

- configure a non-production proof `DATABASE_URL`
- create or select a non-production Azure PostgreSQL dependency
- keep Azure shell-only
- stop/cleanup Azure proof resources

No remediation should proceed without that owner decision.
