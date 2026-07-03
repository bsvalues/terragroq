# WO-LOCAL-006C — Local WilliamOS PostgreSQL Alternate Port Apply

## Result

PASS.

WilliamOS now has an isolated local PostgreSQL proof container bound to the owner-approved alternate port:

```text
127.0.0.1:15432 -> container 5432
```

This avoids the existing local database listeners:

```text
5432 = TerraFusion Postgres
5433 = existing local postgres PID 10200
15432 = WilliamOS Postgres proof
```

## Base

```text
origin/main = 33ee3146856cf69bd7f8e95280ac57dfbf37495a
```

## Local Runtime Changes

Operator-local files outside the repository were updated under:

```text
C:\Users\bsval\williamos-local-runtime
```

Changes made:

- Updated the WilliamOS Docker Compose Postgres port binding from `127.0.0.1:5433:5432` to `127.0.0.1:15432:5432`.
- Updated the operator-local uncommitted WilliamOS `DATABASE_URL` port reference to `15432`.
- Removed and recreated only the `williamos-postgres-proof` container so Docker could apply the new port binding.
- Started only the WilliamOS proof container.

No secret values were printed, copied into this report, or committed.

## Isolation Evidence

TerraFusion remained on its existing PostgreSQL container:

```text
terrafusion-postgres-dev: Up, 0.0.0.0:5432->5432/tcp
```

The existing local PostgreSQL process on `5433` remained untouched:

```text
LocalPort: 5433
State: Listen
OwningProcess: 10200
```

WilliamOS proof Postgres is separate:

```text
williamos-postgres-proof: Up, healthy, 127.0.0.1:15432->5432/tcp
```

Port proof:

```text
127.0.0.1:15432 Listen
```

## Database Proof

Container health:

```text
williamos-postgres-proof: healthy
```

PostgreSQL readiness:

```text
/var/run/postgresql:5432 - accepting connections
```

SQL proof:

```text
select 1 as proof;
proof = 1
```

Database creation:

```text
williamos_local: present from container initialization
```

## Local WilliamOS Readiness

A temporary local Next development server was started on `127.0.0.1:3100` with the operator-local WilliamOS `DATABASE_URL` override. It was stopped after route verification.

Route proof:

```text
/                    200
/goal-console        200
/api/health          200
/api/auth/readiness  200
```

Readiness summary:

```text
databaseReady: true
authReady: true
ready: true
accessGrants.enabled: false
emailOtp.enabled: false
```

## Safety Posture

```text
TERRAFUSION_CONTAINER_CHANGED: false
PID_10200_CHANGED: false
WILLIAMOS_CONTAINER_STARTED: true
DATABASE_CREATED: true, local proof database only
SECRETS_DISCLOSED: false
PUBLIC_EXPOSURE: false
FIREWALL_ROUTER_DNS_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit a stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Next Recommended WO

WO-LOCAL-007 — Local WilliamOS App Service/Process Gate.

Purpose: decide how WilliamOS should run locally after Postgres is available, including process manager, startup/restart behavior, local env handling, and localhost/LAN-only boundaries.
