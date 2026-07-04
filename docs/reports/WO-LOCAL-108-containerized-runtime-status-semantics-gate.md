# WO-LOCAL-108 — Containerized Runtime Status Semantics Gate

## Result

PASS.

The local runtime status API semantics were reviewed and refined after the
refreshed OMEN proof image served `/api/local/runtime/status` from inside the
app proof container.

## Current Contract

```text
ROUTE: GET /api/local/runtime/status
METHODS_ALLOWED: GET
ACTION_PARAMETERS_ACCEPTED: false
SOURCE_MODEL: static posture + localhost HTTP GET checks
MODE: manual-only
SCOPE: localhost-only
EXECUTION_ENABLED: false
PERSISTENCE_ENABLED: false
LAN_EXPOSURE_ENABLED: false
```

## State Model

```text
statusRoute.ready: this status handler is serving the current request
appHttp.*: approved host-loopback HTTP checks, reported separately from route serving
ready: all approved localhost HTTP checks passed
stopped: no approved localhost HTTP checks responded from the checked process namespace
degraded: at least one approved localhost HTTP check responded, but not every check passed
stale: displayed status is older than the current request cycle or could not be refreshed
unknown: status route could not classify the app from approved localhost HTTP checks
```

## Containerized Proof Semantics

When the status route runs inside `williamos-omen-app-proof`,
`127.0.0.1:3100` and `127.0.0.1:3101` are evaluated from the container process
namespace. Therefore a `200` response from `/api/local/runtime/status` proves
the refreshed image serves the route, while the app check can still report
`stopped` or `degraded` if the host-bound ports are outside that namespace.

This is explicitly represented as status semantics, not as Docker metadata,
port scanning, or container control.

## Source Refinement

```text
checks.statusRoute.state: ready
checks.statusRoute.source: this request
checks.appHttp.context: host-loopback
checks.app: retained as a legacy alias for checks.appHttp
```

The source contract now separates "this status route is live" from the
host-loopback app HTTP checks. If every `127.0.0.1:3100/3101` app check is
unavailable from the serving process namespace, `checks.statusRoute` remains
`ready` while `checks.appHttp` reports the host-loopback result.

## Postgres Proof Language

```text
STATE: documented
EXPECTED_PORT: 127.0.0.1:15432
LANGUAGE: documented/static posture only
DOCKER_METADATA_ADDED: false
PORT_CHECKS_ADDED: false
BACKUP_SCAN_ADDED: false
```

## Safety

```text
COMMAND_EXECUTION_ADDED: false
COMMAND_RUNNER_ADDED: false
DOCKER_METADATA_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
DB_SCHEMA_CHANGED: false
PACKAGE_CHANGED: false
LAN_EXPOSURE_ENABLED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
npm test -- --run tests/local-runtime-status-api.test.ts tests/local-runtime-live-status-surface.test.ts tests/local-operator-surface.test.ts: pass
npm test -- --run: pass, 109 files / 454 tests
git diff --check: pass
NEXT_PRIVATE_BUILD_WORKER=0 npm run build: pass after clearing stale .next
```

## Next Recommended WO

```text
WO-LOCAL-109 — Runtime Status Surface Evidence Linkage
```
