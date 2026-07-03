# Local WilliamOS Container Operator Runbook

## Purpose

This runbook documents the local WilliamOS container proof workflow for the Primary Operator.

It covers building, running, verifying, stopping, and cleaning up the local app container proof and the app-service Compose proof. It does not authorize persistent services, startup registration, LAN exposure, public exposure, schema migration, cloud changes, or autonomous workers.

## Prerequisites

Required local state:

```text
Repo: C:\Users\bsval\william-os-devops
Runtime folder: C:\Users\bsval\williamos-local-runtime
WilliamOS Postgres: williamos-postgres-proof
Postgres binding: 127.0.0.1:15432 -> container 5432
App image name: williamos-app-proof:local
App proof container: williamos-app-proof
Compose proof container: williamos-app-compose-proof
```

Required tools:

```text
Docker Desktop
PowerShell
Node/npm for repo validation
```

Required local files:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml
```

Required repo files:

```text
Dockerfile.local-app-proof
.dockerignore
```

## Safety Rules

Always enforce:

- Bind app containers to `127.0.0.1` only.
- Use container internal port `3000`.
- Prefer host port `3100`.
- Use host port `3101` only as the pre-authorized fallback if `3100` is unavailable.
- Never bind `0.0.0.0`.
- Never use host port `3000`.
- Do not commit env files.
- Do not print secret values.
- Do not bake secrets into images.
- Do not run DB migrations.
- Do not change TerraFusion PostgreSQL.
- Do not change Azure, Vercel, DNS, firewall, or router settings.
- Do not create Windows services, scheduled tasks, or startup items.
- Do not activate Hermes, MCP, autonomy, schedulers, or background workers.

## Env File Setup

Primary env file:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
```

Required names:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
AUTH_SIGNUP_MODE
PORT
HOSTNAME
```

For app-container proof against the existing host-bound Postgres, `DATABASE_URL` must point to:

```text
host.docker.internal:15432
```

Safe presence-only check:

```powershell
Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app-container.env" |
  ForEach-Object {
    if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$") {
      $state = if ($matches[2].Length -gt 0) { "present" } else { "empty" }
      Write-Output "$($matches[1])=$state"
    }
  }
```

Do not print values.

## Build Command

From the repo:

```powershell
cd C:\Users\bsval\william-os-devops
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:local .
```

Expected:

```text
image: williamos-app-proof:local
build: pass
```

Build-time Better Auth warnings are expected because secrets are not baked into the image. Runtime readiness must still pass after env is supplied at container run time.

## Single Container Run Command

Preferred host port:

```powershell
docker run -d --name williamos-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3100:3000 williamos-app-proof:local
```

Fallback host port, only if `3100` is unavailable:

```powershell
docker run -d --name williamos-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3101:3000 williamos-app-proof:local
```

Stop if both `3100` and `3101` are unavailable.

## Compose Proof Command

The first compose proof uses only the app service and the existing WilliamOS Postgres proof as an external dependency.

Start:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml up -d
```

Status:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml ps
```

Stop and remove app proof:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml down
```

Do not use:

```text
--remove-orphans
```

Reason:

```text
williamos-postgres-proof may appear as an orphan because it lives in the same operator-local runtime folder. It must not be removed by the app compose proof.
```

## Health Checks

Set the actual host port:

```powershell
$port = 3100
```

Run:

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
  $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port$route" -UseBasicParsing -TimeoutSec 20 -SkipHttpErrorCheck
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

Database proof:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

Expected:

```text
accepting connections
```

## Stop / Remove Commands

Single container:

```powershell
docker rm -f williamos-app-proof
```

Compose app proof:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml down
```

Image cleanup, optional:

```powershell
docker rmi williamos-app-proof:local
```

Keep the image if another local proof will run soon.

## Cleanup Verification

Verify no app container remains:

```powershell
docker ps -a --filter "name=williamos-app-proof"
docker ps -a --filter "name=williamos-app-compose-proof"
```

Verify no app port remains bound:

```powershell
Get-NetTCPConnection -LocalPort 3100,3101 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Verify Postgres remains healthy:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose ps
```

Expected:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432->5432
```

## Troubleshooting

### Port Conflict

Check:

```powershell
Get-NetTCPConnection -LocalPort 3100,3101,3000 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Rules:

- use `3100` if free
- use `3101` only if `3100` is occupied
- never use host `3000`
- never bind `0.0.0.0`
- stop if both `3100` and `3101` are unavailable

### Auth Readiness 503

Likely causes:

- `BETTER_AUTH_SECRET` missing from container env
- `BETTER_AUTH_URL` missing from container env
- `BETTER_AUTH_TRUSTED_ORIGINS` missing from container env

Check names only:

```powershell
docker exec williamos-app-proof sh -lc 'for k in DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL BETTER_AUTH_TRUSTED_ORIGINS AUTH_SIGNUP_MODE PORT HOSTNAME; do if [ -n "$(printenv $k)" ]; then echo "$k=present"; else echo "$k=missing"; fi; done'
```

Do not print values.

### Database Readiness 503

Likely causes:

- container cannot reach `host.docker.internal:15432`
- WilliamOS Postgres is not healthy
- `DATABASE_URL` is missing or malformed

Check:

```powershell
cd C:\Users\bsval\williamos-local-runtime
docker compose ps
docker compose exec -T postgres pg_isready -U williamos -d williamos_local
```

### Docker Build Context Error

If Docker cannot read local cache/tool folders, update `.dockerignore` rather than changing runtime behavior.

Known excluded folders:

```text
**/.pytest_cache
control-center
graphify
WilliamOS
.obsidian
.next
node_modules
```

### Stale `.next` During Repo Build

If `npm run build` fails with `EPERM` under `.next\standalone`, remove only generated `.next`:

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

## Known Stop Conditions

Stop immediately if:

- secrets would need to be printed, committed, or baked into the image
- a DB/schema migration is required
- production, Azure, Vercel, DNS, firewall, or router changes are required
- a service must bind to `0.0.0.0`
- host port `3000` is required
- both `3100` and `3101` are unavailable
- Hermes/MCP/autonomy/background workers are required
- package/dependency changes are required beyond the approved Dockerfile proof
- Docker behavior threatens `williamos-postgres-proof` on `127.0.0.1:15432`

## Safety Posture

```text
localhost only
operator-local env only
no committed secrets
no baked secrets
no DB migration
no public exposure
no service registration
no cloud mutation
no autonomy activation
```
