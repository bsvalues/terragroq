# WO-LOCAL-070 — UI Live Status UX Design

## Result

PASS / LIVE STATUS UX DESIGNED.

This work order designs the future `/runtime` live status UX for OMEN manual operation. No live UI behavior is implemented in this work order.

## Base

```text
origin/main = feeb6d8f19ccb1599d43e6fb961ea49fd95f8c14
```

## UX Recommendation

Future `/runtime` live status should appear as a read-only extension of the existing Local Operations panel, not as a control panel.

Recommended sections:

- Manual-only banner
- Local runtime status cards
- Safe warning states
- Backup metadata posture
- Local route checks
- Stale/unknown state explanation
- Links to manual wrapper guidance

## Status Cards

Recommended cards:

| Card | Allowed Display | Blocked Implication |
| --- | --- | --- |
| Postgres proof | `ready`, `not running`, `unknown`, `stale` | do not offer start/restart |
| App proof | `running`, `not running`, `unknown`, `stale` | do not offer start/stop |
| Ports | `3100 clear/in-use`, `3101 clear/in-use`, `15432 in-use` | do not bind or free ports |
| Routes | status code and checked timestamp | do not repair failed routes |
| Backup | safe metadata and reminder | do not run backup |

## Unknown and Stale States

Every live status field should support:

```text
unknown: source unavailable, unsafe, unauthorized, or not implemented
stale: source is older than the approved freshness window
blocked: source would require mutation or secret access
```

Unknown state should guide the operator back to manual PowerShell wrappers.

## Manual-Only Banner

Future UI copy:

```text
Live status is read-only. WilliamOS can display local posture, but start, stop, backup, recovery, and cleanup remain operator-run from PowerShell.
```

## What Not To Display

- secrets or env values
- database URLs
- backup file contents
- container logs by default
- full Docker inspect payloads
- TerraFusion container/database internals
- action buttons or command forms

## What Not To Imply

- that WilliamOS can repair local services
- that WilliamOS can start or stop containers
- that backup freshness is guaranteed
- that LAN/public access is safe
- that persistence is authorized
- that Hermes/MCP/autonomy is active

## Safety

```text
LIVE_STATUS_UX_DESIGNED: true
LIVE_BEHAVIOR_ADDED: false
COMMAND_EXECUTION_ADDED: false
ACTION_BUTTONS_ADDED: false
POLLING_WORKER_ADDED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-071 — Backup Metadata Read Safety Gate
```
