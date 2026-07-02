# WO-LOCAL-001 Local Server Deployment Requirements Gate

## Result

PASS / OWNER DECISION GATE.

This work order defines the requirements for a future local hosted
computer/server deployment. It does not deploy WilliamOS locally, install
packages, create services, change firewall/router/DNS settings, create a
database, configure secrets, or mutate the local machine.

## Base

`origin/main = 12d6e23ae85730331ea4f7d34a5cebcd764bad6d`

## Context

Azure proof established:

- startup works with `node server.js`
- root and shell routes serve from Azure
- API readiness fails only because `DATABASE_URL` is not configured
- no Azure database has been authorized
- long-term target is a local hosted computer/server, not Azure

The local server lane should now define requirements before any implementation
or machine mutation occurs.

## 1. Target Local Machine / Server

Owner decision required.

Recommended target profile:

| Requirement | Recommendation |
| --- | --- |
| Role | Dedicated WilliamOS host or always-on owner-controlled workstation |
| Ownership | Primary-controlled machine only |
| Availability | Stable power, stable network, restart-safe |
| CPU | 4+ modern cores recommended |
| Memory | 16 GB minimum, 32 GB preferred if PostgreSQL and app run together |
| Storage | SSD/NVMe, 100 GB free minimum for app, database, logs, backups |
| Backup target | Separate disk/NAS/cloud backup target, not only same system disk |

Do not use a daily-use laptop as the durable production host unless the owner
explicitly accepts downtime, sleep-mode risk, and operational fragility.

## 2. Required / Preferred OS

Preferred: Linux server OS.

Recommended options:

| OS | Fit |
| --- | --- |
| Ubuntu Server LTS | Recommended first local production target. Strong Node/PostgreSQL/nginx/systemd support. |
| Debian stable | Good alternative for conservative server posture. |
| Windows 11/Windows Server | Possible, but less preferred for service/process/proxy parity with Linux hosting. |
| WSL2 on Windows | Useful for proofing, not preferred as durable production. |

Recommendation:

Use Ubuntu Server LTS on a dedicated local machine or VM for the first durable
local deployment proof.

## 3. App Start and Restart Model

Preferred production model:

- build standalone artifact
- run `node server.js`
- manage process with `systemd`
- run as a dedicated non-admin service user
- restart on failure
- restart after host reboot
- write logs to journald and/or file target with rotation

Alternative proof model:

- run app manually from a terminal for a short validation session
- not acceptable as durable hosting

Blocked until owner approval:

- creating a service user
- creating a `systemd` unit
- installing Node
- installing process managers
- configuring auto-start

## 4. PostgreSQL Placement

Decision required before local readiness can be green.

Options:

| Option | Description | Recommendation |
| --- | --- | --- |
| Local PostgreSQL on same server | App and DB on one local host. | Best first local proof if owner accepts single-host coupling. |
| Separate local database host/NAS/VM | App host connects to DB on another local machine. | Better separation, more network complexity. |
| Existing managed Postgres | Local app uses an external managed DB. | Useful if already approved, but not fully local. |
| Containerized Postgres | Postgres runs in Docker/Podman. | Good for proof, requires container runtime decision. |

Recommended first proof:

Local PostgreSQL on the same Ubuntu Server LTS host, with backups configured
before any real production data is entrusted to it.

Schema migration remains a separate owner gate.

## 5. `DATABASE_URL` Storage

`DATABASE_URL` is a secret.

Preferred storage options:

| Option | Fit |
| --- | --- |
| root-readable environment file referenced by `systemd` | Recommended first local proof. |
| local secret manager / vault | Better durable posture; more setup. |
| shell profile | Not recommended for service deployments. |
| committed `.env` file | Blocked. |

Rules:

- never commit `DATABASE_URL`
- never print the value in reports or PRs
- store with least-readable file permissions
- rotate if exposed
- document only presence/absence and variable name

## 6. LAN / VPN Access Model

Recommended default: LAN-only first.

Options:

