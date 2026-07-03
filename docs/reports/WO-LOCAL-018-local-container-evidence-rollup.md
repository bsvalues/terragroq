# WO-LOCAL-018 — Local Container Evidence Rollup

## Result

PASS / BATCH COMPLETE.

`LOCAL-CONTAINER-PROOF-BATCH-001` completed without triggering a batch stop condition.

WilliamOS now has a proven local container path from backup/restore safety through app image proof, reproducibility, compose app proof, and operator runbook coverage.

## Base

```text
origin/main = aa56c21fb02c3358b5f3d8663bede1ea002f836c
```

## Completed Work Orders

```text
WO-LOCAL-010 — Local Backup and Restore Drill
WO-LOCAL-011 — Container Stack Definition
WO-LOCAL-012 — App Container Proof Gate
WO-LOCAL-013 — Single App Image / Container Proof
WO-LOCAL-014 — Single App Container Reproducibility Proof
WO-LOCAL-015 — Compose Stack Dry Gate
WO-LOCAL-016 — Compose Local Stack Proof
WO-LOCAL-017 — Local Container Operator Runbook
WO-LOCAL-018 — Local Container Evidence Rollup
```

## Merged PRs

```text
WO-LOCAL-010: PR #196
WO-LOCAL-011: PR #197
WO-LOCAL-012: PR #198
WO-LOCAL-013: PR #199
WO-LOCAL-014: PR #200
WO-LOCAL-015: PR #201
WO-LOCAL-016: PR #202
WO-LOCAL-017: PR #203
WO-LOCAL-018: current PR
```

## Evidence Rollup

### WO-LOCAL-010 — Backup / Restore

Status:

```text
PASS / LIMITED DATASET
```

Evidence:

- created a WilliamOS local Postgres backup outside the repo
- restored it into a disposable isolated Postgres container
- verified source/restore table-list equivalence
- removed the restore container after proof
- TerraFusion unaffected
- production unaffected

Limitation:

```text
source database had zero public tables, so row-level application data recovery remains future proof work
```

### WO-LOCAL-011 — Container Stack Definition

Status:

```text
PASS / DESIGN ONLY
```

Evidence:

- defined app and Postgres service model
- defined port plan, volume plan, network plan, env file plan, health checks, logs, backup integration, and Kubernetes future mapping
- no containers created
- no stack started

### WO-LOCAL-012 — App Container Proof Gate

Status:

```text
PASS / OWNER IMPLEMENTATION GATE
```

Evidence:

- defined base image, runtime command, env handling, port binding, health checks, stop conditions, and cleanup
- specified internal port `3000`
- preferred host binding `127.0.0.1:3100`
- fallback host binding `127.0.0.1:3101`
- blocked `0.0.0.0` and host `3000`

### WO-LOCAL-013 — Single App Image / Container Proof

Status:

```text
PASS
```

Evidence:

- added `Dockerfile.local-app-proof`
- added `.dockerignore`
- built `williamos-app-proof:local`
- ran `williamos-app-proof` on `127.0.0.1:3100->3000`
- verified `/`, `/goal-console`, `/operator`, `/runtime`, `/work-orders`, `/api/health`, and `/api/auth/readiness`
- stopped and removed the proof container

Important finding:

```text
operator-local app-container.env must contain non-empty Better Auth values and container-reachable DATABASE_URL
```

### WO-LOCAL-014 — Reproducibility

Status:

```text
PASS
```

Evidence:

- rebuilt the image using the same command
- recreated the proof container using the same run command
- reran the same health/readiness checks
- removed the container again

Result:

```text
REPRODUCIBLE: true
SAME_COMMANDS_USED: true
HEALTHCHECKS_PASS: true
```

### WO-LOCAL-015 — Compose Stack Dry Gate

Status:

```text
PASS / DRY GATE ONLY
```

Evidence:

- defined compose service names, network, volume, env files, health checks, start/stop commands, cleanup commands, and stop conditions
- no compose file created in repo
- no stack started

### WO-LOCAL-016 — Compose Local Stack Proof

Status:

```text
PASS / APP-SERVICE COMPOSE PROOF
```

Evidence:

- created an operator-local compose proof file outside the repo
- started the app proof through Docker Compose
- bound `127.0.0.1:3100->3000`
- used existing external `williamos-postgres-proof` on `127.0.0.1:15432`
- verified shell, health, and readiness routes
- removed the app compose container after proof

Reason for app-service-only compose proof:

```text
Starting another Postgres service on 15432 would conflict with the existing healthy WilliamOS proof database. The batch safety rule required preserving that database.
```

### WO-LOCAL-017 — Container Operator Runbook

Status:

```text
PASS
```

Evidence:

- added `docs/runbooks/local-williamos-container-runbook.md`
- documented prerequisites, env setup, build command, run command, compose command, health checks, cleanup, port fallback, troubleshooting, and stop conditions

## Current Local Proof Status

```text
williamos-postgres-proof: healthy
Postgres binding: 127.0.0.1:15432 -> 5432
App image: williamos-app-proof:local exists locally
App proof container: not running
Compose app proof container: not running
Host app ports 3100/3101: not bound
TerraFusion PostgreSQL: unaffected
```

## Remaining Risks

### Empty Database Dataset

Backup/restore proved mechanics but not row-level application data recovery.

Next mitigation:

```text
run a future restore drill after non-sensitive local application data exists
```

### App-Only Compose Proof

The compose proof did not replace the active Postgres container with a full two-service compose stack.

Reason:

```text
avoided conflict with the existing healthy Postgres proof on 15432
```

Next mitigation:

```text
dedicated compose-stack migration gate if/when database ownership should move under a single compose file
```

### Build-Time Auth Warnings

Docker image builds emit Better Auth warnings because secrets are intentionally not baked into the image.

Status:

```text
acceptable for local proof; runtime readiness passes when operator-local env is supplied
```

### Operator-Local Env Dependence

The proof depends on correct `app-container.env` formatting.

Next mitigation:

```text
optional local env verification script or checklist, without printing values
```

### No Durable Service Yet

WilliamOS container proof is not registered as a Windows service, scheduled task, or startup item.

Status:

```text
intentional; persistent local service remains a future gate
```

## Safety Rollup

```text
SECRETS_DISCLOSED: false
SECRETS_COMMITTED: false
SECRETS_BAKED_IN_IMAGE: false
DB_SCHEMA_CHANGED: false
DB_MIGRATION_PERFORMED: false
PRODUCTION_AFFECTED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
PUBLIC_EXPOSURE: false
HOST_3000_USED: false
BOUND_0_0_0_0: false
SERVICE_CREATED: false
STARTUP_ITEM_CREATED: false
HERMES_MCP_AUTONOMY_CHANGED: false
BACKGROUND_WORKER_STARTED: false
```

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

## Production Verification

Canonical production was verified unchanged after the docs-only evidence rollup:

```text
https://terragroq.vercel.app/api/health: 200
https://terragroq.vercel.app/api/auth/readiness: 200
https://terragroq.vercel.app/goal-console: 200
x-powered-by: absent
```

## Next Recommended Batch

`LOCAL-DEDICATED-HOST-BATCH-001`

Recommended sequence:

```text
WO-LOCAL-019 — Dedicated Host Requirements Gate
WO-LOCAL-020 — LAN Access Safety Gate
WO-LOCAL-021 — Persistent Local Service Gate
WO-LOCAL-022 — Backup/Restore Automation Gate
WO-LOCAL-023 — Observability/Logs Gate
```

Do not start this batch until the owner explicitly approves the dedicated-host lane.
