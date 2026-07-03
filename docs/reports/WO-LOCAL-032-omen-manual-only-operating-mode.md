# WO-LOCAL-032 — OMEN Manual-Only Operating Mode Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the full manual-only operating mode for WilliamOS on the OMEN. It does not create automation, persistence, services, startup items, schedules, firewall rules, LAN exposure, or runtime changes.

## Base

```text
origin/main = 2bdd09d64b42d0ba2a550d96d93af0536f478357
```

## Manual-Only Mode

Recommended Phase 1 posture:

```text
MANUAL_ONLY_MODE: primary operating mode
```

In manual-only mode, the Primary Operator intentionally starts WilliamOS when needed, verifies health/readiness, and shuts the app container down after use. PostgreSQL proof may remain running as the approved local database proof unless the operator chooses to stop it.

## Manual Start Procedure

Preconditions:

- Docker Desktop is running
- `williamos-postgres-proof` is healthy
- operator-local env file exists outside the repo
- ports `3100` and `3101` are clear
- no app proof container is already running

Command class:

```text
docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen .
docker run -d --name williamos-omen-app-proof --env-file C:\Users\bsval\williamos-local-runtime\app-container.env -p 127.0.0.1:3100:3000 williamos-app-proof:omen
```

If `3100` is occupied and `3101` is clear, the pre-authorized fallback is:

```text
127.0.0.1:3101 -> 3000
```

If both `3100` and `3101` are occupied, stop and do not run.

## Manual Health Checks

Required checks:

```text
GET http://127.0.0.1:3100/
GET http://127.0.0.1:3100/goal-console
GET http://127.0.0.1:3100/api/health
GET http://127.0.0.1:3100/api/auth/readiness
```

Expected result:

```text
/: 200
/goal-console: 200
/api/health: 200
/api/auth/readiness: 200
```

If fallback port `3101` is used, replace `3100` with `3101` in all checks.

## Manual Stop Procedure

Normal shutdown:

```text
docker stop williamos-omen-app-proof
docker rm williamos-omen-app-proof
```

Post-shutdown verification:

```text
docker ps -a --filter name=williamos-omen-app-proof
Get-NetTCPConnection -LocalPort 3100,3101 -State Listen
```

Expected result:

```text
app proof container: absent
3100: not listening
3101: not listening
```

## Manual Cleanup

Allowed cleanup:

- stop/remove the app proof container
- verify ports are clear
- prune only explicitly identified proof containers if needed

Blocked cleanup:

- deleting WilliamOS PostgreSQL volume
- deleting backup artifacts
- deleting TerraFusion containers
- pruning all Docker resources indiscriminately
- deleting unrelated images or volumes

## When To Run

Run manually when:

- working on WilliamOS local proof or development
- validating local app container behavior
- checking local readiness against the WilliamOS proof database
- preparing evidence for a work order

## When Not To Run

Do not run manually when:

- secrets are missing or uncertain
- `DATABASE_URL` cannot be supplied from operator-local env
- ports `3100` and `3101` are unavailable
- Docker reports unhealthy runtime
- PostgreSQL proof is unhealthy
- a DB/schema migration would be required
- LAN/public exposure would be required
- the operator cannot monitor and stop the process

## Port Conflict Handling

Rule:

```text
Prefer 127.0.0.1:3100.
Use 127.0.0.1:3101 only if 3100 is occupied.
Never use host 3000.
Never bind 0.0.0.0.
```

If both approved ports are unavailable:

```text
STOP_CONDITION: true
```

## Backup Expectations

Before meaningful local work:

- confirm latest backup exists
- create a new manual backup if data changed meaningfully
- store backups outside the repo
- do not print or commit secrets

Before any future persistence:

```text
fresh backup required
```

## Operator Checklist

Start checklist:

1. confirm Docker Desktop is running
2. confirm `williamos-postgres-proof` is healthy
3. confirm ports `3100/3101` are clear
4. confirm operator-local env file exists
5. build/reuse app image
6. run app container on localhost
7. verify shell, health, and readiness routes

Stop checklist:

1. stop app proof container
2. remove app proof container
3. verify ports `3100/3101` are clear
4. confirm PostgreSQL proof posture intentionally retained or stopped
5. document evidence if part of a work order

## Failure Handling

If build fails:

- do not change packages without approval
- collect error category
- stop the current work order if package/dependency change is required

If container starts but routes fail:

- inspect container logs without printing secrets
- verify env file presence by path only
- verify PostgreSQL proof health
- stop/remove app container

If readiness is degraded:

- do not auto-repair
- do not run migrations
- record structured failure reason

## Automation Created

```text
AUTOMATION_CREATED: false
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
SCHEDULE_CREATED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note:

```text
The generated .next directory was removed before the successful build to avoid the known Windows stale standalone artifact scan issue.
```

## Safety Posture

```text
MANUAL_ONLY_MODE: defined
AUTOMATION_CREATED: false
PERSISTENCE_IMPLEMENTED: false
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
PUBLIC_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
PACKAGE_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-033 — Limited Persistence Safety Gate
```
