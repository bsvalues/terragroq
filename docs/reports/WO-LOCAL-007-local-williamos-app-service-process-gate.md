# WO-LOCAL-007 — Local WilliamOS App Service / Process Gate

## Result

PASS / OWNER PROCESS DECISION GATE.

This work order defines the safe local WilliamOS app process model before any durable Windows service, scheduled task, startup item, LAN exposure, or production-style local deployment is created.

No local service was created. No startup item was created. No local app process was changed.

## Base

```text
origin/main = 9644ccf7e1160ad799dd56c3d7f87c331f08b595
```

## Current Local Dependency State

WO-LOCAL-006C proved the local database dependency is ready:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432 -> container 5432
```

Coexistence boundaries remain:

```text
TerraFusion Postgres: untouched on 5432
Existing local postgres PID 10200: untouched on 5433
WilliamOS Postgres proof: isolated on 15432
```

## Process Options

### Option A — Manual `npm run dev`

Recommended for active development only.

Command shape:

```powershell
$env:DATABASE_URL = (Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app.env" | ConvertFrom-StringData).DATABASE_URL
npm run dev -- -p 3100
```

Strengths:

- Fast feedback.
- Turbopack development behavior.
- Good for UI and route iteration.
- No service or startup persistence.

Limits:

- Not representative of production startup.
- Requires an interactive terminal.
- Process exits when the terminal/session exits.
- Dev server should not be exposed publicly.

### Option B — Manual `npm run build && npm start`

Recommended first Phase 1 local proof mode.

Command shape:

```powershell
$env:DATABASE_URL = (Get-Content -LiteralPath "C:\Users\bsval\williamos-local-runtime\app.env" | ConvertFrom-StringData).DATABASE_URL
npm run build
npm run start -- -p 3100
```

Strengths:

- Uses the normal Next production server.
- Better proof than the dev server.
- Still manual and reversible.
- Does not require a service, scheduled task, or startup item.
- Good first target for local readiness verification.

Limits:

- Requires a terminal session.
- Manual restart after reboot.
- Logs need explicit redirection if persistence is required.

### Option C — Standalone `node server.js`

Recommended later, after a dedicated local artifact/process gate.

Command shape:

```powershell
npm run build
node .next\standalone\server.js
```

Strengths:

- Closest to Azure/App Service artifact work.
- Smaller runtime artifact.
- Better candidate for a future durable service.

Limits:

- Requires explicit artifact layout handling.
- Requires static asset handling verification.
- Needs a separate service/process gate before durable use.
- Not necessary for the first local Windows proof.

## Phase 1 Recommendation

Use manual `npm run build && npm start` on localhost for the first reliable local app proof.

Decision:

```text
Phase 1 mode: manual production build/start
Port: 3100
Binding: localhost first
Service: not yet
Startup item: not yet
Public exposure: blocked
```

Rationale:

- The local database proof is already green.
- The next risk is app process reliability, not LAN/public reachability.
- A manual production process gives better evidence than `npm run dev`.
- Durable Windows service/task behavior should be introduced only after manual process behavior is proven.

## Local Env Model

Local env values should remain outside the repository under:

```text
C:\Users\bsval\williamos-local-runtime
```

Recommended files:

```text
app.env       local WilliamOS app env values
compose.yaml local Postgres proof only
logs\         local app/process logs
backups\      local Postgres backups
```

Rules:

- Do not commit `DATABASE_URL`.
- Do not print secret values.
- Do not copy secrets into docs, PRs, logs, or screenshots.
- Report only env variable names and presence/absence.
- Keep `.env.local` as developer-local and uncommitted.
- Prefer operator-local env loading for proof runs.

Required local app env names for readiness:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
```

## Log Model

Phase 1 should use explicit operator-local log files:

```text
C:\Users\bsval\williamos-local-runtime\logs\williamos-app-YYYYMMDD-HHMMSS.log
```

Manual run example:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = "C:\Users\bsval\williamos-local-runtime\logs\williamos-app-$stamp.log"
npm run start -- -p 3100 *> $log
```

Rules:

- Do not commit logs.
- Redact any accidental secret-like values before sharing excerpts.
- Keep route verification evidence in reports, not raw full logs.

## Restart Strategy Options

### Phase 1 — Manual Restart

Recommended now.

- Operator starts the app manually.
- Operator stops the app manually.
- Reboot does not automatically restart WilliamOS.
- No service or scheduled task exists.

### Phase 2 — Windows Scheduled Task

Candidate after manual proof.

- Runs at logon or boot.
- Can restart after failure with task settings.
- Easier than Windows service for Windows 11 Home.
- Requires a dedicated gate before creation.

### Phase 3 — Windows Service Wrapper

Candidate later.

- Use a service wrapper only after process command, env loading, logs, and rollback are proven.
- Requires service creation approval.
- Requires explicit stop/remove command documentation.

### Phase 4 — Dedicated Ubuntu Server Service

Future always-on host path.

- Prefer `systemd` on a dedicated Ubuntu Server host.
- Better long-term operational model than Windows laptop hosting.
- Not part of Phase 1.

## Localhost / LAN Binding

Phase 1 binding:

```text
127.0.0.1:3100
```

LAN access should remain blocked until a separate network gate approves:

- host firewall posture
- LAN-only binding
- trusted device access
- reverse proxy
- TLS
- remote access model such as Tailscale or WireGuard

Public internet exposure remains blocked.

## Healthy Process Validation

The local app process is healthy when all checks pass:

```text
GET http://127.0.0.1:3100/                    200
GET http://127.0.0.1:3100/goal-console        200
GET http://127.0.0.1:3100/runtime             200
GET http://127.0.0.1:3100/work-orders         200
GET http://127.0.0.1:3100/api/health          200
GET http://127.0.0.1:3100/api/auth/readiness  200
```

Database proof should also remain green:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432 Listen
```

Safety checks:

```text
Access Grants: disabled
Email OTP: disabled unless separately approved
Hermes/MCP/autonomy: inactive
Public exposure: absent
Secrets disclosed: false
```

## Blocked Until Owner Approval

The following remain blocked:

- Windows service creation.
- Windows scheduled task creation.
- Startup folder or startup item creation.
- LAN binding.
- Firewall/router changes.
- DNS changes.
- Reverse proxy or TLS changes.
- Public internet exposure.
- Database migrations beyond explicitly scoped proof needs.
- Secret disclosure or committed secrets.
- Azure/Vercel changes.
- Production deployment.
- Auth/access behavior changes.
- Hermes/MCP/autonomy activation.

## Owner Decision Needed

Approve one of:

```text
Option A:
Use manual npm run build && npm start on 127.0.0.1:3100 as the Phase 1 process proof.

Option B:
Use npm run dev on 127.0.0.1:3100 for development-only proof.

Option C:
Design standalone node server.js local artifact proof before running it.

Option D:
Proceed to a Windows scheduled-task/service gate.
```

Recommended decision:

```text
Approve Option A first.
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Safety Posture

```text
SERVICE_CREATED: false
STARTUP_ITEM_CREATED: false
LOCAL_PROCESS_CHANGED: false
SECRETS_DISCLOSED: false
PUBLIC_EXPOSURE: false
FIREWALL_ROUTER_DNS_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

WO-LOCAL-008 — Local Manual Production Process Proof.

Purpose: run WilliamOS locally with `npm run build && npm start` against the isolated WilliamOS Postgres proof database, verify local routes, capture logs, and stop before creating any service or startup item.
