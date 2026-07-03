# WO-LOCAL-011 — Container Stack Definition

## Result

PASS / DESIGN ONLY.

This work order defines the target local WilliamOS Docker Compose stack for the OMEN proof environment. No new containers were created. No stack was started. No secrets were committed or disclosed.

## Base

```text
origin/main = 345491fb6ef4f922b716e9d134f1f0305d32b10d
```

## Current Local Proof State

Current approved runtime:

```text
williamos-postgres-proof: healthy
PostgreSQL binding: 127.0.0.1:15432 -> container 5432
Operator-local runtime: C:\Users\bsval\williamos-local-runtime
Backups: C:\Users\bsval\williamos-local-runtime\backups
Manual app proof: npm run build && npm run start -- -H 127.0.0.1 -p 3100
```

Isolation boundaries:

```text
TerraFusion PostgreSQL: separate, unchanged, port 5432
Existing local postgres PID 10200: separate, unchanged, port 5433
WilliamOS PostgreSQL: separate, port 15432
```

## Proposed Docker Compose Services

### `williamos-postgres`

Purpose:

```text
WilliamOS-owned local PostgreSQL database.
```

Initial image:

```text
postgres:16-bookworm
```

Container ownership:

```text
WilliamOS local runtime only.
Do not share with TerraFusion.
Do not reuse for unrelated projects.
```

Binding:

```text
127.0.0.1:15432 -> 5432
```

Health check:

```text
pg_isready -U williamos -d williamos_local
```

### `williamos-app`

Purpose:

```text
WilliamOS application runtime, replacing the manual npm start proof after owner approval.
```

Recommended first container approach:

```text
Build from the current repo using the existing Next.js standalone output.
Run node server.js or the equivalent proven start command inside the container.
Bind localhost only.
```

Initial binding:

```text
127.0.0.1:3100 -> container app port
```

Health check:

```text
GET http://127.0.0.1:3100/api/health
GET http://127.0.0.1:3100/api/auth/readiness
```

Ownership:

```text
WilliamOS local runtime only.
No public exposure.
No production cutover.
No service/startup item until separately approved.
```

### Future Optional Services

These are not part of the first compose-managed proof:

```text
williamos-proxy       optional local reverse proxy / TLS later
williamos-monitoring  optional health/log/metrics later
williamos-backup      optional scheduled backup helper later
```

All optional services require separate owner approval before implementation.

## Service Names and Ownership

Recommended service names:

```text
williamos-postgres
williamos-app
```

Recommended container names:

```text
williamos-postgres-local
williamos-app-local
```

Current proof compatibility:

```text
Existing proof container: williamos-postgres-proof
Future stack may either keep this name temporarily or migrate to williamos-postgres-local through an approved migration gate.
```

Ownership rules:

- WilliamOS containers are owned by WilliamOS only.
- TerraFusion containers are owned by TerraFusion only.
- Do not point WilliamOS app env at TerraFusion Postgres.
- Do not point TerraFusion app env at WilliamOS Postgres.
- Do not mix backup/restore paths between systems.

## Port Plan

Reserved local ports:

```text
5432   TerraFusion PostgreSQL; do not touch
5433   existing local postgres PID 10200; do not touch
15432  WilliamOS PostgreSQL
3100   WilliamOS local app proof
```

Recommended stack bindings:

```text
williamos-postgres: 127.0.0.1:15432 -> 5432
williamos-app:      127.0.0.1:3100  -> app port
```

LAN/public exposure:

```text
blocked until a separate network gate approves binding, firewall, reverse proxy, and access controls
```

## Volume Plan

Operator-local runtime root:

```text
C:\Users\bsval\williamos-local-runtime
```

Recommended folders:

```text
C:\Users\bsval\williamos-local-runtime\postgres-data
C:\Users\bsval\williamos-local-runtime\backups
C:\Users\bsval\williamos-local-runtime\logs
C:\Users\bsval\williamos-local-runtime\app
```

Current compose named volume:

```text
williamos-local-runtime_williamos_pgdata
```

Recommended transition:

```text
Keep the current named volume for the active proof.
Before migrating to bind-mounted postgres-data, run a separate volume migration gate with backup/restore validation.
```

Backup rule:

```text
Backups live outside the repo under C:\Users\bsval\williamos-local-runtime\backups.
```

Log rule:

```text
Logs live outside the repo under C:\Users\bsval\williamos-local-runtime\logs.
```

## Network Plan

Initial Docker Compose network:

```text
williamos-local-internal
```

Network posture:

```text
internal service-to-service network for app -> postgres
host bindings restricted to 127.0.0.1
no public exposure
no router changes
no firewall changes
no DNS changes
```

App-to-database path inside Docker:

```text
postgres://<user>:<password>@williamos-postgres:5432/williamos_local
```

Host-to-database path for operator proof:

```text
127.0.0.1:15432
```

## Env File Plan

Repo policy:

```text
No secrets committed.
No DATABASE_URL committed.
No secret values in docs, reports, PRs, screenshots, or logs.
```

Operator-local env files:

```text
C:\Users\bsval\williamos-local-runtime\.env
C:\Users\bsval\williamos-local-runtime\app.env
C:\Users\bsval\williamos-local-runtime\compose.env
```

