# WO-LOCAL-016 — Compose Local Stack Proof

## Result

PASS / APP-SERVICE COMPOSE PROOF.

The first local Compose proof successfully started the WilliamOS app through Docker Compose, bound it to localhost only, verified shell/health/readiness routes, and removed the app container after proof.

To preserve the existing healthy `williamos-postgres-proof` container on `127.0.0.1:15432`, the proof used the existing database as an external dependency via `host.docker.internal:15432` rather than starting a second Postgres service that would conflict with the active proof database.

## Base

```text
origin/main = c81e6ba07ba5ec06e24e2be90c73e285bcce605b
```

## Local Compose File

Operator-local compose file:

```text
C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml
```

Repo status:

```text
compose.app-proof.yaml is outside the repo
no secret values committed
```

Service started:

```text
williamos-app
container: williamos-app-compose-proof
image: williamos-app-proof:local
binding: 127.0.0.1:3100 -> 3000
```

Database dependency:

```text
existing external WilliamOS proof database
container: williamos-postgres-proof
binding: 127.0.0.1:15432 -> 5432
```

## Route Proof

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

Compose health:

```text
williamos-app-compose-proof: healthy
```

Database status:

```text
williamos-postgres-proof: healthy
127.0.0.1:15432 -> 5432
```

## Cleanup

Cleanup command:

```text
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.app-proof.yaml down
```

Cleanup result:

```text
williamos-app-compose-proof: removed
127.0.0.1:3100: no listener after cleanup
williamos-postgres-proof: still healthy
```

Important note:

```text
Docker Compose reported williamos-postgres-proof as an orphan because the proof compose file lives in the same operator-local runtime folder as the database compose file. --remove-orphans was not used.
```

## Scope Notes

This proof intentionally did not start a second PostgreSQL service because:

- `williamos-postgres-proof` was already healthy.
- `127.0.0.1:15432` was already occupied by the approved WilliamOS proof database.
- starting another database on the same host port would violate the batch stop condition.
- the goal was to prove Compose-managed app execution without threatening the existing database.

## Safety Posture

```text
COMPOSE_STACK_STARTED: true
SERVICES_STARTED:
  - williamos-app-compose-proof
DB_STATUS: existing williamos-postgres-proof remained healthy
PORT_BINDINGS:
  - 127.0.0.1:3100 -> 3000 during proof
  - 127.0.0.1:15432 -> 5432 existing database
STACK_STOPPED: true
CLEANUP_COMPLETE: true
DB_SCHEMA_CHANGED: false
DB_MIGRATION_PERFORMED: false
SECRETS_DISCLOSED: false
PUBLIC_EXPOSURE: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
AUTONOMY_CHANGED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Next Recommended WO

WO-LOCAL-017 — Local Container Operator Runbook.

Purpose: document the build, run, compose proof, verification, cleanup, port fallback, env handling, troubleshooting, and stop conditions for the local container proof lane.
