# WO-LOCAL-034 — Startup/Shutdown Runbook Gate

## Result

PASS / RUNBOOK ONLY.

This work order adds the OMEN startup/shutdown runbook for manual WilliamOS local operation.

Runbook:

```text
docs/runbooks/local-williamos-omen-startup-shutdown.md
```

## Base

```text
origin/main = 34f9dadbe4efc396ac4e679585ca1e8f2b9d8a40
```

## Startup Checklist

The runbook includes:

- host confirmation
- Docker Desktop check
- PostgreSQL proof health check
- operator-local env file check
- port checks
- app image build command
- app container start command
- fallback port rule

## Shutdown Checklist

The runbook includes:

- normal shutdown
- forced shutdown
- app container cleanup
- port cleanup verification
- PostgreSQL proof retention guidance

## Healthchecks

The runbook defines checks for:

```text
/
/goal-console
/api/health
/api/auth/readiness
```

## Known Failure Modes

The runbook covers:

- port already in use
- PostgreSQL proof unhealthy
- missing env file
- build failure
- readiness degraded

## Safety

```text
RUNBOOK_CREATED: true
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
STARTUP_ITEM_CREATED: false
LAN_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
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

## Next Recommended WO

```text
WO-LOCAL-035 — Backup Before Persistence Gate
```
