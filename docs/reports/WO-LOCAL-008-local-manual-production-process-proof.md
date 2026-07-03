# WO-LOCAL-008 — Local Manual Production Process Proof

## Result

PASS.

WilliamOS successfully ran locally in manual production mode against the isolated WilliamOS PostgreSQL proof database.

No durable Windows service, scheduled task, startup item, public exposure, firewall/router/DNS change, Azure/Vercel change, production deployment, or Hermes/MCP/autonomy change was created.

## Base

```text
origin/main = 3ee43ea557c27c2e09c416220c44f7f0f3c3c9e6
```

## Local Database Proof

The existing WilliamOS-only PostgreSQL proof remained healthy:

```text
container: williamos-postgres-proof
binding: 127.0.0.1:15432 -> container 5432
status: healthy
pg_isready: accepting connections
```

Isolation boundaries remained intact:

```text
TerraFusion Postgres: untouched on 5432
Existing local postgres PID 10200: untouched on 5433
WilliamOS Postgres proof: isolated on 15432
```

## Manual Production Build

Command:

```text
npm run build
```

Result:

```text
pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Manual Production Process

Manual production process model:

```text
npm run start -- -H 127.0.0.1 -p 3100
```

Runtime env source:

```text
C:\Users\bsval\williamos-local-runtime\app.env
```

Secret handling:

```text
DATABASE_URL was loaded from operator-local env.
No secret values were printed, copied into this report, or committed.
```

Log handling:

```text
C:\Users\bsval\williamos-local-runtime\logs\williamos-prod-proof-*.log
```

The process was started manually for proof, then stopped after route verification.

## Local Route Proof

Verified against:

```text
http://127.0.0.1:3100
```

Results:

```text
/                    200
/goal-console        200
/operator            200
/runtime             200
/work-orders         200
/api/health          200
/api/auth/readiness  200
```

Readiness summary:

```text
/api/health:
  status: ok
  database.ok: true
  auth.ok: true
  runtime.ok: true

/api/auth/readiness:
  ready: true
  databaseReady: true
  authReady: true
  emailOtp.enabled: false
  accessGrants.enabled: false
```

## Process Stop Proof

The wrapper process and remaining child Next process were stopped after verification.

Final port check:

```text
127.0.0.1:3100: no listener
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Safety Posture

```text
LOCAL_PROCESS_STARTED: true
LOCAL_PROCESS_LEFT_RUNNING: false
SERVICE_CREATED: false
SCHEDULED_TASK_CREATED: false
STARTUP_ITEM_CREATED: false
PUBLIC_EXPOSURE: false
FIREWALL_ROUTER_DNS_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
DB_MIGRATION_PERFORMED: false
SECRETS_DISCLOSED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

WO-LOCAL-009 — Local App Runbook and Operator Commands.

Purpose: document the exact start, stop, health-check, log, backup, and troubleshooting commands for the local WilliamOS proof without creating a durable service yet.
