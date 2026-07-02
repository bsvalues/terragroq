# WO-DEPLOY-013A Azure App Service No-Secret App Artifact Deployment Design

## Result

OWNER DECISION REQUIRED.

This packet designs how WilliamOS could deploy an application artifact to the
existing Azure App Service proof app without real secrets, production
environment values, DNS changes, Vercel changes, GitHub settings changes, or
production cutover.

It does not authorize deployment.

## Context

WO-DEPLOY-012A provisioned the Azure App Service proof resources:

| Resource | Value |
| --- | --- |
| Subscription | TerraFusion |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| Region | West US 2 |
| SKU | B1 Linux |
| Runtime | Node.js 22 LTS on Linux |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |

The current Azure app returns the default App Service page. WilliamOS health and
auth readiness routes return 404 because no WilliamOS artifact has been
deployed.

## Design Goal

Design a bounded artifact deployment proof that answers:

1. Can a WilliamOS build artifact be delivered to Azure App Service?
2. Can deployment provenance be recorded without changing production?
3. What will fail or remain incomplete without real env/secrets?
4. What rollback or cleanup action is required if the artifact proof fails?
5. What additional owner gates are needed before functional Azure readiness?

## Non-Goals

This design does not aim to prove:

- production cutover
- DNS ownership
- Vercel replacement
- database/auth readiness on Azure
- Key Vault integration
- GitHub Actions deployment automation
- access grant behavior
- Hermes/MCP/autonomy

## Official Platform Guidance Used

Microsoft guidance supports multiple App Service deployment paths:

- ZIP/package deployment to App Service
- GitHub Actions deployment to App Service
- Node.js App Service runtime configuration

Azure deployment best-practice guidance also prefers IaC and validated
deployment plans for durable production deployment. That is why this packet
treats one-off artifact deployment only as a proof step, not the final
production deployment model.

## Deployment Method Options

### Option A - Local Build Artifact + Azure CLI Deploy

Summary: build WilliamOS locally, create a deployable artifact, and deploy it to
the proof App Service using Azure CLI.

Benefits:

- no GitHub settings changes
- no GitHub Actions secrets
- fastest way to test App Service artifact compatibility
- keeps deployment authority in the explicit owner-approved Codex session

Risks:

- weaker long-term provenance than CI-generated artifacts
- local machine state can influence artifact contents
- requires careful artifact manifest and commit SHA recording
- may need Azure app settings or startup command if the default Node runtime
  cannot start the Next.js artifact

Fit for next proof: best first no-secret artifact test, if owner approves.

### Option B - GitHub Actions to Azure App Service

Summary: add a workflow that builds and deploys the app to Azure App Service.

Benefits:

- better long-term provenance
- repeatable build logs
- easier future branch/approval gates
- aligns with CI-based deployment direction

Risks:

- requires GitHub settings/secrets or OIDC/federated identity setup
- requires Azure identity/RBAC decisions
- crosses into GitHub settings and credential management
- not suitable for the current no-settings/no-secrets proof boundary

Fit for next proof: defer until CI/OIDC gate is approved.

### Option C - App Service Deployment Center

Summary: configure App Service Deployment Center to connect GitHub and generate
deployment wiring.

Benefits:

- managed setup path
- can generate workflow for the app stack

Risks:

- mutates Azure/GitHub integration settings
- can commit workflow files automatically
- may use publish profiles or identity settings
- less controlled than a governance-first PR workflow

Fit for next proof: not recommended.

### Option D - Azure Developer CLI / IaC Flow

Summary: create an IaC-backed deployment plan and use `azd` or Azure deployment
commands after validation.

Benefits:

- strongest long-term provenance and repeatability
- aligns with Azure deployment best practices
- better path toward production migration

Risks:

- larger scope than the existing proof
- requires infra files, deployment plan, validation, and owner review
- may introduce package/scripts/config churn

Fit for next proof: recommended after artifact compatibility is understood, or
if the owner wants to skip one-off CLI deploy entirely.

## Recommended Next Proof Path

Recommended: Option A, local build artifact + Azure CLI deploy, but only after a
new owner approval.

Reason:

- the current proof intentionally avoids GitHub settings and secret setup
- the next unknown is whether the current Next.js app artifact can run on App
  Service at all
- Azure App Service resources are already live and cost-bearing
- no-secret artifact deployment can reveal runtime/startup limitations without
  crossing into production migration

Do not treat this as the long-term deployment model.

