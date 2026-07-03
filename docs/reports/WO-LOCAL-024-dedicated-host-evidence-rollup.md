# WO-LOCAL-024 — Dedicated Host Evidence Rollup

## Result

PASS / BATCH COMPLETE.

`LOCAL-DEDICATED-HOST-BATCH-001` completed as a design/gate-only batch. No host mutation occurred.

The batch defines how WilliamOS can move from laptop-local container proof toward a dedicated always-on local host, while preserving the authority boundaries around hardware, OS configuration, networking, persistence, backup automation, observability, production, cloud, secrets, and autonomy.

## Base

```text
origin/main = 0ba1ebaf351246f79511ce691cda5cd9384cbf74
```

## Completed Work Orders

```text
WO-LOCAL-019 — Dedicated Host Requirements Gate
WO-LOCAL-020 — LAN Access Safety Gate
WO-LOCAL-021 — Persistent Local Service Gate
WO-LOCAL-022 — Backup/Restore Automation Gate
WO-LOCAL-023 — Observability / Logs Gate
WO-LOCAL-024 — Dedicated Host Evidence Rollup
```

## Merged PRs

```text
WO-LOCAL-019: PR #205
WO-LOCAL-020: PR #206
WO-LOCAL-021: PR #207
WO-LOCAL-022: PR #208
WO-LOCAL-023: PR #209
WO-LOCAL-024: current PR
```

## Evidence Rollup

### WO-LOCAL-019 — Dedicated Host Requirements Gate

Status:

```text
PASS / DESIGN GATE ONLY
```

Defined:

- dedicated host role
- minimum and recommended CPU/RAM/storage
- Ubuntu Server LTS as preferred dedicated-host OS
- Docker/runtime expectations
- WilliamOS-only PostgreSQL placement
- backup storage expectations
- localhost-first network assumptions
- Primary Operator access model
- power/restart expectations
- laptop-vs-dedicated-host differences

Safety:

```text
MUTATION_PERFORMED: false
```

### WO-LOCAL-020 — LAN Access Safety Gate

Status:

```text
PASS / DESIGN GATE ONLY
```

Defined:

- localhost-only default
- future LAN access conditions
- allowed and blocked bind addresses
- explicit block on `0.0.0.0`
- explicit block on host port `3000`
- firewall rule requirements for a later gate
- router/DNS prohibition
- auth/readiness prerequisites
- rollback path back to localhost-only

Safety:

```text
LAN_EXPOSURE_ENABLED: false
FIREWALL_CHANGED: false
DNS_CHANGED: false
```

### WO-LOCAL-021 — Persistent Local Service Gate

Status:

```text
PASS / DESIGN GATE ONLY
```

Defined:

- what may become persistent later
- what must not become persistent by default
- Ubuntu/systemd and Windows proof-host options
- conservative restart behavior
- required health checks
- manual stop commands
- safe boot behavior
- operator override requirements
- failure mode and rollback/removal plan

Safety:

```text
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
BACKGROUND_WORKER_STARTED: false
```

### WO-LOCAL-022 — Backup/Restore Automation Gate

Status:

```text
PASS / DESIGN GATE ONLY
```

Defined:

- backup targets
- backup cadence
- retention policy
- restore drill cadence
- backup storage location
- what must never be backed up automatically
- secret handling rules
- pre-upgrade backup requirement
- failure alert categories
- manual restore path

Safety:

```text
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_INSTALLED: false
SECRETS_DISCLOSED: false
```

### WO-LOCAL-023 — Observability / Logs Gate

Status:

```text
PASS / DESIGN GATE ONLY
```

Defined:

- app log categories
- database log categories
- container log evidence
- health endpoint checks
- readiness checks
- disk usage checks
- backup status checks
- operator dashboard/runbook expectations
- log retention
- redaction and secrets policy
- failure evidence model

Safety:

```text
MONITORING_INSTALLED: false
BACKGROUND_WORKER_STARTED: false
SECRETS_DISCLOSED: false
```

## Dedicated Host Status

```text
Dedicated host selected: not yet
Hardware mutated: false
OS installed/configured: false
Packages installed: false
Docker/Kubernetes mutated: false
LAN exposure enabled: false
Service registered: false
Startup item created: false
Schedule created: false
Monitoring installed: false
DB/schema changed: false
Secrets disclosed: false
Cloud settings changed: false
Production deployed: false
Hermes/MCP/autonomy activated: false
```

## Remaining Risks

### Host Not Selected

The dedicated always-on host is not selected yet.

Required next decision:

```text
approve inventory proof for a candidate dedicated host
```

### Ubuntu Server Not Installed

Ubuntu Server LTS is preferred, but no OS install or configuration is authorized.

Required next decision:

```text
approve or defer OS install/configuration on selected host
```

### LAN Access Remains Blocked

LAN access is intentionally still blocked.

Required next decision:

```text
approve LAN access implementation only after localhost proof on dedicated host succeeds
```

### Persistence Remains Blocked

No service manager, startup item, or restart policy exists.

Required next decision:

```text
approve persistent service implementation only after manual dedicated-host proof succeeds
```

### Backup Automation Remains Blocked

Manual backup/restore has been proven, but no automated backup schedule exists.

Required next decision:

```text
approve backup automation only after storage target and retention are confirmed
```

### Observability Remains Manual

Observability policy is defined, but no monitoring agent, scheduler, dashboard, or background worker is installed.

Required next decision:

```text
approve minimum monitoring implementation only after dedicated-host runtime is proven
```

## Owner Decisions Required

Before implementation:

1. Select or approve a candidate dedicated host.
2. Approve whether the host will run Ubuntu Server LTS.
3. Approve inventory-only proof.
4. Approve Docker runtime proof.
5. Approve localhost-only container proof on the dedicated host.
6. Approve manual backup/restore drill on the dedicated host.
7. Approve rollback drill.

Still blocked:

- hardware mutation
- OS install/configuration
- package install
- Docker/Kubernetes mutation
- service/startup registration
- LAN exposure
- firewall/router/DNS changes
- DB/schema migration
- cloud setting changes
- production deployment
- secret disclosure
- committed env files
- Hermes/MCP/autonomy activation
- background worker activation

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note:

```text
The generated .next directory was removed before the successful build to avoid the known Windows stale standalone artifact scan issue.
```

## Safety Posture

```text
HOST_MUTATION_PERFORMED: false
LAN_EXPOSURE_ENABLED: false
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
SCHEDULE_CREATED: false
MONITORING_INSTALLED: false
BACKGROUND_WORKER_STARTED: false
SECRETS_DISCLOSED: false
DB_SCHEMA_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended Batch

```text
LOCAL-DEDICATED-HOST-IMPLEMENTATION-BATCH-001
```

Recommended sequence:

```text
WO-LOCAL-025 — Dedicated Host Inventory Proof
WO-LOCAL-026 — Dedicated Host Docker Runtime Proof
WO-LOCAL-027 — Dedicated Host Localhost Container Proof
WO-LOCAL-028 — Dedicated Host Backup Manual Drill
WO-LOCAL-029 — Dedicated Host Rollback Drill
WO-LOCAL-030 — Dedicated Host Implementation Evidence Rollup
```

Do not start this implementation batch until the owner explicitly approves the dedicated-host implementation lane.
