# WO-LOCAL-082 — Manual Start/Stop Live Status Proof

## Result

PARTIAL / MANUAL START-STOP WRAPPERS PASS, LIVE STATUS ROUTE PROOF LIMITED BY STALE IMAGE.

The local container runtime recovered enough to run the scoped OMEN manual
wrappers. The start wrapper launched `williamos-omen-app-proof` on
`127.0.0.1:3100`; the stop wrapper removed only that app proof container and
reported ports `3100` and `3101` clear with `POSTGRES_PROOF_TOUCHED: false`.

The running image served `/`, `/runtime`, `/goal-console`, `/api/health`, and
`/api/auth/readiness`, but returned `404` for `/api/local/runtime/status`.
Source and build output contain the route, so this is treated as a stale local
proof image limitation. Rebuilding the Docker image was not performed because
image build/update was outside this first-slice authorization.

## Base

```text
origin/main = 8530c6b2dc9bf205204235ffe351eb3598eb25cd
```

## Pre-Start Proof

```text
scripts/local/williamos-omen-status.ps1: pass
POSTGRES_PROOF: williamos-postgres-proof healthy, 127.0.0.1:15432->5432/tcp
APP_CONTAINER: missing
PORT_3100: clear
PORT_3101: clear
PORT_15432: listening on 127.0.0.1:15432
LATEST_BACKUP: williamos-omen-manual-backup-20260703-060207.dump
```

## Manual Start/Stop Proof

```text
START_STATUS_RESULT: pass, container started on 127.0.0.1:3100
RUNNING_STATUS_RESULT:
  /: 200
  /runtime: 200
  /goal-console: 200
  /api/health: 200
  /api/auth/readiness: 200
  /api/local/runtime/status: 404 from local proof image
STOP_STATUS_RESULT: pass
APP_CONTAINER_REMOVED: true
PORTS_CLEAR: true for 3100 and 3101 after stop
POSTGRES_TOUCHED: false
COMMAND_EXECUTION_FROM_UI: false
```

## Validation Completed Before Block

```text
focused local runtime status tests: pass
npm test -- --run: pass
git diff --check: pass
npm run build with NEXT_PRIVATE_BUILD_WORKER=0 after clearing .next: pass
```

## Safety

```text
COMMAND_EXECUTION_FROM_UI: false
COMMAND_RUNNER_ADDED: false
DOCKER_INTEGRATION_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
PERSISTENCE_IMPLEMENTED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-083 — First Slice Safety Regression Sweep.
```
