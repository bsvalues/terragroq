# WO-LOCAL-002 Local Host Selection Packet

## Result

PASS / OWNER DECISION GATE.

This packet compares realistic local hosting targets and recommends the safest
first local deployment host for WilliamOS. It does not select hardware, purchase
hardware, install an OS, install packages, create services, change networking,
create a database, deploy, or configure secrets.

## Base

`origin/main = 51f6ac84c071d0b30d7f31f0b6b49b4ba6278358`

## Context

WO-LOCAL-001 established the local-server deployment lane. The long-term target
is a locally hosted computer/server, not Azure. No local mutation has been
authorized.

The immediate decision is the host class for the first safe local proof.

## Minimum and Recommended Hardware

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| CPU | 4 modern cores | 6-8 modern cores |
| RAM | 16 GB | 32 GB |
| Storage | 100 GB SSD free | 500 GB+ NVMe/SSD with backup target |
| Network | Stable wired LAN | Wired LAN plus VPN path later |
| Power | Owner-controlled outlet | UPS-backed if durable hosting |
| Noise/thermal | Stable under continuous load | Quiet, cool, easy to service |
| Expansion | Enough for OS/app/PostgreSQL/logs | Spare storage bay or external backup |

GPU is not required for the first WilliamOS local server. Current hosting needs
are Node.js, Next.js standalone serving, PostgreSQL, reverse proxy, backups, and
readiness checks. A GPU can matter for later local model inference, but it
should not drive the first hosting decision.

## OS Preference

Preferred OS: Ubuntu Server LTS.

Reason:

- strongest parity with Azure/Linux App Service proof
- straightforward Node.js, PostgreSQL, nginx, and `systemd` support
- predictable service restart behavior
- simple SSH administration
- better long-running server posture than a daily Windows desktop

Debian stable is acceptable if the owner prefers a more conservative Linux
base. Windows or WSL2 should be limited to temporary proofing unless explicitly
approved.

## Host Option Comparison

### Existing X99 Desktop/Server If Recoverable

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Potentially strong if it has enough RAM and SSD/NVMe storage. |
| PostgreSQL suitability | Good if storage is healthy and memory is sufficient. |
| Uptime/restart behavior | Good if configured as dedicated server; weak if hardware is unstable. |
| Thermal/reliability risk | Unknown; older platform needs stress test, disk SMART review, and fan/PSU check. |
| GPU relevance | Not relevant for first proof; remove/ignore GPU unless needed later. |
| LAN/VPN access | Good if wired Ethernet is stable. |
| Backup strategy | Requires separate backup target; do not rely on same internal disk. |
| Maintenance burden | Medium/high due to age and recoverability uncertainty. |
| Cost | Low if recoverable; hidden cost if parts are failing. |

Fit:

Useful if it can be recovered and proven stable. Not the safest first host if
hardware state is unknown.

### Newer Used Workstation/Server

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Strong; easy to target 6-8 cores, 32 GB RAM, SSD/NVMe. |
| PostgreSQL suitability | Strong for single-host app and DB proof. |
| Uptime/restart behavior | Strong if configured as dedicated always-on server. |
| Thermal/reliability risk | Lower than X99 if sourced carefully; still inspect drives and fans. |
| GPU relevance | Not needed; integrated/basic graphics is enough. |
| LAN/VPN access | Strong with wired LAN. |
| Backup strategy | Good if it supports extra disk or external backup. |
| Maintenance burden | Moderate. |
| Cost | Medium; best control-to-cost balance. |

Fit:

Best overall first-safe host if the owner is willing to acquire or dedicate one.

### Mini PC / NUC-Style Host

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Good if 16-32 GB RAM and NVMe storage are available. |
| PostgreSQL suitability | Good for light/medium local proof; storage endurance matters. |
| Uptime/restart behavior | Good when configured as always-on. |
| Thermal/reliability risk | Moderate; small chassis can throttle under sustained load. |
| GPU relevance | Not relevant. |
| LAN/VPN access | Good if wired Ethernet is available. |
| Backup strategy | External USB/NAS/cloud backup required. |
| Maintenance burden | Low. |
| Cost | Low/medium. |

Fit:

Good first proof if space, noise, and power are priorities. Less ideal if future
local workloads need expansion, heavy PostgreSQL, or local inference.

### Dedicated Local Tower

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Excellent; easiest path to RAM/storage expansion. |
| PostgreSQL suitability | Excellent. |
| Uptime/restart behavior | Strong if dedicated and UPS-backed. |
| Thermal/reliability risk | Low if modern, cooled, and not overloaded. |
| GPU relevance | Optional later; not needed now. |
| LAN/VPN access | Strong with wired LAN. |
| Backup strategy | Strong; can include separate internal backup disk plus off-host backup. |
| Maintenance burden | Moderate. |
| Cost | Medium/high depending on build. |

Fit:

