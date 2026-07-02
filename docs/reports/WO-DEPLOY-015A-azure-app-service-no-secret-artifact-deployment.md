# WO-DEPLOY-015A Azure App Service No-Secret Artifact Deployment

## Result

PARTIAL.

Azure accepted the no-env/no-secret WilliamOS artifact and recorded a successful
OneDeploy deployment, but the App Service worker failed to start. The Azure
proof app now returns 503 for WilliamOS routes.

No app settings, secrets, connection strings, DNS changes, Vercel changes,
production cutover, GitHub settings changes, package changes, runtime code
changes, DB/schema changes, auth/access behavior changes, or Hermes/MCP/autonomy
changes were made.

## Approved Boundary

Approved:

- build the current WilliamOS artifact from the approved repo state
- deploy the no-env/no-secret artifact to the existing Azure proof App Service
- record deployed commit/provenance
- verify Azure default hostname and expected route behavior
- document health/readiness limitations caused by missing env/secrets
- document rollback/removal path

Blocked and preserved:

- no app settings
- no secrets
- no connection strings
- no DNS change
- no Vercel change
- no production cutover
- no GitHub settings/rules changes
- no package changes
- no runtime code behavior changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy
- no release/tag
- no production-write behavior outside the approved Azure proof app deployment

## Target

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |

## Artifact Provenance

| Field | Value |
| --- | --- |
| Source commit | `76c2bc1eb19a6ec12ccbeeec2c97e120ceca4419` |
| Source | tracked `origin/main` files |
| Artifact type | ZIP |
| Artifact env files | none; `.env*` files were removed from the package |
| Artifact size | 2,605,301 bytes |
| Artifact SHA-256 | `DDCF1FE2FBACB427D7EE5822F15086D3554EF4EB7B0C503B3C4E358E143B05F7` |
| Deployment method | Azure CLI `az webapp deploy --type zip` |
| Deployment ID | `bbc886ac-be18-40d9-88ee-f30542997255` |

The artifact was generated from tracked repository files only. Local
`node_modules`, build caches, logs, `.env*`, and untracked files were not
included.

## Azure Deployment Result

OneDeploy deployment metadata:

| Field | Value |
| --- | --- |
| Deployment active | true |
| Deployment complete | true |
| Deployer | `OneDeploy` |
| Status | `4` |
| Received time | `2026-07-02T15:20:56Z` |
| End time | `2026-07-02T15:21:16Z` |

Deployment log highlights:

- deployment prepared commit ID `bbc886ac-b`
- clean deployed to `/home/site/wwwroot`
- build completed successfully
- container recycle triggered after deployment
- deployment successful according to OneDeploy

Azure CLI deployment tracking then reported that the site failed to start within
the allotted startup window.

## Azure Route Results After Deployment

| Route | Result |
| --- | --- |
| `/` | timed out after 30 seconds |
| `/api/health` | 503 |
| `/api/auth/readiness` | 503 |
| `/goal-console` | 503 |

This proves the artifact was delivered but the Azure worker did not reach a
serving state.

## Startup Evidence

Sanitized App Service logs show:

- the container was created and started
- the startup probe began
- the site container terminated during startup
- the startup probe failed
- Azure reported `ContainerTimeout`
- Azure reported the site stopped after startup failure

This is consistent with a packaging/startup mismatch, not a DNS, Vercel,
database, auth, or production cutover issue.

Likely causes to investigate in a later gate:

- the repo does not currently emit a portable Next.js standalone artifact
- no App Service startup command is configured
- a tracked source ZIP relies on App Service/Oryx behavior that is not yet
  explicitly designed for this app
- no env/secrets are present, so any route or module requiring runtime env may
  fail closed

No repair was attempted because repair may require app settings, startup command
changes, packaging changes, runtime code changes, or env decisions.

## Azure Configuration After Deployment

| Check | Result |
| --- | --- |
| App settings | none |
| Connection strings | none |
| `linuxFxVersion` | `NODE|22-lts` |
| App command line | empty |

## Production Verification

Canonical production remained unchanged on Vercel.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 |

No production traffic was routed to Azure.

## Safety Rollup

| Gate | Result |
| --- | --- |
| Azure app deployed | yes, artifact delivery attempted and recorded |
| Azure app serving WilliamOS | no, startup failed |
| App settings added | no |
| Secrets configured | no |
| Connection strings configured | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| GitHub settings changed | no |
| Package changes | no |
| Runtime code changes | no |
| DB/schema changes | no |
| Auth/access changes | no |
| Hermes/MCP/autonomy | no |

## Rollback / Removal Path

The approved WO did not authorize cleanup, stopping the app, app settings,
startup command changes, or code/package changes.

Safe next options:

1. `WO-DEPLOY-016A - Azure App Service Startup/Packaging Repair Design`
2. `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

Do not continue by changing App Service settings, adding startup commands,
adding secrets, changing package/runtime code, or deploying a new artifact until
one of those gates is approved.

## Next Recommended Work Order

Recommended:

`WO-DEPLOY-016A - Azure App Service Startup/Packaging Repair Design`

Purpose:

Design the smallest safe repair path for Azure App Service startup, likely by
deciding between:

- Next.js standalone output design
- App Service startup command gate
- Oryx/build-on-deploy gate
- IaC/azd deployment plan
- cleanup/stop if Azure proof should not continue
