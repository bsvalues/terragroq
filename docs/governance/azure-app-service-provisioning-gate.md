# WO-DEPLOY-011A Azure App Service Proof Provisioning Gate

## Result

OWNER DECISION REQUIRED.

This gate defines the final owner inputs required before any Azure login,
resource creation, deployment, env setup, DNS change, or production change can
occur for the Azure App Service proof.

## Context

WO-DEPLOY-010A added the Azure App Service proof design packet. That packet
defined the desired proof architecture and kept all work docs-only.

This provisioning gate is still docs-only. It does not authorize Azure access or
resource work.

## Gate Purpose

Before crossing into Azure resource work, the owner must explicitly approve:

1. Azure proof intent
2. subscription and tenant
3. resource group strategy
4. region
5. App Service Plan SKU and budget ceiling
6. proof app name
7. access and RBAC posture
8. env/secrets posture
9. DNS/no-DNS posture
10. rollback/no-change posture
11. stop conditions

## Provisioning Boundary

Allowed after this gate only if separately approved:

- Azure login/access
- Azure resource group lookup or creation
- Azure App Service Plan creation
- Azure Linux App Service creation
- user-assigned managed identity creation
- Application Insights / Log Analytics proof resources
- proof endpoint verification

Still not automatically allowed:

- production cutover
- DNS changes
- Vercel changes
- env secret migration
- Key Vault binding
- database migration
- auth/access behavior changes
- Hermes/MCP/autonomy

## Required Owner Inputs

| Input | Required Before Provisioning | Owner Answer |
| --- | --- | --- |
| Approve Azure App Service proof provisioning? | yes | Pending |
| Azure subscription ID/name | yes | Pending |
| Azure tenant posture | yes | Pending |
| Resource group strategy | create new / use existing | Pending |
| Resource group name | yes | Pending |
| Azure region | yes | Pending |
| App Service Plan SKU | yes | Pending |
| Monthly budget ceiling | yes | Pending |
| Proof app name | yes | Pending |
| Runtime stack | Node on Linux | Pending |
| Deployment method | IaC-first / azd preview-first / other | Pending |
| Proof hostname posture | Azure default hostname / custom DNS later | Pending |
| Env migration approved? | YES / NO | Pending |
| DNS change approved? | NO for first proof unless separately approved | NO |
| Vercel change approved? | NO | NO |
| Production cutover approved? | NO | NO |

## Subscription and Resource Group Checklist

The owner must provide:

- subscription identifier or explicit instruction to select one later
- tenant/account posture
- resource group name
- resource group region
- resource group ownership tag values, if required
- budget owner

Recommended resource group posture:

- create a dedicated proof resource group
- avoid mixing proof resources with production or unrelated workloads
- tag all resources with purpose, owner, environment, and work order

Suggested tags:

| Tag | Value |
| --- | --- |
| `system` | `williamos` |
| `environment` | `proof` |
| `work_order` | `WO-DEPLOY-011A` or successor provisioning WO |
| `owner` | `primary-operator` |
| `production_cutover` | `false` |

## Region and SKU Checklist

Region selection should consider:

- owner/county alignment
- latency to expected operators
- regional availability
- budget ceiling
- data residency expectations
- future Azure service dependencies

Recommended first proof posture:

- use a common US region unless owner specifies otherwise
- choose the smallest App Service Plan SKU that can validate build/runtime
  behavior
- do not scale out
- do not enable production slots until needed

Do not proceed unless the owner approves the SKU and budget ceiling.

## Access and Security Checklist

Required before Azure access:

- confirm who will log in to Azure
- confirm whether access is interactive owner access or service principal
- confirm least-privilege role scope
- confirm no credentials will be committed
- confirm proof does not require production secrets by default
- confirm managed identity is preferred for Azure-native access
- confirm Key Vault is deferred until env/secret gate approval

Recommended first proof access posture:

- owner-controlled Azure login
- resource-group-scoped access
- no broad subscription role assignment unless unavoidable
- no long-lived secrets committed to repo
- no service principal until CI/deployment automation is explicitly approved

## No-Secret Env Inventory Checklist

The proof must not copy or create secrets until a separate env gate approves
that work.

