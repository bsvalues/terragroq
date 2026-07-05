# WO-LOCAL-118 — Runtime Home Card Consistency

## Result

PASS.

The Home Local Status card and system posture copy now match the refined
`/runtime` semantics.

## Home Card

```text
HOME_CARD_REFINED: true
RUNTIME_LINK_PRESENT: true
ROUTE_STATUS_SUMMARIZED: true
HOST_LOOPBACK_SEPARATED: true
POWERSHELL_WRAPPERS_OPERATOR_RUN_ONLY: true
COMMAND_EXECUTION_IMPLIED: false
```

Home summarizes:

```text
OMEN local runtime: manual-only
Runtime status: read-only
Host-loopback checks: separate from route status
PowerShell wrappers: operator-run only
Blocked: UI execution, metadata expansion, persistence, LAN exposure, autonomy
```

The card links to `/runtime` for the full status semantics, state guide, static
evidence references, and no-control boundary.

## Safety

```text
COMMAND_EXECUTION_ADDED: false
COMMAND_RUNNER_ADDED: false
DOCKER_METADATA_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
PERSISTENCE_IMPLEMENTED: false
LAN_EXPOSURE_ENABLED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
npm test -- --run tests/local-runtime-live-status-surface.test.ts tests/home-command-center.test.ts tests/shell-woe-resume-surface.test.ts tests/local-runtime-status-api.test.ts tests/local-operator-surface.test.ts: pass, 37 tests
```

## Next Recommended WO

```text
WO-LOCAL-119 — Live Status Refinement Evidence Rollup
```
