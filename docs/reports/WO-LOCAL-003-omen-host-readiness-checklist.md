# WO-LOCAL-003 Local OMEN Host Readiness Checklist

## Result

PASS / OWNER DECISION GATE.

This packet corrects the local hosting assumptions now that the current hardware
is known. The HP OMEN Gaming Laptop 16-ap0xxx is capable enough to serve as the
Phase 1 WilliamOS development and proof host. A dedicated Ubuntu Server machine
remains the better Phase 2 always-on hosting target.

This work order does not mutate the machine, install packages, create services,
change power/network settings, create a database, configure secrets, or deploy
WilliamOS.

## Base

`origin/main = dc74585f77dd72a4bc95257c0435125a18b2d456`

## Hardware Assumption Update

Known current host:

| Component | Host | Assessment |
| --- | --- | --- |
| Machine | HP OMEN Gaming Laptop 16-ap0xxx | Strong Phase 1 proof host |
| CPU | AMD Ryzen 9 8940HX, 16 cores / 32 threads | Excellent |
| RAM | 32 GB DDR5-5200 | Excellent for current app, PostgreSQL, and dev workload |
| GPU | NVIDIA RTX 5060 Laptop | Useful for later local AI; not required for WilliamOS web hosting |
| Storage | NVMe SSD assumed; must verify capacity and health | Likely strong, verification required |
| OS | Windows 11 Home | Good for development/proof; less ideal than Linux for always-on service hosting |
| Network | Wired Ethernet recommended | Required for reliable LAN-hosted proof |

## Corrected Recommendation

Phase 1 recommendation:

Use the OMEN laptop as the primary WilliamOS development and proof server.

Phase 1 can host:

- WilliamOS app
- TerraGroq app context
- PostgreSQL proof database
- Better Auth local/proof configuration
- local AI services if desired
- GitHub/development workflow

Phase 2 recommendation:

When always-on local hosting becomes the priority, migrate to a dedicated local
server such as:

- mini PC / NUC-style host
- Dell Precision
- HP Z2/Z4
- Lenovo ThinkStation
- dedicated local tower

Phase 2 should prefer:

- Ubuntu Server LTS
- PostgreSQL
- nginx or Caddy
- Tailscale or WireGuard for remote access
- automated backups
- service/process supervision

## Why This Changes WO-LOCAL-002

WO-LOCAL-002 treated a laptop/desktop host as temporary because generic laptops
often have weak thermals, sleep behavior, Wi-Fi-only networking, daily-use
conflicts, and limited upgrade/backup posture.

The OMEN is not a weak generic laptop. It has enough CPU and RAM for the current
WilliamOS proof workload. The remaining risks are operational rather than raw
compute capacity:

- sleep/hibernate behavior
- Windows service behavior
- update/restart timing
- thermal behavior under sustained load
- power stability
- wired network stability
- backup target availability

Those risks are manageable for Phase 1 proofing.

## Readiness Checklist

### Storage

Verify before local deployment:

- available free space
- SSD/NVMe health if tooling is available
- backup destination outside the project directory
- space for PostgreSQL data, logs, backups, and build artifacts

Minimum target:

- 100 GB free for proof
- 250 GB+ free preferred if PostgreSQL, backups, and local AI artifacts grow

### Network

Preferred:

- wired Ethernet
- stable LAN IP
- no public router port forwarding
- no DNS changes
- no firewall changes until separately authorized

Decision required:

- static DHCP reservation on router
- manual static IP on Windows
- dynamic IP accepted for localhost-only proof

Default:

Start with localhost-only or LAN-only proof. Defer VPN and public access.

### Power and Sleep

Verify before any LAN proof:

- disable sleep while plugged in if owner approves
- confirm lid-close behavior if external monitor/keyboard is used
- confirm Windows update restart posture
- consider UPS for durable hosting

Blocked until owner approval:

- changing power plan
- disabling sleep/hibernate
- changing BIOS settings

### Thermal and Reliability

Verify:

