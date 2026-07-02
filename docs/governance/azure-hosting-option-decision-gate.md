# WO-DEPLOY-009A Azure Hosting Option Decision Gate

## Result

OWNER DECISION REQUIRED.

This gate asks the owner to choose the Azure hosting option before any Azure
login, resource creation, containerization, env migration, DNS, deployment, or
production change.

## Decision Required

Choose one:

1. Azure App Service proof
2. Azure Container Apps proof
3. Azure VM proof
4. Hybrid/deferred Azure path
5. No Azure proof

Recommended default: Azure App Service proof.

Reason:

- lowest-complexity managed Node hosting path
- avoids immediate containerization
- supports managed identity, App Insights, diagnostics, app settings, and future
  Key Vault integration
- keeps the proof focused on WilliamOS production fit rather than container
  build pipeline work

Container Apps remains the recommended later path if the owner explicitly
approves containerization and image-digest provenance as the proof model.

## Option Comparison

| Option | Complexity | Provenance | Security/Identity | Ops Burden | Fit |
| --- | --- | --- | --- | --- | --- |
| App Service | low-medium | deployment artifact/build ID | managed identity, diagnostics, app settings, optional Key Vault | low-medium | best first proof |
| Container Apps | medium-high | container image digest | user-assigned identity, ACR pull role, Log Analytics, optional Key Vault | medium | best long-term Azure-native path |
| Azure VM | high | release directory and commit SHA | owner-managed SSH/firewall/OS | high | only if VM-level control is required |
| Hybrid/deferred | low now | unchanged | unchanged | low now | good if owner is not ready for Azure proof |
| No Azure proof | none | unchanged | unchanged | none | only if Azure direction is rejected |

## App Service Proof Path

Select this if the owner wants:

- managed Azure proof with minimal app changes
- no containerization yet
- lower operational burden
- route-level proof before production cutover

Future proof resources may include:

- Azure App Service Plan
- Linux Azure App Service
- user-assigned managed identity
- Application Insights
- Log Analytics Workspace
- optional Key Vault after env gate approval

Future owner gates still required:

- Azure subscription/tenant
- resource group
- budget ceiling
- proof app name
- app settings/env migration
- DNS/no-DNS proof posture
- deployment approval

## Container Apps Proof Path

Select this if the owner wants:

- container image digest provenance
- stronger future service/worker boundary
- clearer path to Azure-native scaling and managed identity
- acceptance of containerization work before Azure proof

Future proof resources may include:

- Azure Container Apps environment
- Azure Container App
- Azure Container Registry
- user-assigned managed identity
- AcrPull role assignment
- Log Analytics Workspace
- Application Insights
- optional Key Vault after env gate approval

Future owner gates still required:

- containerization Work Order
- Dockerfile/.dockerignore approval
- ACR/image build strategy
- Azure subscription/tenant
- resource group
- budget ceiling
- env migration approval
- deployment approval

## Azure VM Proof Path

Select this only if the owner needs:

- VM-level control inside Azure
- parity with the owned VPS/VM runbook
- direct process/reverse-proxy management

Risks:

- highest operational burden
- OS hardening and patching remain owner responsibilities
- less benefit from managed Azure app platform

Future owner gates still required:

- VM provisioning approval
- SSH/key policy
- firewall posture
- process manager
- reverse proxy
- env migration
- deployment approval

## Deferred / No Azure Proof

Select this if:

- Azure is not yet strategically required
- budget or account posture is unclear
- owner wants to keep Vercel while product work continues
- owner wants Hostinger/owned VPS reconsidered before Azure

Next path would be a non-Azure platform decision packet or a return to product
work while Vercel remains non-blocking for docs/UI Work Orders.

## Cost, Security, and Provenance Summary

Cost:

- App Service is usually easier to bound by plan.
- Container Apps can be efficient but requires container/registry decisions.
- VM cost is predictable but adds operational burden.

Security:

- prefer managed identity for Azure-native resources
- do not migrate secrets without a separate env gate
- use Key Vault only after secret strategy is approved
- keep access grants and OTP disabled unless separately authorized

Provenance:

- App Service: deployment artifact/build ID plus commit SHA
- Container Apps: container image digest plus commit SHA
- VM: release directory plus commit SHA

## Required Owner Inputs

| Input | Required | Owner Answer |
| --- | --- | --- |
| Azure selected? | yes/no | Pending |
| Hosting option | App Service / Container Apps / VM / deferred / no | Pending |
| Azure subscription/tenant available? | before proof | Pending |
| Budget ceiling | before proof | Pending |
| Resource group strategy | before proof | Pending |
| Proof hostname posture | before proof | Pending |
| Env migration authorized? | no by default | Pending |
| DNS change authorized? | no by default | Pending |
| Containerization authorized? | only for Container Apps | Pending |
| Vercel role during proof | fallback/non-blocking recommended | Pending |

## Go / No-Go Checklist

| Gate | Go Criteria | Status |
| --- | --- | --- |
| Hosting option selected | one option chosen | Pending |
| Azure login/resource creation | explicitly approved later | Not approved |
| Env migration | explicitly approved later | Not approved |
| DNS change | explicitly approved later | Not approved |
| Deployment | explicitly approved later | Not approved |
| Access grants/OTP activation | explicitly approved later | Not approved |
| Hermes/MCP/autonomy | explicitly approved later | Not approved |

## Approved Path Split

If App Service is selected:

`WO-DEPLOY-010A - Azure App Service Proof Design Packet`

If Container Apps is selected:

`WO-DEPLOY-010B - Azure Container Apps Containerization Decision Packet`

If Azure VM is selected:

`WO-DEPLOY-010C - Azure VM Proof Decision Packet`

If Azure is deferred:

`WO-DEPLOY-010D - Production Platform Hold / Product Work Resume Packet`

If Azure is rejected:

`WO-DEPLOY-010E - Non-Azure Production Target Decision Packet`

## Explicitly Not Authorized

- Azure login or access
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
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Owner Decision Block

```text
OWNER_DECISION:
Azure selected: YES/NO
Hosting option: App Service / Container Apps / VM / deferred / no Azure
Budget ceiling:
Azure subscription/tenant posture:
Resource group posture:
Proof hostname posture:
Containerization authorized: YES/NO
Env migration authorized: NO unless separately approved
DNS change authorized: NO unless separately approved
Deployment authorized: NO unless separately approved
Vercel role during proof:
Next authorized Work Order:
```
