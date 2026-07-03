# Local WilliamOS Operator Runbook

## Purpose

This runbook describes how the Primary Operator can safely operate the local WilliamOS proof environment on the OMEN Windows host.

This is a manual local proof runbook. It does not create a Windows service, scheduled task, startup item, public endpoint, firewall rule, router rule, DNS record, Azure change, Vercel change, production deployment, schema migration, or autonomous worker.

## 1. Environment Overview

The local WilliamOS proof environment contains:

- WilliamOS application repo: `C:\Users\bsval\william-os-devops`
- Operator-local runtime folder: `C:\Users\bsval\williamos-local-runtime`
- WilliamOS PostgreSQL container: `williamos-postgres-proof`
- WilliamOS PostgreSQL binding: `127.0.0.1:15432 -> container 5432`
- Docker runtime: Docker Desktop on Windows 11 Home
- Local app proof port: `127.0.0.1:3100`

Operator-local runtime files:

```text
C:\Users\bsval\williamos-local-runtime\compose.yaml
C:\Users\bsval\williamos-local-runtime\.env
C:\Users\bsval\williamos-local-runtime\app.env
C:\Users\bsval\williamos-local-runtime\logs\
C:\Users\bsval\williamos-local-runtime\backups\
```

Secret-handling rule:

```text
Do not print, commit, screenshot, paste, or copy secret values from .env, app.env, logs, shell history, or backup output.
```

TerraFusion separation:

```text
TerraFusion PostgreSQL is separate and remains on port 5432.
WilliamOS PostgreSQL is separate and remains on port 15432.
```

## 2. Startup Checklist

Run these commands from PowerShell unless noted otherwise.

### 2.1 Verify Docker Desktop

```powershell
docker version
docker compose version
docker ps
```

Expected:

- Docker commands return successfully.
- Docker Desktop is running.
- Existing TerraFusion containers are not modified.

### 2.2 Verify WilliamOS PostgreSQL

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose ps
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Expected:

```text
williamos-postgres-proof: Up / healthy
127.0.0.1:15432->5432/tcp
accepting connections
```

If the WilliamOS container is not running:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose up -d postgres
docker compose ps
```

### 2.3 Verify Local Environment Files

Check file presence only. Do not print secret values.

```powershell
Test-Path C:\Users\bsval\williamos-local-runtime\app.env
Test-Path C:\Users\bsval\williamos-local-runtime\.env
Test-Path C:\Users\bsval\william-os-devops\.env.local
```

Required app/runtime variable names:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
```

Safe presence-only check:

```powershell
$paths = @(
  "C:\Users\bsval\williamos-local-runtime\app.env",
  "C:\Users\bsval\william-os-devops\.env.local"
)
foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p) {
    Write-Output "FILE $p"
    Get-Content -LiteralPath $p | ForEach-Object {
      if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=") {
        Write-Output "  $($matches[1])=present"
      }
    }
  }
}
```

### 2.4 Build WilliamOS

```powershell
cd C:\Users\bsval\william-os-devops
npm run build
```

If build fails with a stale `.next\standalone` Windows `EPERM` scan error, remove only the generated `.next` directory inside the repo and rebuild:

```powershell
cd C:\Users\bsval\william-os-devops
$target = Resolve-Path -LiteralPath ".next" -ErrorAction SilentlyContinue
if ($target) {
  $root = (Resolve-Path -LiteralPath ".").Path
  if ($target.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $target.Path -Recurse -Force
  }
}
npm run build
```

### 2.5 Start WilliamOS in Production Mode

```powershell
cd C:\Users\bsval\william-os-devops
$env:DATABASE_URL = (Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app.env" | ConvertFrom-StringData).DATABASE_URL
npm run start -- -H 127.0.0.1 -p 3100
```

Optional log capture:

```powershell
cd C:\Users\bsval\william-os-devops
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = "C:\Users\bsval\williamos-local-runtime\logs\williamos-app-$stamp.log"
$env:DATABASE_URL = (Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app.env" | ConvertFrom-StringData).DATABASE_URL
npm run start -- -H 127.0.0.1 -p 3100 *> $log
```

### 2.6 Verify Routes

In a second PowerShell window:

```powershell
$routes = @(
  "/",
  "/goal-console",
  "/operator",
  "/runtime",
  "/work-orders",
  "/api/health",
  "/api/auth/readiness"
)
foreach ($route in $routes) {
  $res = Invoke-WebRequest -Uri "http://127.0.0.1:3100$route" -UseBasicParsing -TimeoutSec 20 -SkipHttpErrorCheck
  Write-Output "$route $($res.StatusCode)"
}
```

