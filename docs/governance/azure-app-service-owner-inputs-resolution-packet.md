# WO-DEPLOY-011C Azure App Service Owner Inputs Resolution Packet

## Result

OWNER INPUTS REQUIRED.

This packet turns the remaining Azure App Service proof inputs into explicit
owner decisions. It does not authorize Azure login, Azure resource creation,
deployment, env changes, DNS changes, Vercel changes, GitHub settings changes,
or production changes.

## Context

WO-DEPLOY-011B audited connected TerraFusion, TerraGroq, and WilliamOS
repositories/worktrees for existing Azure posture.

Useful prior evidence was found from the TerraFusion Benton Azure App Service
deployment path:

- Azure App Service was used successfully for a Benton demo.
- Prior App Service plan posture was B2 Linux.
- Prior region posture was West US 2.
- Prior proof used an Azure default hostname.
- Prior secret posture used App Service app settings / Key Vault patterns.
- Prior Azure PostgreSQL Flexible Server was referenced for the Benton demo.

Those are useful precedents, not WilliamOS authorization. WilliamOS/TerraGroq
still needs owner-specific inputs before provisioning.

## Decision Goal

Resolve whether WilliamOS should proceed toward an Azure App Service proof and,
if yes, define the exact owner-provided inputs needed for the next provisioning
gate.

Do not proceed to WO-DEPLOY-012A until this packet is answered.

## Recommended Defaults for Owner Review

These are defaults for review only. They are not authorization.

| Input | Recommended Default | Reason |
| --- | --- | --- |
| Platform | Azure App Service | Matches selected first proof path |
| Proof type | staging/proof only | Avoids accidental production migration |
| DNS posture | no-DNS proof | Use Azure default hostname first |
| Vercel posture | unchanged | Keep current production untouched |
| Env posture | no real secret migration until separate env gate | Prevents accidental secret movement |
| Region | West US 2 if owner confirms county/Azure alignment | Prior Benton precedent; still owner decision |
| SKU | B2 Linux if budget accepts prior Benton precedent | Prior Benton precedent; still owner decision |
| Naming style | WilliamOS-specific, not Benton-specific | Avoids carrying Benton demo identity into WilliamOS |
| Access posture | owner-controlled, least privilege, resource-group scoped | Matches Azure best-practice guidance |
| Deployment method | IaC/preview-first later | Avoids one-off portal drift |

## Required Owner Inputs

| Input | Required Owner Answer | Suggested / Notes |
| --- | --- | --- |
| Proceed with Azure App Service proof? | YES / NO | Required before any Azure access |
| Azure subscription/account | subscription ID/name or defer | Missing |
| Azure tenant posture | tenant ID/name or defer | Missing |
| Resource group strategy | create new / use existing | Prefer dedicated proof resource group |
| Resource group name | owner-selected | Suggested pattern: `rg-williamos-proof` |
| Region | owner-selected | West US 2 is only a prior precedent |
| App Service Plan SKU | owner-selected | B2 Linux is only a prior precedent |
| Monthly budget ceiling | owner-selected | Required before resource creation |
| Proof app name | owner-selected | Suggested pattern: `app-williamos-proof` |
| Plan name | owner-selected | Suggested pattern: `plan-williamos-proof` |
| Access/RBAC posture | owner-selected | Prefer least privilege and resource-group scope |
| Deployment method | owner-selected | Prefer IaC/preview-first |
| Env migration | YES / NO | Prefer NO until env gate |
| DNS change | YES / NO | Prefer NO for first proof |
| Vercel change | YES / NO | Prefer NO |
| Production cutover | YES / NO | Must remain NO for proof |

## Prior Benton Posture: Reuse, Adapt, or Reference

The prior TerraFusion Benton evidence should be treated as reference material.

| Prior Benton Item | Reuse? | Recommendation |
| --- | --- | --- |
| Azure App Service platform | yes, as pattern | Reuse as proof approach |
| B2 Linux SKU | maybe | Use only if budget approves |
| West US 2 region | maybe | Use only if owner confirms alignment |
| Benton app/resource names | no | Do not reuse for WilliamOS |
| Benton database posture | no | Do not reuse without separate DB/env gate |
| Key Vault/app-settings posture | yes, as pattern | Use only after env/secret gate |
| Azure default hostname proof | yes | Good no-DNS first proof posture |

## Proposed WilliamOS Naming Options

Owner must choose or replace these names before provisioning.

