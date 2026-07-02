# WO-DEPLOY-021A Azure Root and Readiness Dependency Gate

## Result

PASS.

Azure shell and root routes now render from the proof App Service. The remaining
Azure failures are isolated to readiness endpoints that intentionally require
database readiness.

`/api/health` and `/api/auth/readiness` return 503 because `DATABASE_URL` is not
configured on the Azure proof app. The response bodies identify database
readiness as the failing dependency. Auth startup settings are present and auth
readiness is true.

## Base

`origin/main = 03aee152e88ffb051cf4a5bb1485f80d57d1bdce`

## Approved Boundary

Allowed:

- read-only Azure route checks
- read-only server/startup inspection
- read-only env/config presence checks by name only
- inspect health/readiness route code
- inspect standalone server routing behavior
- add narrow diagnostic docs/tests if needed
- no secret values printed

Blocked and preserved:

- no new Azure deploy
- no DNS/cutover
- no Vercel change
- no app setting changes
- no connection string changes
- no secret changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy changes
- no rollback

## Azure Target

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| Startup command | `node server.js` |

## Azure Configuration Names

| Category | Result |
| --- | --- |
| App setting names | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` |
| Connection strings | 0 |
| Secret values disclosed | no |

No secret values were printed or recorded.

## Azure Route Proof

| Route | Result |
| --- | --- |
| `/` | 200 |
| `/goal-console` | 200 |
| `/operator` | 200 |
| `/runtime` | 200 |
| `/work-orders` | 200 |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |

The shell route results prove the standalone server starts and serves the
WilliamOS UI from Azure. The API failures are dependency readiness failures, not
a general server launch failure.

## Azure API Failure Cause

`/api/health` calls `getAuthReadiness({ probeDatabase: true })` and returns 503
when `readiness.ready` is false. In Azure, the response body reports:

- `status: degraded`
- database check `ok: false`
- database detail: `DATABASE_URL is not configured.`
- auth check `ok: true`
- runtime check `ok: true`

`/api/auth/readiness` also calls `getAuthReadiness({ probeDatabase: true })` and
returns 503 when `readiness.ready` is false. In Azure, the response body reports:

- `ready: false`
- `databaseReady: false`
- `authReady: true`
- database URL check fails

The implementation confirms this behavior:

- `app/api/health/route.ts` returns 503 when full readiness is false.
- `app/api/auth/readiness/route.ts` returns 503 when auth readiness is not fully
  ready.
- `lib/auth-readiness.ts` marks database readiness false when `DATABASE_URL` is
  missing or unreachable.

## Standalone Routing Finding

Standalone `node server.js` routes Next pages and API handlers correctly. This is
supported by:

- root route returning 200
- shell routes returning 200
- API routes returning structured JSON responses rather than 404 or process
  startup failures

The remaining readiness 503s are expected until a separate owner-approved gate
decides whether to configure a non-production database URL or adjust the Azure
proof readiness posture.

## Canonical Production Verification

Canonical production remained healthy and unchanged.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |
| `https://terragroq.vercel.app/goal-console` | 200 |
| `x-powered-by` | absent |

## Validation

| Check | Result |
| --- | --- |
| Focused readiness tests | 24 passed |
| `git diff --check` | passed |
| `npm test -- --run` | 437 passed |
| `npm run build` | passed after clearing stale generated `.next` output |

## Safety Rollup

| Gate | Result |
| --- | --- |
| App settings changed | no |
| Connection strings changed | no |
| Secrets configured | no |
| Secret values disclosed | no |
| New Azure deploy attempted | no |
| Rollback applied | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| DB/schema changed | no |
| Auth/access behavior changed | no |
| Hermes/MCP/autonomy changed | no |

## Next Recommended Work Order

`WO-DEPLOY-021B - Azure Readiness Remediation Packet`

Purpose:

Decide how to proceed now that Azure shell routes work but readiness endpoints
require database configuration. The next gate should choose between:

- configure a non-production Azure proof `DATABASE_URL`
- keep readiness 503 as accepted for a shell-only Azure proof
- create a separate Azure database proof gate
- stop/cleanup Azure proof resources to control cost

No readiness remediation should occur without explicit owner authorization.
