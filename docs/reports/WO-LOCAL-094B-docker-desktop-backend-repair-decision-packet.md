# WO-LOCAL-094B — Docker Desktop Backend Repair Decision Packet

## Result

PASS / DECISION PACKET CREATED.

This packet records that the OMEN local runtime blocker is now a Docker
Desktop / WSL backend responsiveness problem, not a WilliamOS application
implementation problem. It does not authorize or perform destructive Docker
repair, container recreation, volume mutation, database migration, backup
restore, TerraFusion changes, app wrapper execution, or image rebuilds.

## Base

```text
origin/main = 827e478d4aa6f0cfb60c5d67aca5c4f91353cbdd
```

## Current Diagnosis

```text
HOST: HP OMEN Gaming Laptop 16-ap0xxx
PREVIOUS_WO: WO-LOCAL-094 — Docker Desktop / WSL Backend Non-Destructive Restart Gate
PREVIOUS_RESULT: STOPPED
STOP_REASON: Docker exec/run/list responsiveness was not restored by non-destructive WSL/Docker Desktop restart.
```

### Pre-Restart Facts

```text
DOCKER_CONTEXT: desktop-linux
DOCKER_SERVER: 29.5.3 before restart
POSTGRES_PROOF: williamos-postgres-proof running / unhealthy
POSTGRES_BINDING: 127.0.0.1:15432 -> 5432
POSTGRES_TCP_15432: accepted TCP connections
DOCKER_EXEC: docker exec williamos-postgres-proof true timed out
WSL_ENUMERATION: timed out
APP_PROOF_CONTAINER: missing
PORT_3100: clear
PORT_3101: clear
TERRAFUSION_POSTGRES: not touched
```

### Repair Attempted In WO-LOCAL-094

```text
WSL_SHUTDOWN: attempted, timed out
DOCKER_DESKTOP_BACKEND_PROCESS_RESTART: performed
DOCKER_DESKTOP_RESTART: requested
DOCKER_PRUNE: not performed
DOCKER_RESET: not performed
CONTAINER_DELETION: not performed
VOLUME_MUTATION: not performed
POSTGRES_RECREATE: not performed
BACKUP_RESTORE: not performed
DB_SCHEMA_CHANGE: not performed
APP_WRAPPER_RUN: not performed after restart
```

### Post-Restart Facts

```text
WSL_ENUMERATION: recovered
DOCKER_DESKTOP_DISTRO: docker-desktop running
UBUNTU_DISTRO: stopped
DEBIAN_DISTRO: stopped
DOCKER_CONTEXT: desktop-linux
DOCKER_VERSION: timed out
DOCKER_PS: timed out
DOCKER_EXEC: timed out
WILLIAMOS_OMEN_STATUS: timed out because Docker listing path remained unhealthy
PORT_15432: no longer reported listening after restart window
```

## Root Cause Classification

```text
ROOT_CAUSE_CLASSIFICATION:
Docker Desktop / WSL backend remains partially broken. Docker Desktop can
restart and WSL enumeration can recover, but Docker engine list/run/exec paths
still time out.
```

The failure is deeper than a stale WilliamOS image and deeper than the
WilliamOS app wrapper. The app proof must not proceed until Docker engine
list/run/exec responsiveness is restored.

## Repair Options

### Option A — Stop And Defer Docker Repair

```text
ACTION: do nothing further on local Docker proof now
RISK: lowest
IMPACT: WilliamOS source and status API remain valid; local proof remains limited by Docker backend health
RECOMMENDED_IF: owner wants to avoid runtime repair now
```

### Option B — Manual Docker Desktop UI Health Check

```text
ACTION: owner/operator opens Docker Desktop UI and checks engine status, warnings, update state, diagnostics, resource settings, and WSL integration
RISK: low if no reset/prune/delete/settings mutation is performed
IMPACT: may identify a stuck engine/update/resource/WSL issue without destructive action
NEXT_GATE: WO-LOCAL-094C — Docker Desktop UI Health Check Gate
```

### Option C — Non-Destructive Docker Desktop Update / Repair Install

```text
ACTION: owner approves Docker Desktop update or repair install if UI indicates it is needed
RISK: medium-low
IMPACT: can alter Docker Desktop version/runtime behavior; requires before/after evidence
NEXT_GATE: WO-LOCAL-094D — Docker Desktop Update / Repair Install Gate
```

### Option D — Docker Desktop Factory Reset

```text
ACTION: reset Docker Desktop data
RISK: high
IMPACT: can destroy containers, images, volumes, and local proof state
STATUS: blocked unless separately authorized in a destructive repair packet
RECOMMENDATION: not recommended now
```

### Option E — Remove/Recreate WilliamOS Proof Containers Only

```text
ACTION: delete/recreate only WilliamOS proof containers
RISK: medium
IMPACT: may not help because Docker list/run/exec paths are timing out
STATUS: blocked until Docker engine responsiveness is restored
```

### Option F — Move Proof To Phase 2 Ubuntu Server

```text
ACTION: defer OMEN Docker repair and move proof target to dedicated Ubuntu Server later
RISK: medium planning cost
IMPACT: avoids Docker Desktop/Windows/WSL fragility long-term
STATUS: valid future strategy, not a replacement for documenting this blocker
```

## Recommended Option

```text
RECOMMENDED_OPTION: Option B — Manual Docker Desktop UI Health Check
```

The next step should use Docker Desktop's own UI and diagnostics to determine
whether the engine is stuck, updating, resource-starved, WSL integration-broken,
or requiring update/repair. It must not reset, prune, delete, recreate, restore,
migrate, rebuild, or run the app wrapper.

## Next Work Order Definition

```text
WO-LOCAL-094C — Docker Desktop UI Health Check Gate
```

### Mode

```text
manual diagnosis / no repo mutation / no destructive repair
```

### Goal

Use the Docker Desktop UI and safe status checks to determine why Docker engine
list/run/exec operations time out.

### Allowed

- open Docker Desktop UI
- inspect engine status
- inspect Docker Desktop warnings/errors
- check whether Docker Desktop is updating
- check resource settings
- check WSL integration settings
- check diagnostics status
- run Docker Desktop built-in diagnostics only if it does not reset/delete data
- run `docker version` / `docker ps` after UI reports engine running
- run `wsl -l -v`
- document findings

### Blocked

- no factory reset
- no clean/purge data
- no prune
- no container deletion
- no image deletion
- no volume deletion
- no backup restore
- no DB/schema migration
- no TerraFusion touch
- no app wrapper
- no image rebuild
- no Docker settings change unless separately authorized
- no WSL distro unregister
- no OS/hardware mutation

### Stop Conditions

Stop if Docker UI recommends or requires:

- factory reset
- clean/purge data
- WSL distro unregister
- deleting containers/images/volumes
- admin repair install
- Docker Desktop update
- Windows reboot
- virtualization/Hyper-V/WSL feature changes
- any destructive data operation

## Safety

```text
DESTRUCTIVE_REPAIR_AUTHORIZED: false
DOCKER_PRUNE_AUTHORIZED: false
DOCKER_RESET_AUTHORIZED: false
CONTAINER_RECREATION_AUTHORIZED: false
VOLUME_MUTATION_AUTHORIZED: false
POSTGRES_CONTAINER_DELETED: false
TERRAFUSION_POSTGRES_TOUCHED: false
APP_WRAPPER_RUN: false
IMAGE_REBUILT: false
SECRETS_DISCLOSED: false
COMMAND_RUNNER_ADDED: false
UI_API_EXECUTION_ADDED: false
DOCKER_INTEGRATION_ADDED_TO_APP: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
```
