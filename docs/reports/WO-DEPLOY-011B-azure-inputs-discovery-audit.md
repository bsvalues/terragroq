# WO-DEPLOY-011B Azure Inputs Discovery Audit

## Result

PARTIAL PASS / OWNER INPUTS STILL REQUIRED.

The audit found useful Azure deployment evidence in connected TerraFusion
repositories, including a prior Benton Azure App Service preflight and
deployment record. It did not find enough non-secret WilliamOS-specific inputs
to proceed directly into WO-DEPLOY-012A provisioning.

No Azure login, Azure resource listing, Azure resource creation, deployment,
DNS change, Vercel change, env change, GitHub settings change, package/code
change, DB/schema change, auth/access behavior change, Hermes/MCP/autonomy,
release, tag, or production-write behavior occurred.

## Scope

Inspected read-only:

- current WilliamOS/TerraGroq worktree
- local TerraFusion / WilliamOS related worktrees under `C:\Users\bsval`
- GitHub repository metadata for `bsvalues`
- GitHub code search results for Azure terms in connected/visible repos
- selected non-secret docs discovered by search

Secret handling:

- `.env.local` and `.env.example` were inspected for variable names only.
- No secret values are included in this report.
- Credential-like examples discovered in connected repo docs are not quoted.

## Repositories and Worktrees Observed

Local git worktrees with relevant remotes:

| Path | Remote |
| --- | --- |
| `C:\Users\bsval\william-os-devops` | `git@github.com:bsvalues/terragroq.git` |
| `C:\Users\bsval\terrafusion_os_1.0` | `git@github.com:bsvalues/terrafusion_os_1.0.git` |
| `C:\Users\bsval\terrafusion-os` | `https://github.com/bsvalues/terrafusion-os.git` |
| `C:\Users\bsval\TerraFusion-Valuator-Pro-Studio` | `git@github.com:bsvalues/TerraFusion-Valuator-Pro-Studio.git` |
| `C:\Users\bsval\WashingtonForge` | `https://github.com/bsvalues/WashingtonForge.git` |

GitHub repo metadata also shows many TerraFusion repos, including
`terrafusion-infrastructure`, `TerraFusion_Master_Workspace`,
`terrafusion_os_1.0`, `terragroq`, and related public/private projects.

## Azure Inputs Found

### Existing WilliamOS/TerraGroq deployment docs

Current repo docs establish:

- Azure is a staging/proof design target, not immediate production.
- Azure App Service is the recommended first proof path.
- Azure Container Apps remains the stronger later path if containerization and
  image-digest provenance are approved.
- Azure VM is not preferred for the first Azure proof.
- Vercel remains current production and non-blocking unless a WO explicitly
  targets Vercel/deployment behavior.
- Owner approval is required before Azure login, resources, env migration, DNS,
  deployment, or production changes.

Relevant files:

- `docs/governance/azure-production-fit-decision-packet.md`
- `docs/governance/azure-architecture-runbook.md`
- `docs/governance/azure-hosting-option-decision-gate.md`
- `docs/governance/azure-app-service-proof-design-packet.md`
- `docs/governance/azure-app-service-provisioning-gate.md`

### Prior TerraFusion Benton App Service evidence

GitHub search found prior TerraFusion OS App Service docs:

- `bsvalues/terrafusion_os_1.0:docs/data/WO_DEPLOY_BENTON_003B_APP_SERVICE_PREFLIGHT.md`
- `bsvalues/terrafusion_os_1.0:docs/data/WO_DEPLOY_BENTON_003C_APP_SERVICE_DEPLOYMENT.md`

Sanitized facts from those docs:

| Input | Found Value / Posture |
| --- | --- |
| Prior Azure platform | Azure App Service |
| Prior workload | TerraFusion Benton demo API |
| Prior proof app name | `app-terrafusion-benton-demo` |
| Prior plan name | `plan-terrafusion-benton-demo` |
| Prior SKU | B2 Linux |
| Prior region | West US 2 |
| Prior default hostname | `app-terrafusion-benton-demo.azurewebsites.net` |
| Prior database posture | Azure PostgreSQL Flexible Server was referenced |
| Prior database host | `pg-terrafusion-benton-demo.postgres.database.azure.com` |
| Prior database name | `terrafusion_benton_demo` |
| Prior env pattern | App Service app settings / Key Vault references |
| Prior health posture | App Service health/readiness routes were used |
| Prior CORS/origin posture | Azure App Service URL added to allowed origins |

These values are useful precedents, but they are not automatically valid
WilliamOS/TerraGroq inputs. They belong to a prior TerraFusion Benton demo.

