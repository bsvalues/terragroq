# WO-LOCAL-037 — Manual Operations Command Set

## Result

PASS / COMMAND SET CREATED.

This work order adds the canonical manual command set for OMEN local WilliamOS operation.

Runbook:

```text
docs/runbooks/local-williamos-omen-manual-commands.md
```

## Base

```text
origin/main = feb69f78df36bff31b1a2cfca28d4b0b4244a90e
```

## Command Set Created

The runbook defines:

- pre-start checks
- PostgreSQL proof status check
- port checks
- app image build command
- manual app run command
- health/readiness checks
- shell route check
- manual stop command
- container remove command
- port cleanup verification
- common failure handling

## Safety

```text
COMMAND_SET_CREATED: true
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
PERSISTENCE_IMPLEMENTED: false
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
WO-LOCAL-038 — Manual Start Proof
```
