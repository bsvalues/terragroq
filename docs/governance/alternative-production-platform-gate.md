# WO-DEPLOY-006R Alternative Production Platform Gate

## Result

OWNER DECISION REQUIRED.

The owned VPS/VM provisioning proof is rejected for now. This packet compares
Azure, Hostinger, owned VPS/VM, and hybrid options before any infrastructure is
provisioned or accessed.

## Reason

WilliamOS is not ready to cross into real infrastructure provisioning until the
platform choice is tighter. Azure needs direct comparison against Hostinger,
owned VPS/VM, and hybrid options because the long-term direction may include
county/Azure deployment needs.

## Current Constraints

This packet does not authorize:

- server provisioning or purchase
- server login or access
- SSH key creation or use
- DNS change
- Vercel change
- env secret creation
- GitHub ruleset or branch protection change
- deploy
- code/runtime behavior change
- DB/schema change
- auth/access behavior change
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Evaluation Criteria

| Criterion | Meaning |
| --- | --- |
| Production provenance | Can WilliamOS prove exactly which commit is deployed? |
| Control | Can the Primary inspect, operate, and recover the environment? |
| Operational burden | How much OS/network/platform work falls on the owner? |
| Security posture | How clear are secrets, network, identity, TLS, and patch controls? |
| Rollback | Can rollback be explicit, fast, and evidence-backed? |
| Cost predictability | Can cost be bounded before provisioning? |
| County/Azure direction | Does the path align with possible county or Azure-hosted future work? |
| Migration safety | Can proof happen without DNS cutover or production traffic? |
| Long-term fit | Does this become a durable WilliamOS operating home? |

## Option 1 - Azure

Likely shape:

- Azure Container Apps or Azure App Service
- Azure Container Registry if containerized
- Application Insights and Log Analytics
- Key Vault for secrets when moving past proof
- managed identity where applicable

Strengths:

- aligns best with county/Azure future direction
- strong identity, logging, monitoring, and enterprise governance path
- supports clear separation of staging and production
- can provide managed secret posture with Key Vault
- good long-term fit if WilliamOS needs institutional deployment patterns

Risks:

- higher configuration complexity than a simple VPS proof
- requires Azure subscription, identity, and resource governance decisions
- likely needs containerization or explicit App Service design
- costs can sprawl without budgets and resource hygiene

Best use:

- long-term production candidate
- county-aligned deployment track
- managed operational posture

Do not proceed until owner decides:

- Azure subscription/tenant
- service choice: Container Apps vs App Service
- resource group strategy
- identity/Key Vault posture
- budget ceiling
- whether containerization is acceptable

## Option 2 - Hostinger

Likely shape:

- managed VPS or web hosting plan
- simpler billing and hosting workflow
- manual or semi-managed server operations depending plan

Strengths:

- easier purchase and setup path for a small proof
- may be cheaper and simpler than Azure
- can provide a pragmatic bridge away from Vercel

Risks:

- may offer weaker enterprise identity, observability, and infrastructure
  governance than Azure
- provider-specific control panel can obscure provenance if not designed
  carefully
- rollback and deploy discipline still must be built by WilliamOS

Best use:

- low-friction proof or small private production host
- short-term bridge if Azure is too heavy for the next step

Do not proceed until owner decides:

- exact plan type
- SSH availability
- Node/runtime support
- firewall/TLS/log access
- backup/snapshot availability
- cancellation/rollback plan

## Option 3 - Owned VPS/VM

Likely shape:

- directly managed Linux VPS/VM
- reverse proxy
- process manager
- env file outside git
- commit provenance file or endpoint

Strengths:

- maximum control and inspectability
- simplest provenance story if disciplined
- no preview-platform rate limits
- strong fit for private Primary-operated WilliamOS

Risks:

- owner owns patching, hardening, backups, monitoring, and recovery
- mistakes in SSH, firewall, secrets, or TLS can create real exposure
- less aligned than Azure if county/enterprise deployment becomes primary

Best use:

- private operator proof
- infrastructure-learning path
- small production environment when owner accepts ops burden

Do not proceed until owner decides:

- provider
- region
- size
- SSH/key posture
- patching/backup/logging posture
- no-DNS proof strategy

## Option 4 - Hybrid

Likely shape:

- Vercel remains preview/staging and temporary fallback
- production proof happens on Azure, Hostinger, or VPS/VM
- traffic moves only after provenance, health, readiness, rollback, and auth
  origins are proven

Strengths:

- safest transition posture
- avoids abrupt Vercel removal
- preserves preview convenience while replacing production dependency
- lets WilliamOS compare actual proof evidence before cutover

Risks:

- split-brain risk if source of truth is unclear
- requires explicit rules for what is production vs preview
- Vercel can remain psychologically sticky unless an exit gate is set

Best use:

- recommended near-term posture
- production replacement proof without immediate cutover

Do not proceed until owner decides:

- which platform hosts the proof
- whether Vercel remains fallback or preview-only
- what evidence is required before cutover

## Decision Matrix

| Option | Control | Ops Burden | Azure/County Fit | Provenance | Short-Term Ease | Long-Term Fit |
| --- | --- | --- | --- | --- | --- | --- |
| Azure | medium-high | medium | high | high if designed | medium-low | high |
| Hostinger | medium | low-medium | low-medium | medium if designed | high | medium |
| Owned VPS/VM | high | high | medium | high if disciplined | medium | medium-high |
| Hybrid | high transition safety | medium | high if Azure-backed | high if required | high | high |

## Recommended Path

Recommended decision: Hybrid comparison continues, with Azure as the primary
long-term candidate and Hostinger/owned VPS as lower-friction proof candidates.

Recommended next step:

`WO-DEPLOY-007A - Azure Production Fit Decision Packet`

Reason:

- Azure is strategically important because of the county/Azure direction.
- It should be evaluated before any server is bought.
- The packet can stay design-only while deciding whether Azure Container Apps,
  Azure App Service, or Azure VM is the right production target.

Secondary option:

`WO-DEPLOY-007B - Hostinger / Simple VPS Proof Decision Packet`

Use only if the owner decides near-term simplicity matters more than Azure
alignment.

## Required Owner Inputs Before Any Provisioning

- preferred long-term direction: Azure, Hostinger, owned VPS, or hybrid
- monthly budget ceiling
- acceptable operational burden
- need for county/Azure alignment
- domain/cutover risk tolerance
- whether temporary proof host is acceptable
- whether containerization is acceptable
- whether managed secrets/identity are required for first proof

## Go / No-Go Table

| Decision | Recommended Answer | Owner Answer |
| --- | --- | --- |
| Provision infrastructure now | No | Pending |
| Compare Azure first | Yes | Pending |
| Keep Vercel during comparison | Yes, non-blocking | Pending |
| Allow DNS changes now | No | Pending |
| Allow env secret migration now | No | Pending |
| Allow deploy now | No | Pending |
| Next Work Order | Azure fit decision packet | Pending |

## Next Recommended Work Order

`WO-DEPLOY-007A - Azure Production Fit Decision Packet`

Mode: design-only.

Goal: decide whether Azure should become the primary production target before
any provider purchase, provisioning, DNS, env, deploy, or migration work begins.
