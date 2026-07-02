# WO-DEPLOY-019A Azure Startup Env Configuration and Repair Redeploy

## Result

PARTIAL / STOPPED AT STARTUP COMMAND GATE.

The approved Set A startup-only Azure app settings were configured on the
existing proof App Service. A cleaned standalone artifact was generated and
redeployed. Azure OneDeploy accepted the cleaned artifact and marked the second
deployment active, but the App Service worker still failed to start within the
Azure startup window.

No DNS, Vercel, production cutover, database URL, connection string, production
secret, GitHub settings/rules, DB/schema, auth/access behavior, Hermes/MCP,
autonomy, release, or tag changes were made.

## Approved Boundary

Approved:

- configure Set A startup-only proof settings:
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_TRUSTED_ORIGINS`
- use non-production proof values only
- redeploy a standalone no-secret artifact to the existing Azure proof App
  Service
- verify Azure default hostname, `/`, `/goal-console`, `/api/health`, and
  `/api/auth/readiness`

Blocked and preserved:

- no production secrets
- no connection strings
- no database URLs
- no DNS change
- no Vercel change
- no production cutover
- no GitHub settings/rules changes
- no package dependency changes
- no app runtime behavior changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy
- no release/tag
- no production-write behavior outside the approved Azure proof app settings and
  repair deploy

## Azure Target

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |

## Set A App Settings

Configured setting names:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`

Secret values are intentionally not recorded.

Configuration after WO:

| Check | Result |
| --- | --- |
| App settings | exactly the three Set A names |
| Connection strings | 0 |
| `linuxFxVersion` | `NODE|22-lts` |
| Startup command | empty |

## Artifact

Initial standalone artifact:

| Field | Value |
| --- | --- |
| ZIP path | `%TEMP%\williamos-azure-standalone-wo-deploy-019a.zip` |
| Size | 32,743,212 bytes |
| SHA-256 | `5B420829DB33D810D865D933DB1E55AD43859470E05B5504DD4A044D0BE86079` |
| `.env*` files | 0 |

The initial redeploy reached Kudu but returned a deployment error before the new
artifact became active.

Cleaned standalone artifact:

| Field | Value |
| --- | --- |
| ZIP path | `%TEMP%\williamos-azure-standalone-wo-deploy-019a-clean.zip` |
| Size | 17,616,810 bytes |
| SHA-256 | `42E2AB607CB9199A2D2F0B353D93E28671D15B9E667316F3D7D98DDB798B2BBC` |
| `.env*` files | 0 |
| `.pnpm` virtual store in final ZIP | no |
| Local `/` with placeholder Set A config | 200 |
| Local `/goal-console` with placeholder Set A config | 200 |
| Local `/api/health` with no database config | 503 |
| Local `/api/auth/readiness` with no database config | 503 |

The packaging helper now removes the pnpm virtual store from the final artifact
after materializing runtime package directories and creates the ZIP with
Linux-friendly paths.

## Azure Deployment Results

First redeploy attempt:

| Field | Value |
| --- | --- |
| Deployment ID | `25378e40-7cdf-4a64-add5-e6ea49b75aa1` |
| Result | failed before activation |
| Notes | Kudu status 400 after deployment command |

Second redeploy attempt:

| Field | Value |
| --- | --- |
| Deployment ID | `3d889c1c-a7e6-46be-b4ae-31bf761d3928` |
| Result | artifact accepted and active, worker startup failed |
| OneDeploy status | deployment successful |
| App startup | failed within Azure 10 minute startup window |

Sanitized deployment log highlights:

- deployment prepared commit ID `3d889c1c-a`
- clean deploying to `/home/site/wwwroot`
- Node project optimizer initialized
- node modules were zipped by Azure
- rsync completed to `/home/site/wwwroot`
- build completed successfully
- container recycle triggered
- OneDeploy reported deployment successful
- Azure startup tracking reported the worker process failed to start in time

## Azure Route Results

After the second deployment:

| Route | Result |
| --- | --- |
| `/` | timeout |
| `/goal-console` | 503 |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |

## Production Verification

Canonical Vercel production remained healthy and unchanged.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |
| `https://terragroq.vercel.app/goal-console` | 200 |
| Security headers | present |
| `x-powered-by` | absent |

## Safety Rollup

| Gate | Result |
| --- | --- |
| Azure app settings changed | yes, Set A only |
| Secret values disclosed | no |
| Connection strings configured | no |
| Database URL configured | no |
| Azure artifact redeployed | yes |
| Azure serving WilliamOS | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| GitHub settings/rules changed | no |
| Package dependencies changed | no |
| App runtime behavior changed | no |
| DB/schema changed | no |
| Auth/access behavior changed | no |
| Hermes/MCP/autonomy changed | no |

## Finding

Set A resolves the Better Auth startup secret gate, and the cleaned standalone
artifact is accepted by Azure OneDeploy. The remaining blocker is App Service
Linux startup process configuration.

The app likely needs an explicit Azure startup command such as `node server.js`
or an equivalent App Service process model decision. This was not authorized in
WO-DEPLOY-019A.

## Next Recommended Work Order

`WO-DEPLOY-020A - Azure Startup Command Gate`

Purpose:

Decide whether to set an explicit startup command for the proof App Service,
most likely `node server.js`, and define rollback/removal rules before mutating
the App Service startup command.

Alternative:

`WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate` if cost containment is
more important than continuing the Azure proof.
