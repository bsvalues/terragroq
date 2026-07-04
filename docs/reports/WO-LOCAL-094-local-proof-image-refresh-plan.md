# WO-LOCAL-094 — Local Proof Image Refresh Plan

## Result

PASS / IMAGE REFRESH PLAN READY.

The narrow refresh plan is to rebuild only the existing WilliamOS local app
proof image and then use the existing manual start/stop wrappers for proof.

## Base

```text
origin/main = 5c5a3dd7bf56d50afadcd3ebe7178babb16a2907
```

## Existing Workflow

```text
IMAGE_BUILD_COMMAND: docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
EXPECTED_IMAGE: williamos-app-proof:omen
START_WRAPPER: scripts/local/williamos-omen-start.ps1
STOP_WRAPPER: scripts/local/williamos-omen-stop.ps1
STATUS_WRAPPER: scripts/local/williamos-omen-status.ps1
EXPECTED_CONTAINER: williamos-omen-app-proof
EXPECTED_PRIMARY_BINDING: 127.0.0.1:3100 -> 3000
EXPECTED_FALLBACK_BINDING: 127.0.0.1:3101 -> 3000
```

## Expected Proof After Refresh

```text
GET /: 200
GET /runtime: 200
GET /goal-console: 200
GET /api/health: 200
GET /api/auth/readiness: 200
GET /api/local/runtime/status: 200
```

Expected cleanup:

```text
APP_CONTAINER_REMOVED: true
PORT_3100_CLEAR: true
PORT_3101_CLEAR: true
POSTGRES_PROOF_TOUCHED: false
TERRAFUSION_TOUCHED: false
```

## Risks

- Docker Desktop may fail or time out during image build.
- The existing Dockerfile binds `HOSTNAME=0.0.0.0` inside the container, while
  the manual wrapper constrains host exposure to `127.0.0.1`; this plan does
  not alter the Dockerfile or add LAN exposure.
- The WilliamOS Postgres proof container may remain unhealthy. The status API
  does not depend on inspecting or mutating that container.

## Safety

```text
IMAGE_REFRESH_PLAN_READY: true
DB_SCHEMA_CHANGED: false
PACKAGE_CHANGED: false
TERRAFUSION_TOUCHED: false
UNRELATED_CONTAINERS_DELETED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-095 — Authorized WilliamOS Proof Image Refresh
```

