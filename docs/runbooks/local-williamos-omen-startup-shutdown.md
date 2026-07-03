# Local WilliamOS OMEN Startup / Shutdown Runbook

## Purpose

This runbook defines manual startup and shutdown for WilliamOS on the HP OMEN Phase 1 host.

It does not authorize service registration, scheduled tasks, automatic startup, LAN exposure, firewall changes, DNS changes, DB/schema migration, or autonomy activation.

## Pre-Start Checklist

1. Confirm this is the Phase 1 OMEN host.
2. Confirm Docker Desktop is running.
3. Confirm the WilliamOS PostgreSQL proof container is healthy.
4. Confirm the operator-local env file exists outside the repo.
5. Confirm app ports are clear.
6. Confirm no app proof container is already running.

## Port Checks

Approved app ports:

```text
preferred: 127.0.0.1:3100 -> 3000
fallback: 127.0.0.1:3101 -> 3000
```

Blocked:

```text
0.0.0.0
host port 3000
LAN/public binding
```

PowerShell check:

```powershell
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue
```

Expected before start:

```text
3100: not listening
3101: not listening
```

## PostgreSQL Proof Check

Command:

```powershell
docker inspect -f '{{.State.Health.Status}}' williamos-postgres-proof
```

Expected:

```text
healthy
```

Current approved binding:

```text
127.0.0.1:15432 -> 5432
```

## App Start Command

Build or refresh local proof image:

```powershell
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
```

Start app container:

```powershell
docker run -d --name williamos-omen-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3100:3000 williamos-app-proof:omen
```

Fallback if `3100` is occupied and `3101` is clear:

```powershell
docker run -d --name williamos-omen-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3101:3000 williamos-app-proof:omen
```

If both `3100` and `3101` are occupied, stop and do not run.

## Health / Readiness Checks

For port `3100`:

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

Use `3101` in the URLs only if the approved fallback port was used.

## Shell Route Check

Minimum shell route:

```text
/goal-console
```

Optional shell routes:

```text
/operator
/runtime
/work-orders
```

## Normal Shutdown

```powershell
docker stop williamos-omen-app-proof
docker rm williamos-omen-app-proof
```

Verify app container is gone:

```powershell
docker ps -a --filter name=williamos-omen-app-proof
```

Verify app ports are clear:

```powershell
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue
```

## Forced Shutdown

Use only if normal shutdown fails:

```powershell
docker rm -f williamos-omen-app-proof
```

Then verify:

```powershell
docker ps -a --filter name=williamos-omen-app-proof
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue
```

## Container Cleanup

Allowed cleanup:

```powershell
docker rm -f williamos-omen-app-proof
```

Blocked cleanup:

```text
docker system prune -a
deleting WilliamOS PostgreSQL volume
deleting backup artifacts
stopping TerraFusion PostgreSQL
removing unrelated containers/images
```

## Port Cleanup Verification

Expected after shutdown:

```text
3100: not listening
3101: not listening
15432: listening if WilliamOS PostgreSQL proof is intentionally retained
```

## Known Failure Modes

### Port Already In Use

Symptoms:

- container fails to start
- Docker reports bind failure

Action:

1. check `3100`
2. use `3101` only if clear
3. stop if both are unavailable

### PostgreSQL Proof Unhealthy

Symptoms:

- `/api/health` returns degraded or 503
- `/api/auth/readiness` returns degraded or 503

Action:

1. do not run migrations
2. check `williamos-postgres-proof` health
3. stop app proof container
4. record evidence

### Missing Env File

Symptoms:

- app fails startup
- auth readiness fails

Action:

1. do not print secrets
2. verify env file path exists
3. stop the app container
4. recover operator-local env outside repo

### Build Fails

Action:

1. do not change packages without approval
2. collect non-secret error output
3. stop if package/dependency change is required

### Readiness Degraded

Action:

1. do not auto-repair
2. do not run migrations
3. stop app container if proof cannot pass
4. document reason category

## Safety Rules

```text
No service registration.
No scheduled task.
No automatic startup.
No LAN exposure.
No public exposure.
No host port 3000.
No 0.0.0.0 binding.
No DB/schema migration.
No secrets printed or committed.
No Hermes/MCP/autonomy activation.
```
