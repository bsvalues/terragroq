# WO-LOCAL-081 — Runtime Surface Live Status Integration

## Result

PASS / RUNTIME SURFACE UPDATED.

This work order wires the first-slice local runtime status into `/runtime` as read-only display.

## Base

```text
origin/main = a758061de8e3b662da793899b5906eaecea5d421
```

## UI Integration

Added:

- `components/local/local-runtime-live-status-panel.tsx`

Updated:

- `app/(shell)/runtime/page.tsx`

The panel displays:

- app state from `GET /api/local/runtime/status`
- manual-only mode
- localhost-only scope
- execution disabled posture
- status endpoint contract
- documented-only Postgres proof expectation
- route check health where available
- warnings when status is not ready

The refresh control only re-fetches the GET status endpoint. It does not execute commands or mutate the host.

## Safety

```text
RUNTIME_SURFACE_UPDATED: true
LIVE_STATUS_DISPLAYED: true
COMMAND_BUTTONS_ADDED: false
COMMAND_EXECUTION_ADDED: false
POLLING_WORKER_ADDED: false
START_STOP_CONTROLS_ADDED: false
DOCKER_INTEGRATION_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
focused local runtime status tests: pass
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-082 — Manual Start/Stop Live Status Proof
```