| Model | Description | Recommendation |
| --- | --- | --- |
| Localhost only | Access from host only. | Good first smoke proof. |
| LAN-only | Access from trusted local network. | Recommended first usable local mode. |
| VPN-only remote access | Access remotely through Tailscale/WireGuard/Zero Trust tunnel. | Preferred before any public exposure. |
| Public internet | Direct public access. | Blocked until separate hardening gate. |

The first local deployment should not require public internet exposure.

## 7. Public Internet Access

Default: blocked.

Public internet access should remain blocked until separate owner approval covers:

- domain/DNS
- TLS
- reverse proxy hardening
- firewall rules
- auth posture
- rate limits
- logging
- backup/restore
- incident rollback

## 8. Reverse Proxy / SSL Model

Recommended local progression:

1. Direct local port smoke test: `http://localhost:<port>`
2. LAN HTTP proof behind reverse proxy
3. LAN/VPN HTTPS proof
4. Public HTTPS only if separately authorized

Reverse proxy options:

| Proxy | Fit |
| --- | --- |
| nginx | Recommended first durable local proxy. |
| Caddy | Good option for automatic TLS, especially public/domain later. |
| Traefik | Better with containerized deployments; more moving parts. |

TLS options:

- LAN-only internal certificate
- VPN access with private hostname
- public Let's Encrypt certificate only after public DNS approval

## 9. Backup and Restore Requirements

No local production deployment should proceed without a backup plan.

Minimum requirements:

- PostgreSQL dump backup schedule
- backup destination outside the primary app directory
- at least one off-host backup target
- restore test procedure
- retention policy
- backup encryption if leaving the machine
- written recovery steps

Recommended backup artifacts:

- database dump
- app artifact version / commit SHA
- environment variable names, not values
- service unit/proxy config copies
- deployment evidence report

## 10. Monitoring / Readiness Checks

Success must be proven by checks, not assumptions.

Minimum local checks:

| Check | Expected |
| --- | --- |
| Process status | service running |
| Root route | 200 |
| `/goal-console` | 200 |
| `/operator` | 200 |
| `/runtime` | 200 |
| `/work-orders` | 200 |
| `/api/health` | 200 after DB configured |
| `/api/auth/readiness` | 200 after DB/auth config complete |
| Logs | no repeated startup errors |
| Reboot test | service returns automatically after reboot, if durable mode is approved |

Operational monitoring options:

- `systemctl status`
- `journalctl`
- local health check script
- LAN/VPN route probe
- disk space check
- PostgreSQL backup freshness check

## 11. What Remains Blocked Until Owner Approval

Blocked until a future owner-approved implementation work order:

- selecting the actual host
- installing Node/npm
- installing PostgreSQL
- installing nginx/Caddy/Traefik
- creating service users
- creating `systemd` services
- creating databases
- running schema migrations
- writing `DATABASE_URL`
- writing auth secrets
- changing firewall/router rules
- changing DNS
- enabling public access
- deploying WilliamOS locally
- changing auth/access behavior
- activating Hermes/MCP/autonomy
- configuring background workers
- creating releases/tags

## Recommended First Local Proof Sequence

Recommended next gates:

1. `WO-LOCAL-002 - Local Host Selection Packet`
2. `WO-LOCAL-003 - Local OS and Install Runbook`
3. `WO-LOCAL-004 - Local PostgreSQL Proof Gate`
4. `WO-LOCAL-005 - Local Standalone Artifact Deployment Gate`
5. `WO-LOCAL-006 - Local Reverse Proxy and LAN Access Gate`
6. `WO-LOCAL-007 - Local Backup and Restore Gate`

The first implementation should be a localhost-only or LAN-only proof. Public
internet exposure should remain out of scope until a separate hardening phase.

## Explicit Non-Mutation Statement

This work order does not mutate the local machine. It does not install
packages, create services, create databases, configure secrets, deploy, change
network/firewall/router/DNS, or alter auth/access/Hermes/MCP/autonomy behavior.