### Prior Azure Key Vault posture

GitHub search found:

- `bsvalues/terrafusion_os_1.0:docs/AZURE_KEY_VAULT_SETUP_GUIDE.md`

Sanitized findings:

- Key Vault was documented as the preferred secure secret-management direction.
- The guide references tenant/client credential style setup and secret names.
- It includes credential-like example values or placeholders.

Security note:

- Treat all credential-like examples in that guide as non-authoritative.
- If any were ever real values, rotate them before reuse.
- Do not copy them into WilliamOS or any proof environment.
- Prefer managed identity over client-secret credentials for new Azure-hosted
  resources when possible.

### Local WilliamOS env variable inventory

Current local files inspected for variable names only:

- `.env.example`
- `.env.local`

Sanitized variable names observed:

| Variable | In `.env.example` | In `.env.local` |
| --- | --- | --- |
| `DATABASE_URL` | present | present |
| `BETTER_AUTH_SECRET` | present | present |
| `BETTER_AUTH_URL` | present | present |
| `BETTER_AUTH_TRUSTED_ORIGINS` | absent | present |
| `LOCAL_SETUP_ENABLED` | present | present |
| `AUTH_SIGNUP_MODE` | present | present |
| `GROQ_API_KEY` | present | present |

No Azure-specific WilliamOS env variables were found in the current env
examples. Values were not printed or copied.

### Workflow and IaC posture

Current WilliamOS/TerraGroq worktree:

- no repo-owned Azure workflow was found
- no `infra/` Azure Bicep/Terraform for WilliamOS was found
- no Azure App Service deployment workflow was found

Related TerraFusion local worktree:

- contains extensive Docker Compose assets
- contains Terraform assets that appear primarily AWS-oriented in the inspected
  `variables.tf` files
- contains a branch reference named `tf-agent-ci-azure-devops-migration`
- contains prior App Service docs for Benton deployment

This indicates Azure App Service has precedent in the ecosystem, but WilliamOS
does not yet have a ready Azure provisioning workflow or IaC path.

## Azure Inputs Missing

Required before WO-DEPLOY-012A can safely provision Azure App Service resources:

| Input | Status |
| --- | --- |
| Azure subscription/account selected | missing |
| Azure tenant posture | missing |
| Resource group name/strategy | missing |
| Owner-approved Azure region for WilliamOS | missing |
| App Service Plan SKU/budget ceiling | missing |
| Proof app name for WilliamOS | missing |
| Access/RBAC policy | missing |
| Env migration policy | missing |
| DNS/no-DNS confirmation | default no-DNS recommended, owner still must confirm |
| Deployment method | missing; IaC/preview-first recommended |
| Whether to reuse Benton naming patterns | owner decision required |
| Whether prior Benton Azure resources are still valid | unknown; Azure access is blocked |

## Secret Values Disclosed

No secret values are included in this report.

Potential secret-bearing files or docs encountered:

| Path / Source | Secret Handling |
| --- | --- |
| `C:\Users\bsval\william-os-devops\.env.local` | variable names only; values not disclosed |
| `bsvalues/terrafusion_os_1.0:docs/AZURE_KEY_VAULT_SETUP_GUIDE.md` | credential-like examples not quoted; rotate if any were real |
| TerraFusion Docker Compose / App Service docs | variable and secret names only; values not copied |

## Recommendation

Do not proceed directly to Azure provisioning yet.

Recommended next step:

- WO-DEPLOY-011C - Azure App Service Owner Inputs Resolution Packet

Purpose:

- present the discovered prior Benton Azure precedent
- ask the owner whether to reuse, adapt, or reject that naming/region/SKU
  posture for WilliamOS
- collect missing Azure subscription, tenant, resource group, SKU, budget, app
  name, and access/RBAC decisions
- keep Azure login/resource creation blocked until those inputs are explicit

If the owner wants to use the prior Benton precedent as the starting point,
suggested defaults for review only:

| Input | Suggested Default for Owner Review |
| --- | --- |
| Platform | Azure App Service |
| Region | West US 2, only if owner confirms county/Azure alignment |
| SKU | B2 Linux as a proof precedent, only if budget is approved |
| Naming style | `app-williamos-proof` / `plan-williamos-proof` or owner-selected equivalent |
| DNS | no-DNS proof using Azure default hostname |
| Env | no secret migration until separate env gate |

## Next Recommended WO

`WO-DEPLOY-011C - Azure App Service Owner Inputs Resolution Packet`

Do not run `WO-DEPLOY-012A - Azure App Service Proof Provisioning` until the
missing owner inputs are resolved and Azure access/resource work is explicitly
approved.