Expected:

```text
/                    200
/goal-console        200
/operator            200
/runtime             200
/work-orders         200
/api/health          200
/api/auth/readiness  200
```

## 3. Shutdown Checklist

### 3.1 Stop WilliamOS Application

If running in the foreground, press:

```text
Ctrl+C
```

Confirm no app process remains on port `3100`:

```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Expected:

```text
No listener on 3100.
```

If an orphan process remains, identify it before stopping:

```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Stop only the confirmed WilliamOS proof process:

```powershell
Stop-Process -Id <OwningProcess> -Force
```

### 3.2 Decide Whether PostgreSQL Stays Running

Default proof posture:

```text
Leave williamos-postgres-proof running unless intentionally stopping local database work.
```

To stop only WilliamOS PostgreSQL:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose stop postgres
```

Do not stop TerraFusion PostgreSQL as part of WilliamOS shutdown.

## 4. Health Verification

### Docker

```powershell
docker ps
```

Expected:

```text
williamos-postgres-proof: Up / healthy
terrafusion-postgres-dev: unchanged
```

### PostgreSQL

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Expected:

```text
accepting connections
```

### Application Port

```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Expected while app is running:

```text
127.0.0.1 3100 Listen <WilliamOS process id>
```

### Health Endpoint

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3100/api/health" -UseBasicParsing -TimeoutSec 20
```

Expected:

```text
HTTP 200
status: ok
database.ok: true
auth.ok: true
runtime.ok: true
```

### Readiness Endpoint

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:3100/api/auth/readiness" -UseBasicParsing -TimeoutSec 20
```

Expected:

```text
HTTP 200
ready: true
databaseReady: true
authReady: true
```

## 5. Backup Procedure

Backups must remain outside the repository.

Backup folder:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Backup naming convention:

```text
williamos-local-YYYYMMDD-HHMMSS.dump
```

Backup command:

```powershell
cd C:\Users\bsval\williamos-local-runtime
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Users\bsval\williamos-local-runtime\backups\williamos-local-$stamp.dump"
docker compose exec -T postgres pg_dump -U williamos -d williamos_local -Fc > $backup
```

Backup verification:

```powershell
Get-Item $backup | Select-Object FullName,Length,LastWriteTime
```

Expected:

- Backup file exists.
- File size is greater than zero.
- File is stored outside the repo.

Do not commit backups.

## 6. Restore Procedure

Prefer a disposable restore drill before any live recovery operation.

Disposable drill target:

```text
temporary PostgreSQL container
no host port binding
backup mounted read-only or from the operator-local backup folder
removed after verification
```

Disposable restore drill outline:

```powershell
cd C:\Users\bsval\williamos-local-runtime
$backupFile = "williamos-local-YYYYMMDD-HHMMSS.dump"
$container = "williamos-restore-drill-YYYYMMDD-HHMMSS"
docker run -d --name $container --network none -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=williamos_restore_drill -v "C:\Users\bsval\williamos-local-runtime\backups:/backup" postgres:16-bookworm
docker exec $container pg_isready -U postgres -d williamos_restore_drill
docker exec $container pg_restore -U postgres -d williamos_restore_drill "/backup/$backupFile"
docker exec $container psql -U postgres -d williamos_restore_drill -c "select current_database();"
docker rm -f $container
```

Use a live restore only after the Primary Operator explicitly approves replacing or rebuilding the local WilliamOS proof database.

Restore is destructive to the selected local WilliamOS database. Confirm the target and backup before proceeding.

Prerequisites:

- WilliamOS app process stopped.
- `williamos-postgres-proof` running and healthy.
- Backup file exists outside the repo.
- Backup file belongs to WilliamOS, not TerraFusion.

Restore sequence:

```powershell
cd C:\Users\bsval\williamos-local-runtime
$backup = "C:\Users\bsval\williamos-local-runtime\backups\<backup-file>.dump"
docker compose exec -T postgres dropdb -U williamos --if-exists williamos_local
docker compose exec -T postgres createdb -U williamos williamos_local
Get-Content -LiteralPath $backup -Encoding Byte -ReadCount 0 |
  docker compose exec -T postgres pg_restore -U williamos -d williamos_local --clean --if-exists
```

If PowerShell byte piping is unreliable for a large restore, copy the backup into the operator-local backup mount and restore from inside the container:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose exec -T postgres pg_restore -U williamos -d williamos_local --clean --if-exists /backup/<backup-file>.dump
```

Post-restore verification:

```powershell
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Then start WilliamOS and verify:

