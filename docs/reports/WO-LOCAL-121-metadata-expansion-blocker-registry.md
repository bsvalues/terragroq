# WO-LOCAL-121 — Metadata Expansion Blocker Registry

## Result

PASS.

The local runtime metadata and control expansion blockers are registered as
closed authority lanes.

## Blocker Registry

```text
DOCKER_METADATA:
  STATUS: blocked
  REASON: Docker socket/API reads can drift toward inspect/list/exec/control.
  REOPEN_REQUIRES: separate owner-approved Docker metadata gate

BACKUP_METADATA:
  STATUS: blocked
  REASON: backup metadata can expose filesystem assumptions and drift toward scanning.
  REOPEN_REQUIRES: separate owner-approved backup metadata gate

PORT_STATUS:
  STATUS: blocked
  REASON: host port checks can drift toward host probing.
  REOPEN_REQUIRES: separate owner-approved port status gate

RUNTIME_CONTROL:
  STATUS: blocked
  REASON: start/stop/restart/repair actions exceed read-only status display.
  REOPEN_REQUIRES: separate owner-approved runtime control gate

PERSISTENCE_SERVICE_SCHEDULE:
  STATUS: blocked
  REASON: services, startup items, schedules, and persistence change host posture.
  REOPEN_REQUIRES: separate owner-approved persistence gate

LAN_PUBLIC_EXPOSURE:
  STATUS: blocked
  REASON: firewall, router, DNS, and LAN exposure exceed localhost-only proof.
  REOPEN_REQUIRES: separate owner-approved exposure gate

AUTONOMY_HERMES_MCP:
  STATUS: blocked
  REASON: autonomous workers or MCP activation would create execution authority.
  REOPEN_REQUIRES: separate owner-approved autonomy gate
```

## Registry Rule

```text
BLOCKED_MEANS: no design, implementation, proof, validation, or UI affordance
ALLOWED_MEANS: static explanatory copy and evidence references only
OWNER_DECISION_REQUIRED: true
```

## Safety

```text
COMMAND_EXECUTION_ADDED: false
DOCKER_METADATA_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED: false
PERSISTENCE_IMPLEMENTED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
AUTONOMY_ACTIVATED: false
```

## Next Recommended WO

```text
WO-LOCAL-122 — Manual Runtime Dependency Note
```
