# WO-LOCAL-085 — Runtime Recovery Scope Classification

## Result

PARTIAL / RECOVERY CLASSIFIED.

The runtime blocker has changed from the earlier Docker Desktop unavailable
state. Docker Desktop and the Docker CLI now respond, and the WilliamOS
Postgres proof container exists, but Docker reports it as unhealthy. The app
proof container is missing and ports `3100` and `3101` are clear.

## Base

```text
origin/main = 9d4dfba398986db584a021eed9141148c9b49dae
```

## Current Git State

```text
branch: main
HEAD: 9d4dfba398986db584a021eed9141148c9b49dae
origin/main: 9d4dfba398986db584a021eed9141148c9b49dae
untracked: .obsidian/ only
```

## Runtime State

```text
DOCKER_DESKTOP_STATE: running
DOCKER_CLI_STATE: available, server version 29.5.3
APP_PROOF_CONTAINER_STATE: missing
POSTGRES_PROOF_CONTAINER_STATE: present, Up, Docker health unhealthy
POSTGRES_PROOF_BINDING: 127.0.0.1:15432 -> 5432
PORT_3100: clear
PORT_3101: clear
PORT_15432: listening on 127.0.0.1
```

## Recovery Scope

```text
RECOVERY_WITHIN_SCOPE: partial
STOP_CONDITION_TRIGGERED: not at classification
```

Docker is available, so a destructive Docker reset is not justified. The
Postgres proof container should not be deleted or recreated unless a separate
owner decision authorizes that mutation. The app proof container may be started
only through existing manual wrappers under the scoped recovery WO.

## Safety

```text
COMMAND_EXECUTION_FROM_UI: false
COMMAND_RUNNER_ADDED: false
DOCKER_INTEGRATION_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_CHECKS_ADDED_IN_APP: false
TERRAFUSION_POSTGRES_TOUCHED: false
UNRELATED_CONTAINERS_DELETED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-086 — Docker Desktop Recovery Readiness Check
```