```text
/api/health          200
/api/auth/readiness  200
```

Recovery checklist:

- Confirm restore target was `williamos-postgres-proof`.
- Confirm TerraFusion was not touched.
- Confirm app readiness is green.
- Record backup filename and restore time in local operator notes.

## 7. TerraFusion Isolation Rules

TerraFusion PostgreSQL is not part of the WilliamOS runtime.

Do not:

- reuse TerraFusion PostgreSQL for WilliamOS
- modify TerraFusion PostgreSQL for WilliamOS
- stop TerraFusion PostgreSQL for WilliamOS
- migrate TerraFusion PostgreSQL for WilliamOS
- create WilliamOS objects inside TerraFusion PostgreSQL
- point WilliamOS `DATABASE_URL` at TerraFusion PostgreSQL

WilliamOS uses its own PostgreSQL runtime:

```text
williamos-postgres-proof
127.0.0.1:15432
```

## 8. Troubleshooting Guide

### Port Conflict

Symptoms:

- Docker fails to bind port `15432`.
- App fails to bind port `3100`.
- `EADDRINUSE` appears in app output.

Verification:

```powershell
Get-NetTCPConnection -LocalPort 15432,3100 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Resolution:

- For `15432`, stop only `williamos-postgres-proof` if it is the conflicting process.
- For `3100`, stop only the confirmed WilliamOS app process.
- Do not stop TerraFusion PostgreSQL.
- Do not stop local postgres PID `10200` on `5433`.

### Stale `.next`

Symptoms:

```text
EPERM: operation not permitted, scandir '.next\standalone\node_modules\react'
```

Cleanup:

```powershell
cd C:\Users\bsval\william-os-devops
$target = Resolve-Path -LiteralPath ".next" -ErrorAction SilentlyContinue
if ($target) {
  $root = (Resolve-Path -LiteralPath ".").Path
  if ($target.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $target.Path -Recurse -Force
  }
}
npm run build
```

### Missing `DATABASE_URL`

Expected readiness behavior:

```text
/api/health: 503 degraded
/api/auth/readiness: 503 ready false
```

Verification:

```powershell
Test-Path C:\Users\bsval\williamos-local-runtime\app.env
```

Presence-only check:

```powershell
Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app.env" |
  ForEach-Object {
    if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=") {
      Write-Output "$($matches[1])=present"
    }
  }
```

Recovery:

- Restore the operator-local `app.env` from a secure local copy.
- Do not commit `DATABASE_URL`.
- Do not paste `DATABASE_URL` into reports or chat.

### PostgreSQL Container Unhealthy

Diagnosis:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose ps
docker compose logs postgres --tail 80
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Recovery:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose restart postgres
docker compose ps
```

Validation:

```powershell
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Do not delete volumes unless a separate restore/rebuild gate authorizes it.

### Application Port Already In Use

Diagnosis:

```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Recovery:

- Confirm the owning process is the WilliamOS proof app.
- Stop only that process.

```powershell
Stop-Process -Id <OwningProcess> -Force
```

Verification:

```powershell
Get-NetTCPConnection -LocalPort 3100 -ErrorAction SilentlyContinue
```

Expected:

```text
No listener on 3100.
```

## 9. Operational Safety Rules

- Run localhost-first.
- Do not expose WilliamOS publicly from the OMEN host.
- Do not change firewall, router, or DNS settings without a separate gate.
- Do not commit secrets.
- Keep secrets operator-local.
- Keep backups outside the repository.
- Keep TerraFusion runtime isolated.
- Keep Azure proof independent.
- Keep Vercel production unchanged.
- Do not activate Hermes, MCP, autonomy, background workers, or scheduler behavior.
- Do not create Windows services, scheduled tasks, or startup items without explicit owner approval.

## 10. Validation Checklist

Before declaring the local proof healthy, verify:

```text
Docker Desktop is running.
williamos-postgres-proof is healthy.
127.0.0.1:15432 is bound to WilliamOS PostgreSQL.
TerraFusion remains unaffected on 5432.
WilliamOS app is running on 127.0.0.1:3100.
/ returns 200.
/goal-console returns 200.
/operator returns 200.
/runtime returns 200.
/work-orders returns 200.
/api/health returns 200.
/api/auth/readiness returns 200.
No secrets were printed or committed.
No public exposure exists.
```

Repository validation for runbook changes:

```powershell
cd C:\Users\bsval\william-os-devops
git diff --check
npm test -- --run
npm run build
```

