# Local WilliamOS OMEN Manual Command Set

## Purpose

This is the canonical manual command set for WilliamOS on the HP OMEN Phase 1 host.

It keeps WilliamOS manual-only. It does not authorize service registration, scheduled tasks, automatic startup, LAN exposure, firewall changes, DNS changes, DB/schema migration, cloud changes, or autonomy activation.

## Manual Wrapper Pattern

Thin local wrappers may live under:

```text
scripts/local/
```

Naming convention:

```text
williamos-omen-<verb>.ps1
```

Approved wrapper verbs:

- `status`
- `start`
- `stop`
- `backup-check`

Wrappers must remain operator-triggered. They must not create services, scheduled tasks, startup entries, firewall rules, DNS/router changes, LAN bindings, cloud changes, DB/schema migrations, or autonomous/background workers.

Wrappers must not print secret values. They may report whether the operator-local env file exists, but not its contents.

Status helper:

```powershell
.\scripts\local\williamos-omen-status.ps1
```

The status helper is read-only. It reports container posture, ports, expected localhost URLs, backup directory presence, and manual-only safety posture. It does not start or stop containers.

Start helper:

```powershell
.\scripts\local\williamos-omen-start.ps1
```

The start helper starts only `williamos-omen-app-proof`. It requires the operator-local env file and existing `williamos-app-proof:omen` image. It binds `127.0.0.1:3100 -> 3000`, or `127.0.0.1:3101 -> 3000` only if `3100` is occupied. It stops if both ports are unavailable.

Stop helper:

```powershell
.\scripts\local\williamos-omen-stop.ps1
```

The stop helper stops and removes only `williamos-omen-app-proof`, then verifies ports `3100` and `3101`. It does not touch `williamos-postgres-proof`, TerraFusion containers, or unrelated local Postgres processes.

## Pre-Start Checks

Confirm repository state:

```powershell
git status --short
```

Confirm Docker is available:

```powershell
docker version
docker compose version
```

Confirm operator-local env exists without printing it:

```powershell
Test-Path -LiteralPath "C:\Users\bsval\williamos-local-runtime\app-container.env"
```

## Backup Reminder

Before meaningful local operation, take or confirm a recent WilliamOS PostgreSQL backup.

Meaningful local operation includes:

- work that changes local data
- extended manual operation
- troubleshooting that may alter runtime state
- any future persistence decision or proof
- any restore, upgrade, or migration rehearsal

Backup location:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Naming convention:

```text
williamos-omen-manual-backup-YYYYMMDD-HHMMSS.dump
```

Do not back up into the repository. Do not print or commit credentials, `.env` files, database URLs, or secret-bearing logs.

Minimum reminder checklist:

```text
backup exists in operator-local backup folder
backup timestamp is appropriate for the planned operation
backup is outside the repository
restore expectation is understood before risky work
TerraFusion PostgreSQL is not used or modified
```

## PostgreSQL Proof Status

```powershell
docker inspect -f '{{.State.Health.Status}}' williamos-postgres-proof
docker ps --filter name=williamos-postgres-proof --format "{{.Names}} {{.Status}} {{.Ports}}"
```

Expected:

```text
healthy
127.0.0.1:15432 -> 5432
```

## Port Checks

```powershell
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue
```

Expected before start:

```text
3100: not listening
3101: not listening
```

Stop if both ports are unavailable.

## Build App Image

```powershell
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
```

Do not change packages or dependencies to make this pass without a separate owner-approved work order.

## Manual App Run

Preferred:

```powershell
docker run -d --name williamos-omen-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3100:3000 williamos-app-proof:omen
```

Fallback if `3100` is occupied and `3101` is clear:

```powershell
docker run -d --name williamos-omen-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3101:3000 williamos-app-proof:omen
```

Blocked:

```text
0.0.0.0 binding
host port 3000
LAN/public exposure
```

## Health / Readiness Checks

For the preferred port:

```powershell
Invoke-WebRequest http://127.0.0.1:3100/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3100/goal-console -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3100/api/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:3100/api/auth/readiness -UseBasicParsing
```

Expected:

```text
/: 200
/goal-console: 200
/api/health: 200
/api/auth/readiness: 200
```

## Shell Route Check

Minimum shell route:

```powershell
Invoke-WebRequest http://127.0.0.1:3100/goal-console -UseBasicParsing
```

Use `3101` only if the fallback port was used.

## Manual Stop

```powershell
docker stop williamos-omen-app-proof
```

## Container Remove

```powershell
docker rm williamos-omen-app-proof
```

Forced cleanup only if needed:

```powershell
docker rm -f williamos-omen-app-proof
```

## Port Cleanup Verification

```powershell
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue
```

Expected after cleanup:

```text
3100: not listening
3101: not listening
```

## Common Failure Handling

### Port Conflict

Use `3101` only if `3100` is occupied. Stop if both are occupied.

### Missing Env

Do not print secrets. Confirm only the operator-local env path exists.

### Unhealthy Postgres

Do not run migrations or repairs automatically. Stop app proof and record evidence.

### Build Failure

Do not install packages or change dependencies without explicit approval.

### Readiness Failure

Inspect non-secret logs, stop/remove app container, and document the failure category.

## Safety Boundary

```text
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
LAN_EXPOSURE_ENABLED: false
PUBLIC_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```
