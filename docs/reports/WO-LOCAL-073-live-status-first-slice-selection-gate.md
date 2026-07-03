# WO-LOCAL-073 — Live Status First Slice Selection Gate

## Result

PASS / FIRST SLICE SELECTED.

This work order selects the safest first implementation slice for future OMEN live status. No implementation is added.

## Base

```text
origin/main = 019dbf7663f723f08693e9b09e7913aaa633694a
```

## Options Compared

| Option | Scope | Risk | Decision |
| --- | --- | --- | --- |
| A | Static posture only | Lowest risk, but does not prove live status behavior | Safe but too limited for the first live-status proof |
| B | Static posture + localhost HTTP checks | Low risk, no shell-out, verifies app readiness when manually running | Selected |
| C | Static posture + HTTP checks + port checks | Adds host-level inference and runtime edge cases | Defer |
| D | Docker metadata + backup metadata included | Higher-risk host introspection and secret/overreach risk | Defer |

## Selected First Slice

```text
FIRST_SLICE_SELECTED: Option B
SCOPE: static posture + localhost HTTP GET checks only
```

The first implementation should only combine known static posture with GET-only checks against approved localhost WilliamOS routes.

## Deferred Capabilities

```text
DEFERRED:
- port checks
- Docker metadata reads
- backup metadata reads
- service persistence
- LAN status
- start/stop/restart actions
- shell command execution
- command runner
```

## Why This Minimizes Risk

- HTTP GET checks are already part of the manual validation model.
- The app can report whether manually started WilliamOS responds without gaining host control.
- No Docker socket, shell, process, service, scheduler, firewall, backup, or filesystem access is required.
- Failure can safely degrade to `unknown` or `stopped`.

## UI May Display

- manual-only posture
- host identity
- approved route status
- checked timestamp
- stale/unknown/degraded states
- links back to manual instructions

## UI Must Not Imply

- WilliamOS can start, stop, restart, repair, or expose local services
- port state is authoritatively known
- Docker container health is known
- backup freshness is known
- persistence or LAN access is authorized

## Safety

```text
FIRST_SLICE_SELECTED: static posture + localhost HTTP GET checks
IMPLEMENTATION_ADDED: false
COMMAND_EXECUTION_ADDED: false
MUTATION_ADDED: false
DOCKER_INTEGRATION_ADDED: false
BACKUP_SCAN_IMPLEMENTED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-074 — GET-Only Status API Contract Gate
```