- sustained CPU load does not cause instability
- fans and vents are clear
- laptop can run plugged in for long sessions
- placement allows airflow

GPU is not required for WilliamOS web hosting. Do not use GPU workload as a
host-readiness requirement unless a later local AI work order scopes it.

### OS and Service Strategy

Current OS:

Windows 11 Home.

Phase 1 service options:

| Option | Fit |
| --- | --- |
| Manual terminal run | Good for first smoke proof only |
| PowerShell script | Good for repeatable developer proof |
| NSSM / Windows service wrapper | Possible durable Windows proof, requires separate approval |
| WSL2 | Good Linux-like proof, not ideal as durable production |
| Future Ubuntu Server host | Recommended Phase 2 durable target |

Recommendation:

Start Phase 1 with an explicit Windows proof runbook before creating any
service. Do not create Windows services until a service model is approved.

### PostgreSQL Strategy

Phase 1 options:

| Option | Fit |
| --- | --- |
| PostgreSQL on Windows | Direct and practical for local proof |
| PostgreSQL in WSL2 | Useful if app proof also runs in WSL2 |
| PostgreSQL in Docker Desktop | Good isolation, but introduces container dependency |
| Existing external DB | Possible only if owner provides non-production URL |

Recommendation:

Create a separate `WO-LOCAL-004 - Local PostgreSQL Deployment Plan` before
installing or creating any database.

Database remains blocked until owner approval.

### Secrets

Required later:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`

Rules:

- do not commit secrets
- do not print secret values in reports
- use local env file or OS secret approach only after approval
- document names and presence only

### Backup Destination

Owner must identify at least one backup target before durable local data is
trusted to the laptop.

Acceptable targets:

- external SSD/HDD
- NAS
- encrypted cloud backup
- second local machine

Minimum backup plan:

- PostgreSQL dump
- copy of deployment commit/artifact identifier
- environment variable names only
- restore test checklist

## Phase 1 Boundaries

Allowed after future approval:

- localhost proof
- LAN-only proof
- local PostgreSQL proof
- Windows runbook proof
- no public internet exposure

Blocked until separate owner approval:

- public access
- router port forwarding
- DNS changes
- TLS/public certificate
- Windows service creation
- PostgreSQL installation or DB creation
- schema migration
- secret configuration
- Hermes/MCP/autonomy activation
- auth/access behavior changes

## Phase 2 Migration Path

When the OMEN proof is stable and always-on hosting matters, migrate to a
dedicated local server:

1. Choose dedicated host.
2. Install Ubuntu Server LTS.
3. Install PostgreSQL.
4. Restore backup from OMEN proof if approved.
5. Deploy standalone WilliamOS artifact.
6. Configure reverse proxy and LAN/VPN access.
7. Validate readiness and backups.
8. Retire OMEN from hosting role and return it to development workstation role.

This avoids buying hardware before the stack is proven locally while preserving
a clean path to an always-on server later.

## Owner Decision Gate

Owner must confirm:

1. OMEN laptop is accepted as Phase 1 proof host.
2. Windows 11 Home is accepted as initial proof OS.
3. First proof is localhost-only or LAN-only.
4. No public internet exposure.
5. PostgreSQL plan comes before DB installation.
6. Backup destination will be identified before durable data is trusted.

No approval is granted by this packet.

## Next Recommended Work Orders

1. `WO-LOCAL-004 - Local PostgreSQL Deployment Plan`
2. `WO-LOCAL-005 - Local Windows Proof Runbook`
3. `WO-LOCAL-006 - Local Reverse Proxy and HTTPS Plan`
4. `WO-LOCAL-007 - Local Backup and Restore Plan`
5. `WO-LOCAL-008 - Local Production Deployment Packet`

## Explicit Non-Mutation Statement

This work order does not change the OMEN laptop. It does not alter power,
network, firewall, router, DNS, BIOS, Windows services, PostgreSQL, packages,
databases, secrets, deployment state, auth/access behavior, or
Hermes/MCP/autonomy.
