# WO-LOCAL-111 — Refreshed Image Route Proof Re-Run

## Result

PASS.

Because source changed, the OMEN proof image was rebuilt and the approved
manual wrapper proof was re-run.

## Pre-Proof State

```text
POSTGRES_PROOF: williamos-postgres-proof healthy, 127.0.0.1:15432 -> 5432
APP_PROOF_CONTAINER: missing
PORT_3100: clear
PORT_3101: clear
```

## Image Rebuild

```text
COMMAND: docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
RESULT: pass
IMAGE_AFTER: sha256:6c9c2938bf91e3a12bd1e867a37e03d2c723be9b61c0ea5a5d371bb5f4cb52aa
IMAGE_CREATED: 2026-07-04T18:10:46.132339944Z
```

Build-time Better Auth warnings were observed and expected in the no-production
secret build path. No secret values were printed.

## App Proof Start

```text
COMMAND: scripts/local/williamos-omen-start.ps1
RESULT: pass
CONTAINER_STARTED: williamos-omen-app-proof
PORT_BINDING: 127.0.0.1:3100 -> 3000
LAN_EXPOSURE_ENABLED: false
```

## Route Proof

```text
GET http://127.0.0.1:3100/: 200
GET http://127.0.0.1:3100/runtime: 200
GET http://127.0.0.1:3100/goal-console: 200
GET http://127.0.0.1:3100/api/health: 200
GET http://127.0.0.1:3100/api/auth/readiness: 200
GET http://127.0.0.1:3100/api/local/runtime/status: 200
```

## Status API Contract

```text
mode: manual-only
host: HP OMEN Gaming Laptop 16-ap0xxx
scope: localhost-only
executionEnabled: false
persistenceEnabled: false
lanExposureEnabled: false
sourceModel: static posture + localhost HTTP GET checks
appState: stopped
```

The `appState: stopped` result is expected for this containerized proof because
the status route's localhost checks run inside the container process namespace.
The route itself served `200`, proving the refreshed image includes and serves
the status API.

## Cleanup

```text
COMMAND: scripts/local/williamos-omen-stop.ps1
APP_CONTAINER_REMOVED: true
PORT_3100: clear
PORT_3101: clear
POSTGRES_PROOF_TOUCHED: false
TERRAFUSION_TOUCHED: false
```

## Preserved Resources

```text
POSTGRES_PROOF_AFTER: williamos-postgres-proof healthy, 127.0.0.1:15432 -> 5432
PGDATA_VOLUME_PRESENT_AFTER: williamos-local-runtime_williamos_pgdata
BACKUPS_BIND_MOUNT_PRESENT_AFTER: C:\Users\bsval\williamos-local-runtime\backups -> /backup
```

## Safety

```text
TERRAFUSION_PACS_TOUCHED: false
UNRELATED_CONTAINERS_TOUCHED: false
COMMAND_EXECUTION_FROM_UI: false
COMMAND_RUNNER_ADDED: false
LAN_EXPOSURE_ENABLED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
Docker image rebuild: pass
manual app proof start: pass
approved route proof: pass
manual app proof cleanup: pass
npm test -- --run: pass, 109 files / 454 tests
git diff --check: pass
NEXT_PRIVATE_BUILD_WORKER=0 npm run build: pass after clearing stale .next
```

## Next Recommended WO

```text
WO-LOCAL-112 — First Live Status Slice Closure Rollup
```
