# WO-LOCAL-115 — Status State Explainer Cards

## Result

PASS.

Read-only state explainer cards were added to the local runtime status surface.

## States Explained

```text
ready
degraded
stopped
unknown
stale
```

Each state includes:

```text
title
meaning
operator guidance
```

## UX Boundary

The cards guide interpretation only. They do not provide start, stop, restart,
repair, Docker, backup, port, persistence, or LAN controls.

## Safety

```text
STATE_EXPLAINERS_ADDED: true
COMMAND_EXECUTION_ADDED: false
COMMAND_RUNNER_ADDED: false
DOCKER_METADATA_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
```

## Validation

```text
npm test -- --run tests/local-runtime-live-status-surface.test.ts tests/local-runtime-status-api.test.ts tests/local-operator-surface.test.ts: pass
```

## Next Recommended WO

```text
WO-LOCAL-116 — Evidence Reference UX Polish
```