Recommended split:

```text
.env         Docker Compose interpolation only
app.env      WilliamOS app runtime env names and values
compose.env  future non-secret compose labels/settings if needed
```

Required app env names:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
```

Optional/future env names:

```text
AUTH_SIGNUP_MODE
AUTH_EMAIL_OTP_ENABLED
AUTH_EMAIL_FROM
AUTH_EMAIL_REPLY_TO
RESEND_API_KEY
```

Email/provider env remains disabled unless separately approved.

## Health Checks

### PostgreSQL Health

Container health:

```text
pg_isready -U williamos -d williamos_local
```

Expected:

```text
accepting connections
```

### Application Health

HTTP checks:

```text
GET /api/health
GET /api/auth/readiness
GET /goal-console
GET /runtime
GET /work-orders
```

Expected:

```text
/api/health: 200 ok
/api/auth/readiness: 200 ready true
shell routes: 200
```

### Safety Health

Expected disabled states:

```text
Access Grants: disabled
Email OTP: disabled unless explicitly approved
Hermes/MCP/autonomy: inactive
Public exposure: absent
```

## Log Locations

Recommended host log paths:

```text
C:\Users\bsval\williamos-local-runtime\logs\app
C:\Users\bsval\williamos-local-runtime\logs\postgres
C:\Users\bsval\williamos-local-runtime\logs\backup
```

Initial recommendation:

```text
Use Docker logs for container stdout/stderr.
Export important proof logs manually into operator-local logs only when needed.
Do not commit logs.
```

Examples:

```text
docker compose logs williamos-app --tail 100
docker compose logs williamos-postgres --tail 100
```

## Backup / Restore Integration

Backup path:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Backup naming:

```text
williamos-local-YYYYMMDD-HHMMSS.dump
```

Backup command shape:

```text
pg_dump -U williamos -d williamos_local -Fc -f /backup/<backup-file>.dump
```

Restore-drill recommendation:

```text
Restore into a disposable isolated PostgreSQL container with no host port binding.
Verify catalog/table equivalence.
Remove the disposable container after proof.
```

Live restore rule:

```text
Do not restore into the active WilliamOS database without a separate owner-approved recovery work order.
```

## Manual-to-Compose Migration Path

### Phase 0 — Current State

```text
PostgreSQL: Docker Compose managed
WilliamOS app: manual npm run build && npm run start
```

### Phase 1 — Define App Container

Create a future Dockerfile/compose app service design without starting it.

Requirements:

- Use existing standalone build output or an explicitly approved container build path.
- Keep `127.0.0.1:3100` binding.
- Load env from operator-local file.
- Keep app logs outside repo.
- Do not expose LAN/public ports.

### Phase 2 — App Container Proof

Start only the WilliamOS app container with the existing local Postgres.

Validation:

```text
/                    200
/goal-console        200
/operator            200
/runtime             200
/work-orders         200
/api/health          200
/api/auth/readiness  200
```

### Phase 3 — Compose-Managed Local Stack

Run app and Postgres together under one WilliamOS compose stack.

Still blocked:

- no Windows service
- no scheduled task
- no startup item
- no public exposure

### Phase 4 — Durable Local Service

Only after the compose stack is proven:

- decide Windows scheduled task vs service wrapper
- define rollback/removal
- validate restart behavior
- keep localhost-first

## Kubernetes Future Mapping

Kubernetes is deferred until a dedicated Ubuntu Server or equivalent always-on host exists.

Compose to Kubernetes mapping:

```text
williamos-app       -> Deployment + Service
williamos-postgres  -> StatefulSet + PVC, or external managed/local Postgres
app.env             -> Secret/ConfigMap split
postgres-data       -> PersistentVolumeClaim
backups             -> CronJob + PersistentVolume / external storage
health checks       -> readinessProbe / livenessProbe
internal network    -> ClusterIP services
localhost binding   -> ingress disabled until network gate
```

Kubernetes requirements before implementation:

- dedicated host decision
- storage class decision
- backup destination decision
- secret management decision
- ingress/TLS decision
- monitoring/logging decision
- restore drill against Kubernetes storage

## Safety Boundaries

Blocked in this work order:

```text
CONTAINERS_CREATED: false
STACK_STARTED: false
SERVICE_CREATED: false
SCHEDULED_TASK_CREATED: false
FIREWALL_ROUTER_DNS_CHANGED: false
PUBLIC_EXPOSURE: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
DB_MIGRATION_PERFORMED: false
SECRETS_DISCLOSED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

Ongoing rules:

- Keep WilliamOS and TerraFusion databases separate.
- Keep host bindings on `127.0.0.1`.
- Keep secrets outside the repo.
- Keep backups outside the repo.
- Use disposable restore drills before live recovery.
- Do not create startup behavior until owner approval.

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Next Recommended WO

WO-LOCAL-012 — App Container Proof Gate.

Purpose: define the owner gate for containerizing the WilliamOS app and running it under Docker Compose against the existing isolated local PostgreSQL proof, without creating services, startup items, LAN exposure, or production deployment.
