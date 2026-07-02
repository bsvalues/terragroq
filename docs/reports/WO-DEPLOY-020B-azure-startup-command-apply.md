# WO-DEPLOY-020B Azure Startup Command Apply and Route Verification

## Result

PARTIAL / STARTUP COMMAND APPLIED.

The Azure App Service startup command was set to `node server.js` on the
existing proof App Service. This repaired the worker launch path enough for
native WilliamOS shell routes to serve from Azure. `/goal-console`, `/operator`,
`/runtime`, and `/work-orders` now return 200 on the Azure default hostname.

The proof is not production-ready. `/` still times out and `/api/health` plus
`/api/auth/readiness` still return 503. No database URL or connection string is
configured, so readiness limitations remain expected.

## Approved Boundary

Approved:

- apply Azure startup command `node server.js`
- verify routes
- collect logs/evidence if startup fails
- rollback by clearing startup command if required

Blocked and preserved:

- no app setting changes beyond the startup command
- no secrets
- no connection strings
- no database URLs
- no new artifact deploy
- no DNS change
- no Vercel change
- no production cutover
- no GitHub settings/rules changes
- no package/code/runtime behavior changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy
- no release/tag
- no production-write behavior outside the approved Azure proof startup-command
  change

## Azure Target

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |

## Startup Command

| Field | Value |
| --- | --- |
| Previous startup command | empty |
| Applied startup command | `node server.js` |
| Expected working directory | `/home/site/wwwroot` |
| Rollback command posture | clear startup command back to empty |
| Rollback applied | no |

## Azure Configuration After Change

| Check | Result |
| --- | --- |
| App settings | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` |
| Connection strings | 0 |
| `linuxFxVersion` | `NODE|22-lts` |
| Startup command | `node server.js` |
| Always On | false |

Secret values are intentionally not recorded.

## Azure Route Results

Required route checks:

| Route | Result |
| --- | --- |
| `/` | timeout |
| `/goal-console` | 200 |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |

Additional shell route checks:

| Route | Result |
| --- | --- |
| `/operator` | 200 |
| `/runtime` | 200 |
| `/work-orders` | 200 |

## Production Verification

Canonical Vercel production remained healthy and unchanged.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |
| `https://terragroq.vercel.app/goal-console` | 200 |
| `x-powered-by` | absent |

## Validation

| Check | Result |
| --- | --- |
| `git diff --check` | passed |
| `npm test -- --run` | 437 passed |
| `npm run build` | passed |

## Finding

The startup command was the correct worker launch repair for Azure App Service
Linux. It proves the standalone artifact can serve WilliamOS shell routes on the
Azure proof app.

The remaining failures are no longer the launch path:

- `/api/health` remains 503 because no database/readiness configuration is
  present.
- `/api/auth/readiness` remains 503 because full runtime readiness dependencies
  are not configured.
- `/` times out and needs root-route dependency analysis before Azure can be
  considered a usable proof surface.

## Safety Rollup

| Gate | Result |
| --- | --- |
| Startup command changed | yes, `node server.js` |
| New deploy attempted | no |
| App settings changed | no |
| Secrets configured | no new secrets |
| Connection strings changed | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| GitHub settings/rules changed | no |
| Package/code/runtime behavior changed | no |
| DB/schema changed | no |
| Auth/access behavior changed | no |
| Hermes/MCP/autonomy changed | no |
| Rollback applied | no |

## Next Recommended Work Order

`WO-DEPLOY-021A - Azure Root and Readiness Dependency Gate`

Purpose:

Determine why `/` times out and what minimum non-production database/readiness
configuration would be required for `/api/health` and `/api/auth/readiness` to
pass on Azure.

Alternative:

`WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate` if cost containment is
more important than continuing the Azure proof.
