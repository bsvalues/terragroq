# WO-DEPLOY-016A Azure App Service Startup/Packaging Repair Design

## Result

OWNER DECISION REQUIRED.

WO-DEPLOY-015A proved that Azure App Service can receive the WilliamOS
no-env/no-secret artifact, but the worker did not start successfully. This
packet designs the next repair path without changing Azure configuration,
package settings, runtime code, app settings, secrets, connection strings, DNS,
Vercel, GitHub settings, DB/schema, auth/access behavior, or production traffic.

## Context

WO-DEPLOY-015A deployed a no-env/no-secret ZIP artifact to:

| Field | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Hostname | `https://williamos-proof-westus2.azurewebsites.net` |
| Runtime | `NODE|22-lts` |
| Deployment ID | `bbc886ac-be18-40d9-88ee-f30542997255` |

Azure OneDeploy accepted the artifact and recorded deployment success. App
Service startup then failed with `ContainerTimeout`; Azure routes returned
timeout/503.

Canonical Vercel production remained healthy.

## Current Technical Facts

| Area | Current Fact |
| --- | --- |
| Repo build script | `next build` |
| Repo start script | `next start` |
| Next.js version | 15.2.8 |
| `next.config.ts` | no `output: "standalone"` |
| Azure runtime | `NODE|22-lts` |
| Azure app command line | empty |
| Azure app settings | none |
| Azure connection strings | none |
| Artifact used in WO-015A | tracked-source ZIP, `.env*` excluded |

The current artifact proof used a tracked source ZIP and relied on Azure
App Service/Oryx/default runtime behavior to build/start the application.

## Failure Classification

The failure is not:

- Azure resource creation
- Azure artifact acceptance
- DNS
- Vercel
- production cutover
- DB/schema mutation
- auth/access policy
- Hermes/MCP/autonomy

The failure is currently classified as startup/packaging.

Likely causes:

1. source ZIP deployment does not produce a runtime layout App Service can
   launch for this Next.js app
2. no explicit startup command is configured
3. the app does not emit a portable `.next/standalone` server bundle
4. Oryx build-on-deploy behavior is not explicitly controlled
5. missing env/secrets may cause server startup or route-load failure

## Repair Option A - Next.js Standalone Artifact

Design:

- add or gate `output: "standalone"` in Next.js build configuration
- build locally or in CI
- package `.next/standalone`, `.next/static`, and `public` if present
- deploy the standalone package to the existing proof app
- set an explicit startup command only if required by App Service

Benefits:

- produces a smaller, explicit server artifact
- avoids relying on App Service to infer source build behavior
- gives clearer provenance over exactly what was deployed
- aligns with common Next.js self-hosting patterns

Risks:

- requires a code/config change to `next.config.ts`
- may alter build output expectations
- may need package/layout testing before Azure deployment
- may still need env-safe startup handling

Fit:

Recommended first repair path, but only after an implementation gate authorizes
the minimal `next.config.ts` change and artifact packaging.

## Repair Option B - Explicit App Service Startup Command

Design:

- keep current source ZIP approach
- configure an App Service startup command such as `npm run start` or another
  verified command
- redeploy or restart the proof app

Benefits:

- small Azure-side change
- may prove that startup command was the missing piece

Risks:

- app command line is Azure configuration mutation
- source ZIP still depends on App Service/Oryx/package restore behavior
- may require app settings such as build flags or package manager hints
- less portable/provenant than standalone packaging

Fit:

Possible only if owner approves Azure config mutation. Not recommended as the
first repair unless standalone packaging is rejected.

## Repair Option C - Oryx / Build-On-Deploy Control

Design:

- explicitly define whether App Service should build during deployment
- use App Service settings or deployment metadata to control Oryx behavior
- verify package manager detection and PNPM support

Benefits:

- uses platform-native build flow
- may avoid local artifact packaging concerns

Risks:

- may require App Service app settings
- PNPM behavior must be verified
- build output and startup remain less explicit
- still not a durable production provenance model

Fit:

Useful diagnostic path, but requires a separate Azure config/app-settings gate.

## Repair Option D - IaC / azd Deployment Plan

