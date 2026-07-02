# WO-DEPLOY-020A Azure Startup Command Gate

## Result

OWNER DECISION REQUIRED.

This gate defines whether the existing Azure proof App Service should receive an
explicit startup command for the standalone Next.js artifact. It does not
authorize changing the startup command, mutating Azure configuration, deploying
again, changing app settings, configuring secrets or connection strings, DNS
changes, Vercel changes, production cutover, GitHub settings/rules changes,
package/code/runtime behavior changes, DB/schema changes, auth/access behavior
changes, Hermes/MCP/autonomy, release, tag, or production-write behavior beyond
the existing Azure proof resources.

## Context

`WO-DEPLOY-019A` advanced the Azure proof:

- approved Set A app settings were configured
- no production secrets were used
- no database URL or connection string was configured
- the cleaned standalone artifact was accepted by Azure OneDeploy
- deployment `3d889c1c-a7e6-46be-b4ae-31bf761d3928` became active
- the App Service worker still failed startup within Azure's startup window

The remaining blocker appears to be the App Service Linux process launch path,
not artifact acceptance or the Better Auth startup secret gate.

## Current Azure Proof State

| Item | State |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| App settings | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` |
| Connection strings | 0 |
| Startup command | empty |
| Always On | false |
| Active deployment | `3d889c1c-a7e6-46be-b4ae-31bf761d3928` |

Secret values are intentionally not recorded.

## Deployed Artifact Expectations

The standalone artifact is expected to deploy under:

```text
/home/site/wwwroot
```

Expected key files:

```text
/home/site/wwwroot/server.js
/home/site/wwwroot/package.json
/home/site/wwwroot/.next/static
/home/site/wwwroot/node_modules
```

The local proof artifact starts with:

```text
node server.js
```

when Set A-equivalent environment variables are present.

## Recommended Startup Command

Recommended command:

```text
node server.js
```

Reason:

- Next.js standalone output emits `server.js` as the portable server entry point.
- The local cleaned artifact serves `/` and `/goal-console` with Set
  A-equivalent proof config using `node server.js`.
- App Service currently has an empty startup command and is relying on platform
  inference. That inference is not successfully launching the standalone app.

Expected working directory:

```text
/home/site/wwwroot
```

Do not add command-line secrets or inline env values.

## Alternatives Considered

| Option | Recommendation | Reason |
| --- | --- | --- |
| `node server.js` | recommended | direct standalone server entry point |
| `npm start` | not recommended now | package script is generic `next start`; standalone output should not rely on `next start` |
| `node .next/standalone/server.js` | not recommended for current artifact | current artifact root already contains `server.js` |
| PM2 command | defer | adds process-manager assumptions not needed for first proof |
| Containerize | defer | larger deployment model decision |
| Oryx build-on-deploy | defer | current path already deploys a built standalone artifact |

## Validation Plan For Approved WO

If the owner approves startup command mutation:

1. Confirm current App Service target:
   - subscription `b345d747-5953-4468-a1c7-18164d6f26e4`
   - resource group `rg-williamos-proof-westus2`
   - app `williamos-proof-westus2`
2. Confirm Set A app settings are still exactly:
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL`
   - `BETTER_AUTH_TRUSTED_ORIGINS`
3. Set startup command to:
   - `node server.js`
4. Restart the proof App Service if Azure does not recycle it automatically.
5. Do not redeploy unless explicitly included in the approved WO.
6. Verify:
   - `/`
   - `/goal-console`
   - `/api/health`
   - `/api/auth/readiness`
7. Record expected readiness limitations:
   - `/api/health` may remain 503 without database configuration
   - `/api/auth/readiness` may remain not-ready without database configuration
8. Verify canonical Vercel production remains healthy.
9. Confirm DNS and Vercel remain unchanged.

## Rollback Plan

Rollback command posture:

```text
clear Azure startup command back to empty
```

Rollback validation:

1. Confirm startup command is empty.
2. Confirm Set A app settings remain present unless owner separately approves
   cleanup.
3. Confirm no connection strings were added.
4. Confirm DNS and Vercel remain unchanged.
5. Record Azure route state after rollback.

If cost containment is desired instead of continued repair:

- use `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Stop Conditions

Stop before mutation if:

- the active subscription/resource group/app does not match the proof target
- Set A app setting names are not exactly as expected
- Azure requires new secrets, database URLs, or connection strings
- Azure requires DNS/Vercel/cutover changes
- Azure requires package/code/runtime behavior changes
- Azure requires DB/schema/auth/access behavior changes
- startup command would need inline secret values
- proof app cost/risk should be stopped instead

Stop after mutation if:

- `/` and `/goal-console` still do not serve
- logs show missing dependencies or wrong working directory
- Azure routes indicate a database/readiness gate rather than a startup gate
- any unexpected production/Vercel impact appears

## Owner Decision Block

```text
OWNER_DECISION:
Approve setting Azure startup command: YES/NO
Approved startup command: node server.js
Allow App Service restart if needed: YES/NO
Allow redeploy in same WO: NO unless separately approved
Allow app setting changes: NO
Allow connection strings/database URLs: NO
Allow DNS/Vercel/production cutover: NO
Allow package/code/runtime changes: NO
Allow DB/schema/auth/access changes: NO
Next authorized WO:
```

## Next Work Order Split

If approved:

- `WO-DEPLOY-020B - Azure Startup Command Apply + Route Verification`

If startup command should remain blocked:

- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

If the owner wants a durable production-grade Azure path before more portal/CLI
mutation:

- `WO-DEPLOY-021A - Azure App Service IaC/Provenance Gate`

## Explicitly Not Authorized

This gate does not authorize:

- Azure startup command changes
- Azure configuration mutation
- new deploys
- app setting changes
- secrets
- connection strings
- DNS changes
- Vercel changes
- production cutover
- GitHub settings/rules changes
- package/code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior beyond the existing Azure proof resources
