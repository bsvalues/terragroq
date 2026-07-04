# WO-LOCAL-107 — Resume WilliamOS Proof Image Refresh

## Result

PASS WITH FOLLOW-UP STATUS SEMANTICS NOTE.

The stale `williamos-app-proof:omen` image was rebuilt through the existing
local proof Dockerfile. The refreshed app proof container started through the
existing manual OMEN start wrapper on `127.0.0.1:3100`, served the expected
WilliamOS routes, and returned `200` for `/api/local/runtime/status`. The app
proof container was then stopped and removed through the existing manual stop
wrapper.

No Docker prune, reset, data purge, unrelated container deletion, volume
mutation, database migration, backup restore, TerraFusion mutation, service
registration, schedule, LAN exposure, cloud change, app command runner, or
UI/API execution path was added.

## Base

```text
origin/main = f88d6bd201b31b2a24ae8df6a31fd57106e5604a
```

## Pre-Proof State

```text
POSTGRES_PROOF: williamos-postgres-proof healthy, 127.0.0.1:15432 -> 5432
APP_CONTAINER: missing
PORT_3100: clear
PORT_3101: clear
TERRAFUSION_REFERENCE_ONLY: do-not-touch
IMAGE_BEFORE: williamos-app-proof:omen sha256:175d167f81ac2947a8de56bfa368918337cd55cb8495a5598bcd02280163377c
```

## Image Refresh

```text
COMMAND: docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
RESULT: pass
IMAGE_AFTER: williamos-app-proof:omen sha256:f64cc076c34422a717814cd0482814ac6952aa5504ea4c4068dfcc4d1cabb93b
IMAGE_CREATED: 2026-07-04T14:40:56.069876044Z
```

The Docker build completed successfully. Build-time Better Auth warnings were
expected because build-time production auth secrets are not provided to the
image build. No secret values were printed.

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
/: 200
/runtime: 200
/goal-console: 200
/api/health: 200
/api/auth/readiness: 200
/api/local/runtime/status: 200
```

This proves the stale-image blocker is cleared. The refreshed container includes
and serves the first-slice local runtime status route.

## Status Semantics Note

The `/api/local/runtime/status` response returned `200`, but its internal app
check reported the app as stopped/unknown because the status API checks
`127.0.0.1:3100` and `127.0.0.1:3101` from inside the app container network
namespace. Inside the container, those host-bound ports are not the same as the
container's own `3000` listener.

This is not an image refresh failure. It is a follow-up design issue for how
the live-status first slice should behave when WilliamOS itself runs inside a
container. The UI/API still did not execute or mutate anything.

## Cleanup

```text
COMMAND: scripts/local/williamos-omen-stop.ps1
APP_CONTAINER_REMOVED: true
PORT_3100: clear
PORT_3101: clear
POSTGRES_PROOF_TOUCHED: false
TERRAFUSION_TOUCHED: false
```

## Final Local Posture

```text
POSTGRES_PROOF: williamos-postgres-proof healthy, 127.0.0.1:15432 -> 5432
APP_CONTAINER: missing
PORT_3100: clear
PORT_3101: clear
PORT_15432: listening
LATEST_BACKUP: williamos-omen-manual-backup-20260703-060207.dump
```

## Safety

```text
IMAGE_REBUILT: true, scoped to williamos-app-proof:omen
APP_WRAPPER_RUN: true, scoped to existing manual start/stop wrappers
APP_CONTAINER_STARTED: true
APP_CONTAINER_REMOVED: true
DOCKER_RESET_OR_PURGE_PERFORMED: false
DOCKER_PRUNE_PERFORMED: false
CONTAINERS_DELETED: false, except scoped app proof cleanup
IMAGES_DELETED: false
VOLUMES_MUTATED: false
POSTGRES_CONTAINER_RECREATED: false
TERRAFUSION_POSTGRES_TOUCHED: false
DB_SCHEMA_CHANGED: false
BACKUP_RESTORE_ADDED: false
SECRETS_DISCLOSED: false
COMMAND_RUNNER_ADDED: false
DOCKER_INTEGRATION_ADDED_TO_APP: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
```

## Next Recommended WO

```text
WO-LOCAL-108 — Containerized Runtime Status Semantics Gate
```

Purpose: decide how `/api/local/runtime/status` should represent app readiness
when WilliamOS is running inside the proof container. The gate should remain
read-only and must not add command execution, Docker integration, port scanning,
service persistence, LAN exposure, or host mutation.
