# WO-DEPLOY-007A Azure Production Fit Decision Packet

## Result

OWNER DECISION REQUIRED.

This packet evaluates whether Azure should become the primary WilliamOS
production target, a staging/proof target, part of a hybrid path, or deferred.
It does not authorize Azure login, resource creation, deployment, DNS changes,
Vercel changes, environment changes, package changes, or production writes.

## Context

WO-DEPLOY-006R rejected owned VPS/VM provisioning for now. Azure must be
evaluated before any infrastructure purchase or provisioning because future
county deployment direction may make Azure the better long-term target.

The current production posture remains:

- Vercel hosts current production.
- Vercel is non-blocking by default unless a Work Order targets Vercel or
  deployment behavior.
- WilliamOS needs repo-owned checks and deployed-commit provenance independent
  of Vercel.

## Decision Required

Choose Azure posture:

1. Primary production target
2. Staging/proof target
3. Hybrid target alongside Vercel or owned VPS
4. Deferred / not selected

Recommended decision: select Azure as the next design target for a staging/proof
environment, not immediate production.

## Azure Hosting Options

| Option | Fit | Strengths | Risks |
| --- | --- | --- | --- |
| Azure Container Apps | Strong proof candidate | Managed container runtime, scale controls, managed identity, Log Analytics, clear path to ACR and Key Vault | Requires containerization and Azure resource design |
| Azure App Service | Strong app-hosting candidate | Familiar web app hosting, built-in TLS/domain support, simpler than Container Apps for Node apps | Less explicit container/provenance flow unless designed carefully |
| Azure VM | Similar to owned VPS with Azure governance | Direct control, can align with Azure account/region policy | Retains OS hardening and ops burden |
| Azure Static Web Apps | Weak fit for current app | Good for static frontends | Current app has server routes, auth, database, and runtime checks |

## Recommended Azure Shape

Recommended first Azure proof: Azure Container Apps or Azure App Service.

Preference:

1. Azure Container Apps if WilliamOS accepts containerization.
2. Azure App Service if owner wants a simpler managed Node hosting path first.
3. Azure VM only if direct server control is required inside Azure.
4. Do not use Azure Static Web Apps for the current app shape.

Azure guidance indicates Container Apps generally implies:

- container image build
- Azure Container Registry
- managed identity for image pull
- Application Insights / Log Analytics
- Key Vault when secrets or dependency connection strings move into Azure

No Azure resources are created by this packet.

## County / Future Deployment Alignment

Azure is the strongest option if WilliamOS needs:

- county-aligned cloud posture
- enterprise identity and access patterns
- resource groups, managed identity, and auditability
- central logging and monitoring
- future private networking or compliance posture
- migration path from private WilliamOS proof to institutional deployment

Azure is weaker if the immediate goal is only:

- cheapest private host
- fastest manual proof
- minimal platform learning

## Cost / Risk / Operations Comparison

| Dimension | Azure Container Apps | Azure App Service | Azure VM | Vercel Preview |
| --- | --- | --- | --- | --- |
| Cost predictability | medium, needs budgets | medium, plan-based | medium, VM-based | limited by plan/rate limits |
| Ops burden | medium-low | low-medium | high | low |
| Control | medium-high | medium | high | low-medium |
| Provenance | high if designed | high if designed | high if designed | weak-to-medium |
| Security posture | strong with managed identity/Key Vault | strong with app settings/identity | depends on owner hardening | managed, but opaque |
| County fit | high | high | medium-high | low |
| Rollback | strong with deployment slots/revisions if designed | strong with slots if used | manual unless built | platform-managed but rate-limited |

## Production Provenance Model

Azure production or staging claims must include:

- approved source commit SHA
- build artifact or container image digest
- deployment timestamp
- Azure resource group
- Azure app/resource name
- deployment actor or pipeline
- health result
- auth readiness result
- security-header result
- rollback target

For Container Apps, image digest should be part of provenance.

For App Service, deployment artifact/build ID should be part of provenance.

For VM, release directory and commit SHA should be part of provenance.

## CI / Check Replacement Model

Before Azure becomes production-critical, WilliamOS needs repo-owned checks:

- `git diff --check`
- full test suite
- production build
- route smoke where safe
- security-header smoke
- auth readiness smoke
- access-grant disabled smoke while grants remain inactive
- Azure deployment provenance check only after Azure proof exists

Vercel preview/deploy remains non-blocking unless the Work Order targets Vercel
or deployment behavior.

## Secret and Env Handling Model

Current relevant environment categories:

- database: `DATABASE_URL`
- auth: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `BETTER_AUTH_TRUSTED_ORIGINS`, `AUTH_SIGNUP_MODE`
- email OTP scaffold: `AUTH_EMAIL_OTP_ENABLED`, `RESEND_API_KEY`,
  `AUTH_EMAIL_FROM`, `AUTH_EMAIL_REPLY_TO`
- access grants: disabled runtime flags and supporting secrets when later
  authorized
- model/gateway provider secrets such as `OPENAI_API_KEY` or equivalent
- platform-derived values such as Vercel URL variables should not be assumed in
  Azure

Azure target posture:

- use App Service/Container App secrets or Key Vault only after owner approval
- do not commit secrets
- do not migrate env until a separate env migration Work Order
- keep email OTP disabled unless separately authorized
- keep access grants disabled unless separately authorized

## Rollback Model

Azure proof must define rollback before production traffic:

- previous Azure revision, deployment slot, or image digest
- current Vercel production fallback while hybrid
- DNS rollback if any DNS cutover happens later
- auth origin rollback if domains change
- env rollback if secrets/settings change
- health/readiness/security verification after rollback

Recommended proof posture:

- no DNS cutover
- no production traffic
- no env migration unless separately approved
- use Azure proof hostname first

## Owner Decision Table

| Decision | Recommended Answer | Owner Answer |
| --- | --- | --- |
| Select Azure now? | Yes, as staging/proof target | Pending |
| Make Azure immediate production? | No | Pending |
| Preferred Azure hosting option | Container Apps or App Service | Pending |
| Allow Azure resource creation now? | No | Pending |
| Allow Azure login/use now? | No | Pending |
| Allow containerization work now? | No, decide first | Pending |
| Allow env migration now? | No | Pending |
| Allow DNS changes now? | No | Pending |
| Keep Vercel during proof | Yes, non-blocking preview/fallback | Pending |
| Next Work Order | Azure architecture/runbook design | Pending |

## Explicitly Not Authorized

- Azure login/use
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

## Next Recommended Work Order

`WO-DEPLOY-008A - Azure Architecture and Runbook Design`

Mode: design-only.

Goal: choose between Azure Container Apps and Azure App Service for a future
proof, define the Azure resource map, provenance model, secret strategy, and
rollback path without creating Azure resources.
