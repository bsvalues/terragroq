# WO-DEPLOY-006 Owned VPS/VM Proof Provisioning Gate

## Result

OWNER DECISION REQUIRED BEFORE PROVISIONING.

This packet defines the final gate before an owned VPS/VM proof may provision
or access any server. It does not authorize provisioning, purchase, SSH key
creation, server login, deployment, DNS changes, Vercel changes, environment
changes, GitHub rules changes, or production writes.

## Decision Required

Approve or reject moving from checklist/design into an actual owned VPS/VM
proof provisioning Work Order.

This is the first gate that can lead to infrastructure action. Approval must be
explicit and complete before any server is purchased, provisioned, accessed, or
configured.

## Required Owner Inputs

| Input | Required | Owner Answer |
| --- | --- | --- |
| Approve provisioning proof | yes | Pending |
| Provider | yes | Pending |
| Instance size | yes | Pending |
| Region | yes | Pending |
| Monthly budget ceiling | yes | Pending |
| Billing owner | yes | Pending |
| OS image | yes | Pending |
| SSH key source | yes | Pending |
| SSH key owner | yes | Pending |
| Admin source IP policy | recommended | Pending |
| Firewall posture | yes | Pending |
| Snapshot/backup posture | yes | Pending |
| Proof hostname strategy | yes | Pending |
| DNS change authorized | yes/no | Pending |
| Env secret migration authorized | yes/no | Pending |
| Vercel role during proof | yes | Pending |
| Rollback target | yes | Pending |

## Provider and Server Selection Checklist

Provider must support:

- predictable billing
- Linux LTS image
- SSH-key-only access
- firewall controls
- snapshots or backups
- stable public IP
- straightforward cancellation

Server must be sized at least:

- 2 vCPU
- 4 GB RAM
- 30 GB disk

Preferred proof posture:

- temporary hostname or direct IP proof first
- no DNS cutover
- no production traffic
- current Vercel production remains rollback/fallback

## Access and Security Checklist

Before server access is authorized:

- SSH key source is named
- SSH key owner is named
- password login disabled or scheduled to be disabled during bootstrap
- root login posture is defined
- admin source IP policy is defined or accepted as unrestricted temporarily
- firewall rules are named before execution
- app user name is defined
- secrets are not copied until a separate env gate authorizes them

Blocked at this gate:

- creating SSH keys
- uploading SSH keys
- logging into a server
- changing firewall rules
- creating app users
- installing packages

## Secret and Env Handling Checklist

No secrets may be created, copied, pasted, stored, or rotated by this gate.

Before any future env migration:

- env variable list is approved
- secret source is approved
- transfer method is approved
- storage path is approved
- file permissions are approved
- shell-history leakage prevention is defined
- rollback env posture is defined

Required default flags for proof:

```dotenv
AUTH_EMAIL_OTP_ENABLED=false
ACCESS_GRANTS_ENABLED=false
```

## DNS and No-DNS Proof Options

Preferred first proof:

- no DNS change
- verify against direct temporary hostname or provider-assigned address
- keep Vercel production unchanged

Acceptable proof options:

1. Provider temporary DNS name, if available.
2. Dedicated proof subdomain only after separate DNS approval.
3. Direct IP validation for health/readiness only, if auth origin behavior is
   explicitly understood.

Not authorized:

- production domain cutover
- root/apex record changes
- Vercel alias changes
- auth origin changes

## Rollback and No-Change Commitment

Current rollback target:

- existing Vercel production

Before production traffic can ever move:

- last-known-good commit is named
- rollback procedure is documented
- health/readiness rollback verification is documented
- DNS rollback plan exists if DNS changes are later approved
- env rollback plan exists if env changes are later approved

This gate does not authorize production traffic movement.

## Go / No-Go Table

| Gate | Go Criteria | Status |
| --- | --- | --- |
| Owner explicitly approves provisioning proof | written YES | Pending |
| Provider selected | provider named | Pending |
| Budget ceiling selected | amount named | Pending |
| Instance size selected | size named | Pending |
| SSH/key policy selected | policy named | Pending |
| Env migration | explicitly NO unless separately approved | Pending |
| DNS change | explicitly NO unless separately approved | Pending |
| Production traffic | explicitly NO unless separately approved | Pending |
| Rollback/fallback | Vercel remains available | Pending |
| Next Work Order | approved path or rejected path named | Pending |

## Approved Path

If owner approves provisioning proof:

Next recommended Work Order:

`WO-DEPLOY-007 - Owned VPS/VM Proof Provisioning`

Scope for that future Work Order must explicitly state:

- provider
- instance size
- region
- image
- SSH key source
- firewall rules
- billing owner
- no DNS change unless separately approved
- no env secret migration unless separately approved
- no deploy unless separately approved

## Rejected Path

If owner rejects provisioning proof:

Next recommended Work Order:

`WO-DEPLOY-006R - Alternative Production Platform Gate`

Scope:

- compare Azure, managed container hosting, and continued Vercel production
- avoid server operations
- keep Vercel non-blocking for docs/UI Work Orders where appropriate

## Hard Stop Conditions

Stop immediately if any next step requires:

- server purchase without owner approval
- server login
- SSH key creation or use
- DNS change
- Vercel setting or alias change
- env secret creation or transfer
- GitHub ruleset or branch protection change
- code/runtime behavior change
- DB/schema change
- auth/access behavior change
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Owner Decision Block

```text
OWNER_DECISION:
Approve owned VPS/VM provisioning proof: YES/NO
Provider:
Instance size:
Region:
Budget ceiling:
Billing owner:
OS image:
SSH key source:
SSH key owner:
Admin source IP policy:
Firewall posture:
Snapshot/backup posture:
Proof hostname strategy:
DNS change authorized: YES/NO
Env secret migration authorized: YES/NO
Production traffic authorized: NO
Vercel role during proof:
Rollback target:
Next authorized Work Order:
```
