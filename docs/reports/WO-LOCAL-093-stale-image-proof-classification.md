# WO-LOCAL-093 — Stale Image Proof Classification

## Result

PASS / STALE IMAGE CLASSIFIED.

`/api/local/runtime/status` returned `404` from the previously running local
proof image while source and local build output contain the route. The local
proof image predates the status-route implementation, so the 404 is consistent
with a stale image rather than missing source.

## Base

```text
origin/main = 5c5a3dd7bf56d50afadcd3ebe7178babb16a2907
```

## Evidence

```text
SOURCE_ROUTE_PRESENT: true
SOURCE_ROUTE: app/api/local/runtime/status/route.ts
BUILD_ROUTE_PRESENT: true
BUILD_ROUTE: .next/server/app/api/local/runtime/status/route.js
LOCAL_IMAGE: williamos-app-proof:omen
LOCAL_IMAGE_ID_BEFORE_REFRESH: sha256:175d167f81ac2947a8de56bfa368918337cd55cb8495a5598bcd02280163377c
LOCAL_IMAGE_CREATED_BEFORE_REFRESH: 2026-07-03T17:32:17.52372634Z
APP_PROOF_CONTAINER_STATE: missing
POSTGRES_PROOF_STATE: present but unhealthy before Docker API degraded
```

## Classification

```text
LOCAL_IMAGE_STALE: true
REBUILD_REQUIRED_FOR_PROOF: true
REBUILD_WITHIN_SCOPE: true, if limited to the existing WilliamOS proof image workflow
STOP_CONDITION_TRIGGERED: false at classification
```

## Safety

```text
COMMAND_EXECUTION_FROM_UI: false
COMMAND_RUNNER_ADDED: false
DOCKER_INTEGRATION_ADDED_IN_APP_CODE: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED_IN_APP_CODE: false
TERRAFUSION_POSTGRES_TOUCHED: false
UNRELATED_CONTAINERS_DELETED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-094 — Local Proof Image Refresh Plan
```

