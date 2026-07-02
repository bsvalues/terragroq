# WO-DEPLOY-022A Azure Database Dependency Authority Gate

## Result

PASS / OWNER DECISION GATE.

This work order does not grant database authority and does not mutate Azure. It
defines the decision the Primary must make before Azure receives the database
dependency required for green readiness.

## Base

`origin/main = 3537bd3bab77e4fd6cc263c33660d113c56f776a`

## Current State

WO-DEPLOY-021B established the root cause:

- Azure App Service starts with `node server.js`.
- Azure shell routes render successfully.
- Azure `/api/health` returns structured 503.
- Azure `/api/auth/readiness` returns structured 503.
- The failing dependency is missing `DATABASE_URL`.
- No remediation has been applied.

Current Azure proof app:

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| Startup command | `node server.js` |

Current known Azure app setting names:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`

Current connection strings: 0.

Secret values are intentionally not recorded.

## Decision 1: Should Azure Be Connected to a Database Now?

Recommended answer: not automatically.

Azure should be connected to a database only if the owner explicitly wants the
proof to move from platform/startup proof to runtime-readiness proof.

Approve database connection now if:

- the proof needs `/api/health` and `/api/auth/readiness` to pass on Azure
- a non-production database is available
- the database schema posture is known
- secret handling is approved
- rollback is acceptable
- ongoing Azure proof cost is acceptable

Reject or defer database connection if:

- Azure shell proof is sufficient for now
- no non-production database is ready
- the database would require schema migration
- the only available credential is production
- cost control or cleanup is higher priority

## Decision 2: Which Database Is Authorized for Azure?

Only one of these should be selected:

| Option | Description | Status |
| --- | --- | --- |
| Existing non-production Postgres | Use an already approved staging/proof Postgres database. | Allowed only with explicit owner-provided secret out-of-band. |
| New Azure PostgreSQL proof database | Create a dedicated Azure proof database. | Requires a separate DB provisioning gate. |
| Production database | Use the canonical production database. | Blocked unless a production migration/cutover WO explicitly approves it. |
| No database | Keep Azure shell-only. | Safe default if readiness proof is not required now. |

Recommended default: no database until the owner either identifies an existing
non-production Postgres target or approves a separate Azure PostgreSQL proof
provisioning gate.

## Decision 3: App Setting or Connection String?

Recommended answer: app setting.

The current application reads `process.env.DATABASE_URL`. Therefore the exact
required configuration name is:

`DATABASE_URL`

Use an Azure App Service app setting named `DATABASE_URL` for the next proof.
Do not use Azure connection strings unless a separate code/runtime work order
adds explicit support for reading Azure connection string environment variables
and mapping them to the app's database configuration.

| Choice | Recommended | Reason |
| --- | --- | --- |
| App setting `DATABASE_URL` | yes | Matches current code path with no runtime code change. |
| Azure connection string | no | Current code does not read it as `DATABASE_URL`. |
| Key Vault reference as app setting value | future/durable | Better durable posture, but requires a separate Key Vault/access decision. |

## Decision 4: Exact Validation That Proves Success

Post-remediation success requires all checks below.

Azure default hostname:

| Route | Expected |
| --- | --- |
| `/` | 200 |
| `/goal-console` | 200 |
| `/operator` | 200 |
| `/runtime` | 200 |
| `/work-orders` | 200 |
| `/api/health` | 200 with database/auth/runtime healthy |
| `/api/auth/readiness` | 200 with `ready: true`, `databaseReady: true`, `authReady: true` |

Azure configuration evidence:

- app setting names include `DATABASE_URL`
- secret value is not printed
- connection string count remains unchanged unless separately authorized
- no DNS, Vercel, production cutover, DB schema, auth/access, or Hermes/MCP
  changes occur

Canonical production must remain unchanged:

| Route | Expected |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |
| `https://terragroq.vercel.app/goal-console` | 200 |
| `x-powered-by` | absent |

## Decision 5: Rollback to Pre-Fix State

If Azure database remediation is approved later and must be rolled back:

1. Remove only the Azure App Service app setting named `DATABASE_URL`.
2. Restart the proof App Service only if Azure requires it for the setting change
   to take effect.
3. Verify shell routes still return 200.
4. Verify `/api/health` and `/api/auth/readiness` return the expected structured
   503 database-missing posture.
5. Verify canonical production remains 200 and unchanged.
6. Record only setting names and route results. Do not record secret values.

Rollback must not:

- change DNS
- change Vercel
- cut over production
- change GitHub rules
- change packages or runtime code
- run DB migrations
- change auth/access behavior
- activate Hermes/MCP/autonomy
- create releases or tags

## Decision 6: What Remains Blocked Until Owner Approval?

Blocked until explicit owner approval:

- setting Azure `DATABASE_URL`
- creating a new Azure PostgreSQL database
- using any existing database credential
- using production database credentials
- changing Azure connection strings
- changing app settings beyond an approved database setting
- creating Key Vault resources or references
- changing schema or running migrations
- deploying a new artifact
- changing DNS, Vercel, or production traffic
- changing auth/access behavior
- changing packages or runtime code
- activating Hermes/MCP/autonomy
- release or tag work

## Decision Matrix

| Path | What happens | Pros | Risks | Next WO |
| --- | --- | --- | --- | --- |
| A. Existing non-production `DATABASE_URL` | Configure Azure app setting from an owner-provided non-production secret. | Fastest path to green Azure readiness. | Secret handling, database reachability, schema drift. | `WO-DEPLOY-022B` |
| B. New Azure PostgreSQL proof | Create a dedicated proof DB, then configure `DATABASE_URL`. | Clean isolation and Azure-native proof. | More cost, provisioning, firewall, schema authority required. | `WO-DEPLOY-023A` |
| C. Shell-only Azure proof | Do nothing to DB. Keep Azure shell routes as proof. | Safest and lowest mutation. | API readiness remains 503. | `WO-DEPLOY-014C` or next deploy design gate |
| D. Cleanup Azure proof | Stop or remove proof resources. | Controls cost and stops drift. | Pauses Azure migration proof. | `WO-DEPLOY-014C` |

Recommended next decision: choose C or D unless the owner has a clearly
identified non-production Postgres target. If runtime-readiness proof is now the
priority, choose A with a non-production database only.

## Secret-Handling Rules

Mandatory:

- do not print database URL values
- do not commit secret values
- do not paste secret values into PR descriptions, reports, logs, or chat
- report setting names and presence only
- use out-of-band secret transfer if Option A is approved
- rotate any accidentally exposed credential
- do not use production credentials unless a separate production authority gate
  approves it

## Explicit Non-Mutation Statement

This work order does not grant database authority.

No Azure app setting was changed. No connection string was changed. No database
was created. No migration was run. No deployment was attempted. No secret value
was disclosed.

## Next Recommended Work Order

Owner must choose one:

- `WO-DEPLOY-022B - Azure Existing Non-Production DATABASE_URL Apply Gate`
- `WO-DEPLOY-023A - Azure PostgreSQL Proof Provisioning Gate`
- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

No Azure database dependency should be configured without explicit owner
approval.
