# WO-LOCAL-087 — Postgres Proof Recovery Plan

## Result

PASS / PLAN READY, NO POSTGRES MUTATION PERFORMED.

The WilliamOS Postgres proof container exists and is bound to the approved
WilliamOS-only port. Docker reports the container as unhealthy, but container
logs show PostgreSQL reached "ready to accept connections" after recovery from
an unclean shutdown. A direct `docker exec pg_isready` check timed out, so the
proof cannot be treated as fully healthy in this batch.

## Expected Proof Container

```text
EXPECTED_CONTAINER: williamos-postgres-proof
EXPECTED_PORT: 127.0.0.1:15432 -> 5432
EXPECTED_OWNERSHIP: WilliamOS only
```

## Current Findings

```text
CONTAINER_PRESENT: true
DOCKER_HEALTH: unhealthy
PORT_15432: listening
LOGS_INDICATE_POSTGRES_READY: true
DOCKER_EXEC_READINESS_CHECK: timed out
```

The Docker healthcheck is configured as:

```text
pg_isready -U williamos -d williamos_local
```

Earlier logs include a healthcheck-related failure:

```text
FATAL: role "\" does not exist
```

That suggests a healthcheck or environment quoting problem may be contributing
to the unhealthy Docker status, but this batch does not authorize changing the
container definition, recreating the database container, restoring backups, or
modifying database state.

## Recovery Plan

1. Preserve the existing `williamos-postgres-proof` container and data volume.
2. Do not touch TerraFusion Postgres.
3. Do not restore from backup unless separately authorized.
4. If future owner authority permits Postgres proof repair, first inspect the
   operator-local Compose/env configuration without printing secret values.
5. Prefer a non-destructive healthcheck/config repair over container deletion.
6. Require a fresh backup before any future destructive Postgres action.

## Safety

```text
TERRAFUSION_POSTGRES_TOUCHED: false
DB_SCHEMA_CHANGED: false
BACKUP_RESTORE_ADDED: false
POSTGRES_CONTAINER_RECREATED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-088 — App Proof Recovery Plan
```
