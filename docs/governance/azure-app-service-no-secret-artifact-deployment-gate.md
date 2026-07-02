# WO-DEPLOY-014A Azure App Service No-Secret Artifact Deployment Gate

## Result

OWNER DECISION REQUIRED.

This gate defines the final owner inputs required before any WilliamOS artifact
is deployed to the Azure App Service proof app.

It does not authorize app deployment, Azure configuration mutation, app
settings, secrets, connection strings, DNS changes, Vercel changes, GitHub
settings changes, production cutover, code/runtime changes, DB/schema changes,
auth/access behavior changes, Hermes/MCP/autonomy, release, or tag work.

## Context

WO-DEPLOY-012A provisioned the Azure proof resources:

| Resource | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| SKU | B1 Linux |
| Region | West US 2 |
| Runtime | Node.js 22 LTS on Linux |
| Default hostname | `https://williamos-proof-westus2.azurewebsites.net` |

WO-DEPLOY-013A designed the no-secret artifact deployment path and recommended
a local build artifact + Azure CLI deploy as the first bounded proof, if the
owner approves.

Current Azure posture:

- Azure proof resources are live.
- Azure default hostname is reachable.
- WilliamOS artifact has not been deployed.
- No App Service app settings are configured.
- No connection strings are configured.
- No real secrets are configured.
- DNS, Vercel, and production traffic remain unchanged.

## Gate Purpose

Before deploying any artifact, the owner must explicitly decide:

1. whether artifact deployment is approved
2. which source commit may be packaged
3. which deployment method may be used
4. whether any Azure app configuration may be changed
5. what no-secret health/readiness result is acceptable
6. what rollback/removal action is required if the proof fails
7. whether ongoing Azure cost is acceptable while the proof continues

## Deployment Method Decision

| Method | Use Now? | Why |
| --- | --- | --- |
| Local build artifact + Azure CLI deploy | Recommended if approved | Bounded, no GitHub settings changes, fastest artifact compatibility proof |
| GitHub Actions | Defer | Requires GitHub settings/secrets or OIDC/RBAC decisions |
| App Service Deployment Center | Do not use now | Mutates Azure/GitHub integration posture and may generate workflow changes |
| IaC/azd deployment plan | Defer or choose explicitly | Stronger durable path, but larger scope than this artifact proof |

Recommended next proof:

- build from an explicit `origin/main` commit
- create a local artifact manifest
- deploy only to `williamos-proof-westus2`
- record artifact hash, source commit, build command, deploy command, and Azure
  deployment evidence
- do not add secrets or production env values

## Required Owner Inputs

| Input | Required Before Deployment | Recommended Default |
| --- | --- | --- |
| Approve no-secret artifact deployment | yes | Pending |
| Source commit | yes | latest approved `origin/main` |
| Deployment method | yes | local build artifact + Azure CLI deploy |
| Artifact packaging method | yes | Next.js standalone-compatible package if available |
| Allow Azure app settings changes | yes | NO unless startup requires a separate gate |
| Allow startup command change | yes | NO unless explicitly required and approved |
| Allow connection strings | yes | NO |
| Allow real secrets | yes | NO |
| Expected `/api/health` result | yes | degraded/failing allowed if env missing |
| Expected `/api/auth/readiness` result | yes | `ready:false` or missing-config allowed |
| Rollback posture | yes | stop app or cleanup gate if artifact proof fails |
| Keep Azure resources running after proof | yes | owner decision |

## No-Secret / No-Env Limitations

A no-secret artifact deployment is allowed to prove artifact compatibility only.

Expected limitations:

- `/api/health` may report database/auth readiness failures.
- `/api/auth/readiness` may report `ready:false`.
- sign-in should not be tested as production behavior.
- origin diagnostics may fail until a separate env gate approves proof origin
  values.
- access grants must remain disabled.
- Email OTP must remain disabled.
- social login must remain unconfigured.

Do not fix these limitations by adding secrets, changing auth behavior, changing
DB/schema, or altering production configuration inside the artifact deployment
WO.

## Allowed Verification After Deployment Approval

If the owner later approves artifact deployment, verification may include:

- Azure default hostname returns a WilliamOS page or expected failure page
- Azure `/api/health` returns the expected no-env result
- Azure `/api/auth/readiness` returns the expected no-env result
- deployment record exists in Azure App Service
- artifact manifest records source commit and artifact hash
- canonical Vercel production remains healthy and unchanged

## Rollback / Removal Checklist

Owner must choose one before deployment:

| Rollback Option | Fit |
| --- | --- |
| Stop the Azure proof app | Simple if deployed artifact behaves badly |
| Delete proof resource group | Best if Azure cost should stop |
| Redeploy default placeholder | Only if practical; not required |
| Deploy previous artifact | Not available yet because no prior WilliamOS artifact exists |

Recommended default: if artifact proof fails, stop before further mutation and
open a cleanup/rollback WO. Do not add secrets or loosen policy as a workaround.

## Cost Reminder

The Azure B1 Linux App Service Plan is live and can incur ongoing cost.

If the owner does not intend to run the artifact deployment proof soon, prefer:

`WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

## Go / No-Go Table

| Gate | Status |
| --- | --- |
| Azure proof resources exist | yes |
| Artifact deployment approved | missing |
| Source commit selected | missing |
| Deployment method selected | missing |
| Artifact packaging method selected | missing |
| Azure app settings approved | no |
| Startup command change approved | no |
| Secrets approved | no |
| Connection strings approved | no |
| DNS change approved | no |
| Vercel change approved | no |
| Production cutover approved | no |
| Rollback posture selected | missing |

## Stop Conditions

Stop before deployment if:

- source commit is unclear
- artifact packaging method is unclear
- deployment requires Azure app settings not approved by this gate
- deployment requires startup command changes not approved by this gate
- deployment requires secrets, connection strings, DB/schema changes, or auth
  behavior changes
- deployment requires GitHub settings, OIDC, service principal, or publish
  profile secrets
- deployment requires DNS, Vercel, or production traffic changes
- Azure App Service requests broader permissions than expected
- cost posture is no longer acceptable

## Next Work Order Split

If approved:

- `WO-DEPLOY-015A - Azure App Service No-Secret Artifact Deployment`

If the owner wants IaC first:

- `WO-DEPLOY-014B - Azure App Service IaC Deployment Plan`

If the owner wants to stop cost before continuing:

- `WO-DEPLOY-014C - Azure Proof Resource Stop/Cleanup Gate`

If deferred:

- `WO-DEPLOY-014D - Azure Proof Hold / Product Work Resume Packet`

## Explicitly Not Authorized

This packet does not authorize:

- app deployment
- Azure configuration mutation
- app settings
- startup command changes
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
Approve WO-DEPLOY-015A no-secret Azure artifact deployment: YES/NO
Source commit:
Deployment method:
Artifact packaging method:
Allow Azure app settings changes: YES/NO
Allow startup command change: YES/NO
Allow secrets: NO unless separately approved
Allow connection strings: NO unless separately approved
Expected Azure /api/health result:
Expected Azure /api/auth/readiness result:
Rollback posture:
Keep Azure resources running after proof: YES/NO
Next authorized WO:
```