| Resource | Option A | Option B | Owner Choice |
| --- | --- | --- | --- |
| Resource group | `rg-williamos-proof` | `rg-terragroq-azure-proof` | Pending |
| App Service Plan | `plan-williamos-proof` | `plan-terragroq-proof` | Pending |
| App Service | `app-williamos-proof` | `app-terragroq-proof` | Pending |
| Managed identity | `id-williamos-proof` | `id-terragroq-proof` | Pending |
| Log Analytics | `log-williamos-proof` | `log-terragroq-proof` | Pending |
| Application Insights | `appi-williamos-proof` | `appi-terragroq-proof` | Pending |

Recommendation: use WilliamOS naming for owner-facing future posture and
avoid expanding legacy TerraGroq naming unless the repo/product name is required
for continuity.

## Access / RBAC Decision

Required before Azure login or resource creation:

| Decision | Recommended Default | Owner Answer |
| --- | --- | --- |
| Who performs Azure login? | Primary Operator or explicitly authorized agent session | Pending |
| Scope | resource group | Pending |
| Permission model | least privilege | Pending |
| Service principal now? | NO | Pending |
| Managed identity for app? | YES, during provisioning if approved | Pending |
| Key Vault access now? | NO | Pending |
| GitHub Actions Azure credentials now? | NO | Pending |

## Env / Secret Decision

Recommended default: no real secret migration in the first provisioning step.

| Variable / Secret Class | First Proof Recommendation | Owner Answer |
| --- | --- | --- |
| `DATABASE_URL` | do not migrate until env gate | Pending |
| `BETTER_AUTH_SECRET` | do not migrate until env gate | Pending |
| `BETTER_AUTH_URL` | set only after Azure proof hostname exists and env gate approves | Pending |
| `BETTER_AUTH_TRUSTED_ORIGINS` | set only after Azure proof hostname exists and env gate approves | Pending |
| Email OTP secrets | do not configure | NO |
| Access grant secrets | do not configure | NO |
| Social auth provider secrets | do not configure | NO |

If owner wants a proof that reaches `ready:true`, then a separate env/secret
gate must approve the minimum required app settings.

## DNS / Production Decision

Recommended default:

- DNS change: NO
- Vercel change: NO
- production cutover: NO
- use Azure default hostname for proof

The first Azure proof should not receive production traffic.

## Go / No-Go Table

| Gate | Status |
| --- | --- |
| Subscription/tenant selected | Missing |
| Resource group selected | Missing |
| Region selected | Missing |
| SKU/budget selected | Missing |
| Proof app name selected | Missing |
| Access/RBAC approved | Missing |
| Env migration approved | Not approved |
| DNS change approved | Not approved |
| Vercel change approved | Not approved |
| Production cutover approved | Not approved |
| Azure provisioning authorized | Not approved |

## Still Missing

The following must be answered before Azure provisioning:

1. Azure subscription/account
2. Azure tenant posture
3. resource group name/strategy
4. region
5. App Service Plan SKU and budget ceiling
6. proof app name and naming convention
7. access/RBAC posture
8. env migration decision
9. no-DNS proof confirmation
10. explicit provisioning authorization

## Next Work Order Split

If the owner answers all required inputs and approves provisioning:

- WO-DEPLOY-012A - Azure App Service Proof Provisioning

If owner wants env/secret design first:

- WO-DEPLOY-012B - Azure App Service Env and Secret Gate

If owner wants IaC design before Azure access:

- WO-DEPLOY-012C - Azure App Service IaC Design Packet

If owner defers Azure:

- WO-DEPLOY-012D - Azure Proof Hold / Product Work Resume Packet

If owner rejects Azure:

- WO-DEPLOY-012E - Alternative Production Target Continuation

## Explicitly Not Authorized

This packet does not authorize:

- Azure login/access
- Azure resource creation
- deployment
- DNS changes
- Vercel changes
- env secret creation or migration
- GitHub settings/rules changes
- package/dependency changes
- code/runtime behavior changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy
- release/tag
- production-write behavior
- secret disclosure

## Owner Decision Block

```text
OWNER_DECISION:
Proceed with Azure App Service proof: YES/NO
Azure subscription/account:
Azure tenant posture:
Resource group strategy:
Resource group name:
Azure region:
App Service Plan SKU:
Monthly budget ceiling:
Proof app name:
Plan name:
Access/RBAC posture:
Deployment method:
Use prior Benton posture as: reference / default / reject
Env migration authorized: YES/NO
DNS change authorized: NO unless separately approved
Vercel change authorized: NO unless separately approved
Production cutover authorized: NO
Azure provisioning authorized: YES/NO
Next authorized WO:
```