Design:

- create an explicit Azure deployment plan
- define App Service, runtime, app settings, startup command, and deployment
  flow in IaC/azd
- validate with preview/what-if before mutation

Benefits:

- strongest long-term governance and repeatability
- aligns with Azure deployment best practices
- reduces portal/CLI drift

Risks:

- larger scope
- may require infra files, identity decisions, and more owner inputs
- may delay immediate proof repair

Fit:

Best durable path after the minimal startup/packaging repair proves feasibility.

## Repair Option E - Stop/Cleanup

Design:

- stop the App Service or delete the proof resource group under a cleanup gate

Benefits:

- stops or reduces ongoing cost
- avoids continuing Azure work before product priorities justify it

Risks:

- leaves Azure artifact/startup proof incomplete

Fit:

Use if cost containment now matters more than Azure proof progress.

## Recommended Repair Path

Recommended:

1. `WO-DEPLOY-017A - Next.js Standalone Artifact Repair Gate`
2. authorize minimal `next.config.ts` standalone output only if owner approves
3. build and inspect the standalone artifact locally
4. do not deploy until artifact contents and startup command are explicit
5. deploy only after a follow-up no-secret standalone deployment approval

Reason:

- the failure is likely packaging/startup, not resource provisioning
- standalone output gives the clearest artifact boundary
- it avoids adding secrets or DB/auth config
- it avoids broad Azure config mutation as the first repair
- it creates a stronger bridge toward later IaC/azd design

## Validation Plan for Future Repair

Before another Azure deployment:

- `git diff --check`
- `npm test -- --run`
- `npm run build`
- verify standalone artifact exists if that path is selected
- list artifact contents without secrets
- compute artifact hash
- confirm `.env*` is excluded
- confirm no app settings are required unless explicitly approved
- confirm rollback choice

After future repair deployment:

- Azure default hostname route check
- Azure `/api/health`
- Azure `/api/auth/readiness`
- expected no-secret readiness classification
- Azure deployment ID
- Azure app settings/connection strings still empty unless separately approved
- canonical production health/readiness still pass

## Rollback / No-Change Plan

Until repair is approved:

- do not change the Azure app command line
- do not add app settings
- do not add secrets or connection strings
- do not deploy another artifact
- do not alter DNS or Vercel
- do not cut over production traffic

If a future repair fails:

- stop and record logs
- do not add secrets or loosen auth as a workaround
- choose cleanup/stop or a new repair gate

## Go / No-Go Table

| Gate | Status |
| --- | --- |
| Artifact acceptance proven | yes |
| Worker startup proven | no |
| Standalone output approved | no |
| Startup command change approved | no |
| Oryx/app-settings changes approved | no |
| Another Azure deployment approved | no |
| Secrets approved | no |
| Connection strings approved | no |
| DNS/Vercel/cutover approved | no |
| Cleanup/stop approved | no |

## Explicitly Not Authorized

This packet does not authorize:

- repair implementation
- `next.config.ts` changes
- package changes
- runtime behavior changes
- Azure config mutation
- App Service startup command changes
- app settings
- secrets
- connection strings
- another deployment
- DNS changes
- Vercel changes
- production cutover
- GitHub settings or rules changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior beyond the existing proof resources

## Next Work Order Split

Recommended approval path:

- `WO-DEPLOY-017A - Next.js Standalone Artifact Repair Gate`

Alternative paths:

- `WO-DEPLOY-017B - Azure Startup Command Repair Gate`
- `WO-DEPLOY-017C - Oryx Build-On-Deploy Repair Gate`
- `WO-DEPLOY-017D - Azure App Service IaC/AZD Deployment Plan`
- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Owner Decision Block

```text
OWNER_DECISION:
Approve next repair path: standalone / startup-command / Oryx / IaC / cleanup
Allow next.config.ts standalone change: YES/NO
Allow Azure startup command change: YES/NO
Allow Azure app settings: YES/NO
Allow another Azure deployment: YES/NO
Allow secrets: NO unless separately approved
Allow connection strings: NO unless separately approved
Rollback/cleanup posture:
Next authorized WO:
```
