# WO-DEPLOY-004 Owned VPS/VM Owner Decision Packet

## Result

OWNER DECISION REQUIRED.

This packet asks whether to approve an owned VPS/VM production proof for
WilliamOS. It does not authorize provisioning, server access, deployment, DNS
changes, Vercel changes, environment changes, GitHub rules changes, or
production writes.

## Decision

Approve or reject starting the owned VPS/VM proof.

Recommended decision: approve design-to-proof preparation only after the owner
selects the provider, domain posture, SSH/key policy, and budget ceiling.

## Context

WO-DEPLOY-002 recommended a hybrid production path:

- Vercel remains available for preview/staging during transition.
- Production moves toward an owned target after proof.
- The first replacement proof should be an owned VPS/VM.

WO-DEPLOY-003 defined the runbook for the owned VPS/VM proof:

- Linux LTS host
- reverse proxy
- TLS
- process manager
- env inventory without secrets
- deployed-commit provenance
- health/readiness/security-header checks
- rollback plan
- Vercel non-blocking unless the Work Order targets Vercel

## Approval Scope

If approved, the next phase should still be narrow and staged.

Approved by this decision packet only if owner answers `yes`:

- select VPS/VM provider
- select proof domain or temporary hostname strategy
- select SSH/key management policy
- select process manager and reverse proxy
- select provenance mechanism
- define budget ceiling
- create implementation checklist

Still requires separate authorization:

- server purchase or provisioning
- server login
- installing packages on a server
- copying secrets
- DNS change
- Vercel setting change
- production traffic cutover
- GitHub ruleset or branch protection change
- deploy execution

## Required Owner Inputs

| Input | Required Before Proof | Owner Answer |
| --- | --- | --- |
| Provider | yes | Pending |
| Region | yes | Pending |
| Monthly budget ceiling | yes | Pending |
| Domain or temporary hostname | yes | Pending |
| SSH key owner and storage policy | yes | Pending |
| Allowed admin IP policy | recommended | Pending |
| Process manager preference | yes | Pending |
| Reverse proxy preference | yes | Pending |
| TLS approach | yes | Pending |
| Log retention window | yes | Pending |
| Backup location | yes | Pending |
| Provenance mechanism | yes | Pending |
| Vercel role during proof | yes | Pending |

## Provider Selection Criteria

The provider should support:

- predictable monthly pricing
- Linux LTS image
- SSH key provisioning
- firewall controls
- snapshots or backup support
- stable public IP
- basic monitoring
- straightforward billing and cancellation

Reasonable candidates:

- Hetzner
- DigitalOcean
- Linode/Akamai
- Vultr
- Azure VM

The first proof should prefer operational clarity over cloud complexity.

## Budget and Risk Summary

Expected proof cost range:

- low: small VPS/VM suitable for validation
- medium: production candidate with more memory and snapshot support
- high: managed cloud VM with richer monitoring and network controls

Main risks:

- owner becomes responsible for OS patching and hardening
- secrets must be moved safely
- DNS cutover can break auth origins if rushed
- rollback must be proven before traffic migration
- production provenance must be observable before Vercel is downgraded

Mitigation:

- proof on temporary hostname first
- no DNS cutover until owner-approved
- no secret migration until env plan is approved
- no production traffic until health/readiness/security checks pass
- Vercel remains available during proof

## Go / No-Go Decision Table

| Question | Go Criteria | Owner Answer |
| --- | --- | --- |
| Approve owned VPS/VM proof? | yes/no explicitly recorded | Pending |
| Provider selected? | provider named | Pending |
| Budget approved? | monthly ceiling named | Pending |
| Temporary hostname strategy approved? | yes/no explicitly recorded | Pending |
| SSH/key policy approved? | yes/no explicitly recorded | Pending |
| Env migration approved? | no, separate gate required | Pending |
| DNS cutover approved? | no, separate gate required | Pending |
| Vercel role decided? | preview/staging during proof recommended | Pending |
| Rollback posture accepted? | rollback plan must exist before traffic | Pending |

## Rejection Path

If the owner rejects the VPS/VM proof:

Next recommended Work Order:

`WO-DEPLOY-004R - Alternative Production Target Decision`

Purpose:

- compare Azure, managed container hosting, and continued Vercel production
- keep Vercel non-blocking for docs/UI Work Orders where appropriate
- avoid server operations until a replacement target is approved

## Approval Path

If the owner approves the VPS/VM proof:

Next recommended Work Order:

`WO-DEPLOY-005 - Owned VPS/VM Proof Implementation Checklist`

Mode:

- implementation checklist only unless owner explicitly authorizes provisioning

Purpose:

- turn the runbook into a concrete checklist for the selected provider
- define exact commands without running them
- define exact env names without creating secrets
- define exact verification and rollback steps
- prepare the next authority gate for provisioning

## No-Change Commitment

Until a later Work Order is explicitly authorized, this decision packet does not
permit:

- deploy
- server login or provisioning
- DNS change
- Vercel change
- env secret creation
- GitHub ruleset or branch protection change
- package or dependency change
- code/runtime behavior change
- DB/schema change
- auth/access behavior change
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Owner Decision Block

Record the owner decision here before continuing:

```text
OWNER_DECISION:
Approve owned VPS/VM proof: YES/NO
Provider:
Region:
Budget ceiling:
Hostname/domain posture:
SSH/key policy:
Process manager:
Reverse proxy:
TLS approach:
Log retention:
Backup location:
Provenance mechanism:
Vercel role during proof:
Next authorized Work Order:
```
