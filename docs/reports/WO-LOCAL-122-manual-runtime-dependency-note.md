# WO-LOCAL-122 — Manual Runtime Dependency Note

## Result

PASS.

The remaining local OMEN runtime dependencies are documented as manual
operator-owned dependencies, not WilliamOS-controlled dependencies.

## Manual Dependencies

```text
HOST: HP OMEN Gaming Laptop 16-ap0xxx
DOCKER_DESKTOP_WSL: manual host dependency
WILLIAMOS_POSTGRES_PROOF: manual proof container dependency
APP_PROOF_IMAGE: manual proof image dependency
APP_PROOF_CONTAINER: manual wrapper-run proof only
POWERSHELL_WRAPPERS: operator-run only
BACKUP_BIND_MOUNT: preserved local runtime path, not scanned by app
```

WilliamOS may display status and evidence, but it does not own Docker Desktop,
WSL, container lifecycle, backup retention, host ports, services, startup
items, or LAN exposure.

## Dependency Interpretation

```text
UNKNOWN: does not imply failure
STOPPED: can be expected after proof cleanup
DEGRADED: partial approved check availability only
STALE: evidence may need manual refresh or wrapper proof
READY: approved read-only checks passed from the checked namespace
```

The Primary Operator remains responsible for manual PowerShell wrapper
execution and any future owner-approved runtime changes.

## Explicit Non-Authority

```text
APP_STARTS_CONTAINERS: false
APP_STOPS_CONTAINERS: false
APP_REPAIRS_RUNTIME: false
APP_READS_DOCKER_METADATA: false
APP_SCANS_BACKUPS: false
APP_CHECKS_HOST_PORTS: false
APP_CREATES_SERVICES: false
APP_SCHEDULES_TASKS: false
APP_EXPOSES_LAN: false
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
```

## Next Recommended WO

```text
WO-LOCAL-123 — Local Runtime Freeze Evidence Rollup
```