| Variable | First Proof Posture | Notes |
| --- | --- | --- |
| `DATABASE_URL` | pending env gate | Required for full readiness; do not copy silently |
| `BETTER_AUTH_SECRET` | pending env gate | Required for auth readiness; secret stays outside git |
| `BETTER_AUTH_URL` | proof URL after app exists | Not known until App Service exists |
| `BETTER_AUTH_TRUSTED_ORIGINS` | proof URL after app exists | Must include Azure proof origin if auth is tested |
| `AUTH_EMAIL_OTP_ENABLED` | false/unset | OTP remains disabled |
| `RESEND_API_KEY` | absent | No email sending |
| `AUTH_EMAIL_FROM` | absent | No email sending |
| `ACCESS_GRANTS_ENABLED` | false/unset | Access grants remain disabled |

Env gate options:

1. no env migration: proof may only show build/start route behavior and expected
   readiness failures
2. minimal env migration: owner provides only required proof values
3. Key Vault-backed env: deferred until secret strategy is approved

## DNS / No-DNS Proof Options

Recommended first proof:

- use the Azure default App Service hostname
- do not change DNS
- do not move production traffic
- do not alter Vercel aliases

DNS may only be considered in a later work order after:

- Azure proof is healthy
- provenance is proven
- rollback plan is tested
- owner approves DNS explicitly

## Rollback / No-Change Plan

Before provisioning:

- current production remains unchanged
- Vercel remains attached and non-blocking
- DNS remains unchanged
- no traffic routes to Azure

If provisioning is later approved and fails:

- stop at the failed provisioning gate
- do not retry with broader privileges without owner approval
- do not mutate DNS or Vercel as a workaround
- record failed resource state and recommended cleanup
- clean up proof resources only under a separate cleanup authorization

If proof deployment is later approved and fails:

- keep current production unchanged
- record build/runtime logs as evidence
- do not add secrets or loosen auth as a workaround
- do not bypass readiness failures

## Go / No-Go Decision Table

| Gate | Required Owner Decision | Current Status |
| --- | --- | --- |
| Azure App Service proof provisioning | YES / NO | Pending |
| Subscription/tenant selected | required | Pending |
| Resource group selected | required | Pending |
| Region selected | required | Pending |
| SKU and budget ceiling selected | required | Pending |
| Access/RBAC posture approved | required | Pending |
| Env migration approved | optional | Not approved |
| DNS change approved | optional later | Not approved |
| Vercel change approved | optional later | Not approved |
| Deployment approved | separate WO | Not approved |
| Production cutover approved | separate WO | Not approved |

## Stop Conditions

Stop before Azure access or resource work if:

- subscription/tenant is unclear
- region or SKU is unclear
- budget ceiling is unclear
- access/RBAC is unclear
- env posture is unclear
- provisioning requires broader Azure permissions than approved
- proof requires production secrets without an env gate
- DNS, Vercel, or production traffic changes are needed
- package/runtime/code changes are needed
- auth/access behavior changes are needed
- DB/schema changes are needed
- Hermes/MCP/autonomy would be involved

## Next Work Order Split

If approved:

- WO-DEPLOY-012A - Azure App Service Proof Provisioning

If env/secrets need a separate gate first:

- WO-DEPLOY-012B - Azure App Service Env and Secret Gate

If owner wants IaC before any Azure access:

- WO-DEPLOY-012C - Azure App Service IaC Design Packet

If deferred:

- WO-DEPLOY-012D - Azure Proof Hold / Product Work Resume Packet

If rejected:

- WO-DEPLOY-012E - Alternative Production Target Continuation

## Explicitly Not Authorized

This packet does not authorize:

- Azure login/access
- Azure resource creation
- deployment
- DNS changes
- Vercel changes
- env secret creation or migration
- GitHub rules changes
- package/dependency changes
- code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior

## Owner Decision Block

```text
OWNER_DECISION:
Approve Azure App Service proof provisioning: YES/NO
Azure subscription/tenant:
Resource group strategy:
Resource group name:
Azure region:
App Service Plan SKU:
Budget ceiling:
Proof app name:
Access/RBAC posture:
Deployment method preference:
Env migration authorized: YES/NO
DNS change authorized: NO unless separately approved
Vercel change authorized: NO unless separately approved
Deployment authorized: NO unless separately approved
Production cutover authorized: NO
Next authorized WO:
```