## Proposed Artifact Contents

The next deployment proof should prefer the smallest artifact that can start the
Next.js server on Azure App Service.

Candidate artifact:

- `.next/standalone`
- `.next/static`
- `public`, if present
- required package metadata
- required runtime server entrypoint
- artifact manifest with:
  - source commit SHA
  - branch
  - build command
  - Node version
  - package manager version
  - generated timestamp

The artifact must not include:

- `.env`
- `.env.local`
- secret files
- local logs
- `node_modules` unless explicitly required by the chosen packaging approach
- database dumps
- credentials

## No-Secret Runtime Expectation

Expected behavior after no-secret artifact deployment:

| Route | Expected Result |
| --- | --- |
| `/` or `/goal-console` | may render if no server-only secrets are required at route load |
| `/api/health` | likely degraded or failure because `DATABASE_URL` is absent |
| `/api/auth/readiness` | likely `ready:false` because auth/database env is absent |
| Auth routes | should not be used for production auth testing |
| Access grants | must remain disabled |
| Email OTP | must remain disabled |

No-secret deployment success means the app artifact starts and exposes expected
readiness limitations. It does not mean Azure is production-ready.

## Startup / Runtime Design Questions

The next deployment gate must answer:

1. Does the current Next.js build emit a standalone server artifact suitable for
   Linux App Service?
2. What startup command is required?
3. Does Azure App Service set the expected `PORT` value for the Next.js server?
4. Does the app fail closed when `DATABASE_URL` and `BETTER_AUTH_SECRET` are
   absent?
5. Does any route crash at module import time because env is missing?
6. Does deployment require app settings such as `WEBSITE_RUN_FROM_PACKAGE`,
   `SCM_DO_BUILD_DURING_DEPLOYMENT`, or a startup command?

If the answer requires Azure config mutation, stop for owner approval.

## Provenance Requirements

The artifact proof must record:

- source commit SHA
- branch name
- build command
- test command
- build timestamp
- artifact file name
- artifact hash
- Azure App Service name
- Azure deployment ID if available
- default hostname
- post-deployment route results
- expected missing-env failures

No artifact should be deployed without an accompanying manifest.

## Rollback / Removal Plan

Before deploying an artifact, the owner must choose a rollback posture:

1. restore the default App Service placeholder page, if practical
2. redeploy the previous artifact, if one exists
3. stop the App Service app
4. delete the proof resource group under a separate cleanup authorization

Because the current proof app has no WilliamOS artifact, the safest rollback is
to stop before deployment if artifact/startup requirements are unclear.

## Cost Reminder

The B1 Linux App Service Plan is live and can incur ongoing Azure cost.

If no artifact proof is expected soon, run a cleanup or stop-plan gate instead
of leaving resources idle.

## Go / No-Go Table

| Gate | Current Status |
| --- | --- |
| Azure proof resources exist | yes |
| Artifact deployment authorized | no |
| Azure app settings authorized | no |
| Secrets configured | no |
| GitHub Actions/OIDC authorized | no |
| DNS change authorized | no |
| Vercel change authorized | no |
| Production cutover authorized | no |
| Rollback choice selected | missing |

## Recommended Next Work Order

If owner approves a no-secret artifact deployment proof:

- `WO-DEPLOY-014A - Azure App Service No-Secret Artifact Deployment Gate`

That gate should authorize exactly:

- artifact build command
- artifact packaging method
- allowed Azure CLI deploy command
- whether startup command/app settings may be changed
- rollback posture
- expected health/readiness results

If owner wants IaC first:

- `WO-DEPLOY-014B - Azure App Service IaC Deployment Plan`

If owner wants to avoid ongoing Azure cost:

- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Explicitly Not Authorized

This packet does not authorize:

- app deployment
- Azure config mutation
- app settings
- secrets
- connection strings
- DNS changes
- Vercel changes
- production cutover
- GitHub settings or rules changes
- package changes
- runtime code changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior beyond the already-created proof resources

## Owner Decision Block

```text
OWNER_DECISION:
Approve no-secret Azure artifact deployment proof: YES/NO
Deployment method: local artifact / GitHub Actions / IaC / defer
Artifact source commit:
Artifact packaging method:
Allow Azure app settings changes: YES/NO
Allow startup command change: YES/NO
Allow secrets: NO unless separately approved
Allow connection strings: NO unless separately approved
Expected health/readiness result:
Rollback posture:
Next authorized WO:
```
