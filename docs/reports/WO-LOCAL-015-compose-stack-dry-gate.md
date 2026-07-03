# WO-LOCAL-015 — Compose Stack Dry Gate

## Result

PASS / DRY GATE ONLY.

This work order defines the local WilliamOS Docker Compose stack topology before creating or starting a multi-service stack.

No compose file was created. No stack was started. No new containers were created. No secrets were disclosed.

## Base

```text
origin/main = 90842c7ee951edc3a9e057dd04e677a9adba99c1
```

## Required Decisions

```text
APP_SERVICE_NAME: williamos-app
DB_SERVICE_NAME: williamos-postgres
NETWORK_NAME: williamos-local-internal
VOLUME_NAME: williamos_pgdata
HOST_PORTS:
  app: 127.0.0.1:3100 -> 3000
  app fallback: 127.0.0.1:3101 -> 3000 only if 3100 is unavailable
  postgres: 127.0.0.1:15432 -> 5432
ENV_FILES:
  C:\Users\bsval\williamos-local-runtime\.env
  C:\Users\bsval\williamos-local-runtime\app-container.env
HEALTHCHECKS:
  postgres: pg_isready -U williamos -d williamos_local
  app: GET /api/health and GET /api/auth/readiness
START_COMMAND: docker compose -f compose.local-proof.yaml up -d
STOP_COMMAND: docker compose -f compose.local-proof.yaml stop
CLEANUP_COMMAND: docker compose -f compose.local-proof.yaml down
```

## Compose Plan

### Services

`williamos-postgres`

```text
image: postgres:16-bookworm
purpose: WilliamOS-owned local PostgreSQL only
host binding: 127.0.0.1:15432 -> 5432
volume: williamos_pgdata
backup mount: C:\Users\bsval\williamos-local-runtime\backups -> /backup
healthcheck: pg_isready
```

`williamos-app`

```text
image: williamos-app-proof:local
purpose: WilliamOS app runtime proof
host binding: 127.0.0.1:3100 -> 3000
fallback binding: 127.0.0.1:3101 -> 3000 only if pre-authorized fallback is needed
env file: C:\Users\bsval\williamos-local-runtime\app-container.env
depends on: williamos-postgres healthy
healthcheck: /api/health
```

### Not Included

The first compose proof must not start:

- reverse proxy
- TLS service
- backup scheduler
- monitoring agent
- Hermes worker
- MCP service
- background worker
- access grant service
- public ingress

## Port Plan

Protected ports:

```text
5432: TerraFusion PostgreSQL; do not touch
5433: existing local postgres PID 10200; do not touch
3000: do not use as host port
```

WilliamOS proof ports:

```text
15432: WilliamOS PostgreSQL host port
3100: preferred WilliamOS app host port
3101: pre-authorized fallback if 3100 unavailable
```

Rules:

- Bind host ports to `127.0.0.1` only.
- Never bind `0.0.0.0`.
- Never use host port `3000`.
- Stop if both `3100` and `3101` are unavailable.
- Document the actual app host port used.

## Volume Plan

Initial proof volume:

```text
williamos_pgdata
```

Backup mount:

```text
C:\Users\bsval\williamos-local-runtime\backups:/backup
```

Log posture:

```text
Use docker compose logs for stdout/stderr.
Keep exported logs under C:\Users\bsval\williamos-local-runtime\logs only when needed.
Do not commit logs.
```

Future bind-mount migration:

```text
Deferred. Requires a volume migration gate and backup/restore verification.
```

## Network Plan

Network:

```text
williamos-local-internal
```

Properties:

- app and database communicate over the compose network
- database service hostname: `williamos-postgres`
- no public ingress
- no LAN exposure
- no router/firewall changes

Container-to-database `DATABASE_URL` shape:

```text
postgres://<redacted>@williamos-postgres:5432/williamos_local
```

Operator-local host database URL remains:

```text
postgres://<redacted>@127.0.0.1:15432/williamos_local
```

## Env File Plan

Operator-local files:

```text
C:\Users\bsval\williamos-local-runtime\.env
C:\Users\bsval\williamos-local-runtime\app-container.env
```

Required app env names:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
BETTER_AUTH_TRUSTED_ORIGINS
PORT
HOSTNAME
```

Compose proof adjustment:

```text
DATABASE_URL must use williamos-postgres:5432 inside the compose network, not host.docker.internal:15432.
```

Secret rules:

- Do not commit env files.
- Do not print env values.
- Do not bake secrets into images.
- Do not pass secrets as Docker build args.
- Do not copy `.env.local` into images.

## Healthcheck Plan

Postgres:

```text
pg_isready -U williamos -d williamos_local
```

App:

```text
GET http://127.0.0.1:<actual-port>/api/health
GET http://127.0.0.1:<actual-port>/api/auth/readiness
GET http://127.0.0.1:<actual-port>/goal-console
```

Expected:

```text
/api/health: 200
/api/auth/readiness: 200
/goal-console: 200
```

## Start Command

Design target only:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.local-proof.yaml up -d
```

This command must not be run until WO-LOCAL-016.

## Stop Command

Design target only:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.local-proof.yaml stop
```

## Cleanup Command

Design target only:

```powershell
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.local-proof.yaml down
```

Volume cleanup is not part of the first compose proof.

Do not run:

```text
docker compose down -v
```

unless a separate recovery/reset gate explicitly approves volume removal.

## Stop Conditions

Stop before implementation if:

- compose requires `0.0.0.0`
- compose requires host port `3000`
- both `3100` and `3101` are unavailable
- compose requires production secrets
- compose attempts DB migration/schema mutation
- compose starts unapproved workers
- app cannot reach DB without changing TerraFusion or PID 10200
- env values would need to be printed, committed, or baked into the image
- Azure/Vercel/DNS/production deployment becomes required

## Rollback / Cleanup

After a future compose proof:

```text
docker compose -f C:\Users\bsval\williamos-local-runtime\compose.local-proof.yaml down
```

Expected post-cleanup:

```text
no williamos-app container running
no app host port listener
WilliamOS Postgres either remains intentionally running or is stopped by compose, depending on proof scope
TerraFusion unaffected
PID 10200 unaffected
```

## Safety Posture

```text
STACK_STARTED: false
CONTAINERS_CREATED: false
SECRETS_DISCLOSED: false
COMPOSE_FILE_CREATED: false
DB_MIGRATION_PERFORMED: false
DB_SCHEMA_CHANGED: false
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

WO-LOCAL-016 — Compose Local Stack Proof.

Purpose: create the local proof compose file outside the repo or in a scoped local-proof location, start the app and database proof services with localhost-only bindings, verify health/readiness, then stop/remove the stack without creating persistent services.
