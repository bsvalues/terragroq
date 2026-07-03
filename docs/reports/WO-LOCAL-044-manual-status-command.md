# WO-LOCAL-044 — Manual Status Command

## Result

PASS / STATUS COMMAND ADDED.

This work order adds a read-only manual status helper for OMEN local WilliamOS operation.

## Base

```text
origin/main = 39e87a9f236f75594424a725417ae110d87e979a
```

## Status Command Added

```text
scripts/local/williamos-omen-status.ps1
```

The command reports:

- WilliamOS PostgreSQL proof container status
- WilliamOS app proof container status
- ports `3100`, `3101`, and `15432`
- operator-local env file presence without printing contents
- backup directory presence
- latest backup filename and timestamp if present
- expected localhost URLs
- manual-only safety posture

## Proof

```text
CONTAINERS_STARTED: false
CONTAINERS_STOPPED: false
SECRETS_DISCLOSED: false
```

The helper is status-only. It does not start, stop, remove, restart, expose, migrate, schedule, or persist anything.

## Safety

```text
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
PERSISTENCE_IMPLEMENTED: false
LAN_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
TERRAFUSION_TOUCHED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
AUTONOMY_CHANGED: false
```

## Validation

```text
status command execution: pass
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-045 — Manual Start Wrapper
```