Best durable local production posture, but may be more than needed for the first
proof.

### Temporary Laptop/Desktop Host

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Variable. |
| PostgreSQL suitability | Acceptable for smoke proof only. |
| Uptime/restart behavior | Weak; sleep, updates, battery, and daily-use conflicts are common. |
| Thermal/reliability risk | Moderate/high under always-on load. |
| GPU relevance | Not relevant. |
| LAN/VPN access | Often weaker if Wi-Fi-only. |
| Backup strategy | Often neglected; must be explicit. |
| Maintenance burden | High because it conflicts with normal use. |
| Cost | Low if already owned. |

Fit:

Acceptable only for short local smoke proof. Not recommended for durable
WilliamOS hosting.

### Cloud Fallback Only As Non-Primary

| Category | Assessment |
| --- | --- |
| CPU/RAM/storage | Flexible. |
| PostgreSQL suitability | Strong if managed DB is used. |
| Uptime/restart behavior | Strong. |
| Thermal/reliability risk | Outsourced. |
| GPU relevance | Not relevant. |
| LAN/VPN access | Not local-first; requires internet. |
| Backup strategy | Provider-backed options available. |
| Maintenance burden | Lower hardware burden, higher provider/cost/governance burden. |
| Cost | Recurring. |

Fit:

Useful fallback, staging, or remote-access option. Not the primary target for
this local-hosting lane.

## First-Safe Recommendation

Recommended first-safe host:

Newer used workstation/server dedicated to WilliamOS, running Ubuntu Server LTS,
with:

- 6-8 modern CPU cores
- 32 GB RAM
- 500 GB+ SSD/NVMe
- wired Ethernet
- stable power, preferably UPS-backed
- external/NAS/cloud backup target
- no requirement for GPU

Reason:

This gives the best balance of reliability, cost, local control, PostgreSQL
suitability, service restart behavior, and future headroom without overfitting
the first proof to old/unknown hardware or a daily-use machine.

Fallback recommendation:

If a newer used workstation/server is not immediately available, use a mini PC
with 32 GB RAM and NVMe storage for the first LAN-only proof. Treat it as a
proof host until backups and sustained-load behavior are verified.

Conditional X99 recommendation:

Use the existing X99 only if it is recoverable and passes a separate hardware
readiness check covering boot reliability, storage health, thermals, fan/PSU
condition, RAM stability, and network stability.

## Network / Access Constraints

First proof should be:

- wired LAN
- no public internet exposure
- no router port forwarding
- no DNS change
- no firewall change until separately authorized
- VPN access deferred until local LAN proof is stable

Public access should remain blocked until a separate hardening work order covers
TLS, reverse proxy, firewall, logging, rate limits, auth posture, and rollback.

## Backup Strategy Requirements

Before any durable data is trusted to the host:

- define PostgreSQL dump schedule
- define off-host backup target
- define restore test
- define retention policy
- define backup encryption posture
- record restore steps

For the first proof, backups may be documented before automation. For durable
production use, backup automation and restore verification are mandatory.

## Maintenance Burden

Lowest burden:

- mini PC / NUC-style host

Best balance:

- newer used workstation/server

Highest uncertainty:

- existing X99 if unrepaired or untested
- temporary laptop/desktop host

The owner should avoid a host that requires frequent manual recovery. WilliamOS
should be available as an operating console, not another fragile machine to
babysit.

## Owner Decision Gate

Owner must choose:

1. Use or acquire a newer used workstation/server.
2. Use a mini PC/NUC-style host.
3. Recover and qualify the existing X99.
4. Use a temporary laptop/desktop for smoke proof only.
5. Defer local host selection and keep Azure/Vercel as interim proof surfaces.

No host is selected by this packet.

## What Remains Blocked

Blocked until explicit owner approval:

- hardware purchase
- hardware repurpose
- OS install
- disk wipe/partitioning
- BIOS/firmware changes
- package installation
- Node/PostgreSQL/nginx installation
- service creation
- firewall/router/DNS changes
- database creation or migration
- `DATABASE_URL` or other secret configuration
- local deployment
- auth/access behavior changes
- Hermes/MCP/autonomy activation

## Next Recommended Work Order

`WO-LOCAL-003 - Local Host Readiness Checklist`

Purpose:

Define the inspection checklist for the selected or candidate host before OS
install or deployment work begins. If the owner chooses the X99 path, this WO
should include a recoverability and stability checklist before any production
expectations are placed on it.

Alternative:

`WO-LOCAL-003A - Local OS and Install Runbook` if the owner has already selected
a host and wants to design the Ubuntu Server LTS installation path.

## Explicit Non-Mutation Statement

This work order does not buy hardware, select a host, install an OS, install
packages, create services, change firewall/router/DNS settings, create or
migrate databases, configure secrets, deploy WilliamOS, or change
auth/access/Hermes/MCP/autonomy behavior.
