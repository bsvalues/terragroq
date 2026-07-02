# WO-DEPLOY-012A Azure App Service Proof Provisioning

## Result

PASS.

Azure App Service no-env/no-secret proof resources were provisioned under the
explicit owner authorization for WO-DEPLOY-012A.

This proof did not deploy WilliamOS, did not migrate secrets, did not configure
production environment values, did not change DNS, did not change Vercel, and
did not perform production cutover.

## Owner Authorization Boundary

Approved scope:

- create the named resource group if it does not exist
- create the named Linux App Service Plan
- create the named Linux Web App / App Service
- configure only non-secret platform settings required for a no-env/no-secret
  proof
- record resource IDs, default hostname, SKU, region, and provenance evidence
- verify Azure default hostname if available
- document health/readiness limitations caused by missing app artifact and
  missing real env/secrets

Blocked scope remained blocked:

- no real secret migration
- no production env values
- no DNS change
- no Vercel disconnect or change
- no production cutover
- no GitHub settings or rules changes
- no package changes
- no runtime code changes
- no DB/schema changes
- no auth/access behavior changes
- no Hermes/MCP/autonomy
- no release/tag
- no production-write behavior outside the approved Azure proof resources

## Azure Context

| Field | Value |
| --- | --- |
| Azure subscription | TerraFusion |
| Subscription ID | `b345d747-5953-4468-a1c7-18164d6f26e4` |
| Tenant ID | `382a3d23-47cc-4b07-b13f-7685e747ba09` |
| Azure user | `bsvalues@gmail.com` |
| Region | West US 2 |
| Runtime stack | Node.js 22 LTS on Linux |

Azure CLI context matched the owner-provided subscription and tenant before any
resource mutation occurred.

## Pricing / Budget Check

Owner budget ceiling: stop if estimated monthly platform cost exceeds
`$75/month` before usage-based extras.

The selected B1 Basic App Service plan is within the budget ceiling based on
the current Azure App Service pricing evidence reviewed before provisioning.

Usage-based extras, traffic, logging, monitoring, storage beyond plan defaults,
and future services remain outside this proof and must be reviewed separately.

## Resources Created

| Resource | Value |
| --- | --- |
| Resource group | `rg-williamos-proof-westus2` |
| Resource group ID | `/subscriptions/b345d747-5953-4468-a1c7-18164d6f26e4/resourceGroups/rg-williamos-proof-westus2` |
| App Service Plan | `asp-williamos-proof-westus2` |
| App Service Plan ID | `/subscriptions/b345d747-5953-4468-a1c7-18164d6f26e4/resourceGroups/rg-williamos-proof-westus2/providers/Microsoft.Web/serverfarms/asp-williamos-proof-westus2` |
| App Service | `williamos-proof-westus2` |
| App Service ID | `/subscriptions/b345d747-5953-4468-a1c7-18164d6f26e4/resourceGroups/rg-williamos-proof-westus2/providers/Microsoft.Web/sites/williamos-proof-westus2` |
| SKU | B1 Basic Linux |
| Workers | 1 |
| Default hostname | `williamos-proof-westus2.azurewebsites.net` |
| HTTPS-only | true |
| Runtime | `NODE|22-lts` |

The primary App Service name was available. The approved fallback name was not
used.

## Tags

The following tags were applied to the resource group, App Service Plan, and App
Service:

| Tag | Value |
| --- | --- |
| `system` | `williamos` |
| `environment` | `proof` |
| `work_order` | `WO-DEPLOY-012A` |
| `owner` | `primary-operator` |
| `production_cutover` | `false` |

## Deployment Provenance

This proof established Azure resource provenance only.

No WilliamOS source artifact was deployed. No GitHub Actions deployment was
configured. No CI/CD credential was created. No production app traffic was
routed to Azure.

Provisioning method:

- Azure CLI under the owner-approved Codex session
- exact owner-provided subscription, tenant, resource names, region, SKU, and
  runtime
- no app artifact deployment
- no App Service app settings or connection strings

## App Settings / Secrets

No App Service application settings were configured.

No connection strings were configured.

No secrets were created, copied, printed, committed, or migrated.

## Default Hostname Verification

| Probe | Result |
| --- | --- |
| `https://williamos-proof-westus2.azurewebsites.net/` | 200 |
| `https://williamos-proof-westus2.azurewebsites.net/api/health` | 404 |
| `https://williamos-proof-westus2.azurewebsites.net/api/auth/readiness` | 404 |

The root route returns the default Azure App Service page. The WilliamOS health
and auth readiness endpoints return 404 because no WilliamOS app artifact was
deployed. This is expected for the no-env/no-secret infrastructure proof.

## Production Verification

Current production remained on Vercel and was not changed.

| Check | Result |
| --- | --- |
| `https://terragroq.vercel.app/api/health` | 200 ok |
| `https://terragroq.vercel.app/api/auth/readiness` | 200 ready:true |
| `https://terragroq.vercel.app/goal-console` | 200 |
| Security headers | present |
| `x-powered-by` | absent |

## Safety Rollup

| Gate | Result |
| --- | --- |
| Azure resources created | yes, approved proof resources only |
| Real secrets configured | no |
| App settings configured | no |
| Connection strings configured | no |
| DNS changed | no |
| Vercel changed | no |
| Production cutover | no |
| GitHub settings changed | no |
| Package changes | no |
| Runtime code changes | no |
| DB/schema changes | no |
| Auth/access behavior changes | no |
| Hermes/MCP/autonomy | no |
| Release/tag | no |

## Known Limitations

This proof does not prove that WilliamOS runs on Azure.

It proves:

- the owner-approved subscription/tenant context can create Azure App Service
  proof resources
- the selected resource names are available
- the selected West US 2 / B1 Linux / Node 22 LTS posture is provisionable
- the Azure default hostname is reachable
- production remains unchanged

It does not prove:

- WilliamOS build/deploy behavior on Azure
- runtime health/readiness on Azure
- database/auth/env configuration on Azure
- Key Vault integration
- CI/CD deployment provenance
- rollback from an Azure application deployment

## Next Recommended Work Order

Recommended next gate:

`WO-DEPLOY-013A - Azure App Service No-Secret App Artifact Deployment Design`

Purpose:

Design how to deploy a WilliamOS artifact to the Azure proof app without real
secrets, production env values, DNS changes, Vercel changes, auth/access
behavior changes, or production cutover.

Do not deploy the application artifact until that deployment design gate is
approved.
