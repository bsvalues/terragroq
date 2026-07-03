# WO-LOCAL-045 — Manual Start Wrapper

## Result

PASS / MANUAL START WRAPPER ADDED AND PROVEN.

This work order adds an operator-triggered manual start helper for the OMEN WilliamOS app proof container.

## Base

```text
origin/main = 9c54c8a2071691cbb63bfa78b9dcc009be98f139
```

## Start Wrapper Added

```text
scripts/local/williamos-omen-start.ps1
```

The helper:

- requires `C:\Users\bsval\williamos-local-runtime\app-container.env`
- does not print env contents or secret values
- requires existing image `williamos-app-proof:omen`
- starts only `williamos-omen-app-proof`
- binds localhost only
- prefers `127.0.0.1:3100 -> 3000`
- allows `127.0.0.1:3101 -> 3000` only if `3100` is occupied
- blocks host port `3000`
- blocks `0.0.0.0`
- stops if both `3100` and `3101` are unavailable

## Proof

```text
MANUAL_START_PROVEN: true
CONTAINER_STARTED: true
PORT_BINDING: 127.0.0.1:3100 -> 3000
```

Route proof:

```text
/: 200
/goal-console: 200
/api/health: 200
/api/auth/readiness: 200
```

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
start wrapper execution: pass
route proof: pass
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-046 — Manual Stop Wrapper
```
