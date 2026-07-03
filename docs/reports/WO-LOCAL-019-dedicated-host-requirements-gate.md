# WO-LOCAL-019 — Dedicated Host Requirements Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the minimum dedicated always-on host requirements for a future WilliamOS local deployment. It does not authorize or perform hardware, operating system, package, Docker, database, service, network, firewall, DNS, cloud, or autonomy changes.

## Base

```text
origin/main = ea38d352b47e72e29f8d887c9d6a784515813316
```

## Host Role

The dedicated host should become the always-on local WilliamOS runtime after the OMEN laptop proof matures.

Primary responsibilities:

- run the WilliamOS application container
- run WilliamOS PostgreSQL or connect to a dedicated local PostgreSQL container
- retain local backups outside the application repository
- provide localhost-first operation with future LAN access only after a separate safety gate
- support manual operator maintenance, rollback, and evidence collection

The dedicated host is not an autonomy host. It must not activate Hermes, MCP, background workers, schedulers, or execution behavior unless a later owner-approved work order explicitly authorizes that boundary.

## CPU / RAM / Storage Minimums

Minimum acceptable host:

```text
CPU: 4 modern cores / 8 threads
RAM: 16 GB
Storage: 512 GB SSD
Network: wired Ethernet preferred
Power: stable mains power; UPS recommended before always-on trust
```

Recommended first always-on host:

```text
CPU: 6-8 modern cores or better
RAM: 32 GB
Storage: 1 TB NVMe SSD
Backup target: separate local disk, NAS, or external drive outside repo
Network: wired Ethernet
Power: UPS
```

GPU is not required for WilliamOS web/runtime hosting. A GPU may matter later for local AI services, but it should not be a requirement for the first dedicated host.

## OS Target

Preferred dedicated-host OS:

```text
Ubuntu Server LTS
```

Rationale:

- predictable Docker support
- stronger service-management model through systemd
- cleaner long-term server posture than Windows 11 Home
- easier backup, monitoring, and remote administration patterns

Acceptable proof/development OS:

```text
Windows 11 on the OMEN laptop
```

Windows remains valid for development and proof work, but the dedicated always-on host should be planned around Ubuntu Server LTS unless a later owner decision selects a different platform.

## Docker / Runtime Expectations

Required runtime model:

- Docker Engine or a supported Docker runtime
- Docker Compose plugin
- dedicated WilliamOS compose project name
- local-only default bindings
- explicit env files stored outside the repo
- container logs available to the operator
- no secrets baked into images

Deferred runtime model:

- Kubernetes remains a later migration path
- persistent service registration remains a later gate
- background worker activation remains blocked

## Postgres Placement

Phase 1 proof status:

```text
williamos-postgres-proof: existing local proof container
binding: 127.0.0.1:15432 -> 5432
```

Dedicated-host target:

- WilliamOS PostgreSQL should remain isolated from TerraFusion PostgreSQL.
- WilliamOS data should use its own database, user, volume, backup path, and restore drill.
- PostgreSQL may run as a Docker Compose service on the dedicated host after a later implementation gate.
- PostgreSQL must not reuse TerraFusion containers, ports, volumes, databases, or users.

## Backup Storage Expectations

Backups must live outside the repository.

Minimum backup storage:

```text
primary backup path: dedicated host backup directory outside repo
secondary copy: external disk, NAS, or another local machine
format: PostgreSQL custom-format dump where practical
retention: defined by WO-LOCAL-022
restore drill: required before trust
```

Backups must not include committed secrets, `.env` files, or raw credential material unless an explicitly encrypted secret backup plan is approved later.

## Network Assumptions

Default network posture:

```text
localhost-only
```

Future LAN access requires a separate owner-approved LAN safety gate. Public internet exposure is not part of this requirements gate.

Preferred physical network:

- wired Ethernet
- stable local IP assignment only after LAN gate approval
- no router, firewall, DNS, or public ingress changes in this batch

## Operator Access Model

Initial operator model:

- local console access to the dedicated host
- SSH may be considered in a later gate if Ubuntu Server is selected
- administrative access limited to the Primary Operator
- no team/admin workspace assumption
- no public access assumption

WilliamOS should remain a private Primary Operator command environment.

## Power / Restart Assumptions

Dedicated-host trust requires:

- automatic boot to a safe OS state
- no automatic WilliamOS exposure beyond approved bindings
- documented manual stop/start path
- documented recovery after power loss
- UPS strongly recommended before relying on the host for always-on operation

Persistent app/database startup must remain blocked until WO-LOCAL-021 defines the service policy and a later implementation gate approves actual registration.

## Laptop vs Dedicated Host Differences

The OMEN laptop remains the Phase 1 proof/development host.

Dedicated host differences:

- intended for always-on uptime
- should use wired Ethernet by default
- should not sleep/hibernate unexpectedly
- should have stronger backup discipline
- should use server-grade service management
- should reduce dependency on an interactive user session
- should be easier to recover after reboot/power loss

The laptop proof is successful, but it should not be treated as the final always-on architecture.

## Stop Conditions

The dedicated-host lane must stop before implementation if any next step requires:

- hardware purchase or mutation without owner approval
- OS install or configuration
- package installation
- Docker/Kubernetes mutation
- LAN exposure
- firewall, router, or DNS change
- DB/schema migration
- service or startup registration
- secret disclosure or committed env files
- cloud production behavior
- Hermes/MCP/autonomy activation

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note:

```text
The first build attempt hit the known stale generated .next/standalone Windows EPERM scan error.
The generated .next directory was removed from inside the repository and the build was rerun successfully.
```

## Safety Posture

```text
MUTATION_PERFORMED: false
HARDWARE_CHANGED: false
OS_CHANGED: false
PACKAGE_INSTALLED: false
DOCKER_MUTATED: false
SERVICE_REGISTERED: false
LAN_EXPOSURE_ENABLED: false
FIREWALL_CHANGED: false
DNS_CHANGED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-020 — LAN Access Safety Gate
```
