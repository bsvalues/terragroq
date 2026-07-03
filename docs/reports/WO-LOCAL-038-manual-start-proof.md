# WO-LOCAL-038 — Manual Start Proof

## Result

PASS / MANUAL START PROVEN.

WilliamOS was manually started on the HP OMEN using the documented local container command set.

## Base

```text
origin/main = 04a0262ddba44bf58ed377e40a12aeadd1c94aec
```

## Proof

```text
IMAGE_BUILT: true
CONTAINER_STARTED: true
CONTAINER_NAME: williamos-omen-app-proof
IMAGE: williamos-app-proof:omen
PORT_BINDING: 127.0.0.1:3100 -> 3000
ENV_SOURCE: C:\Users\bsval\williamos-local-runtime\app-container.env
```

The operator-local env file was used by path only. Secret values were not printed, copied, or committed.

## Route Proof

```text
/: 200
/goal-console: 200
/api/health: 200
/api/auth/readiness: 200
```

## Local Posture

```text
williamos-postgres-proof: healthy on 127.0.0.1:15432 -> 5432
app proof container: running for WO-LOCAL-039 cleanup proof
host port 3100: bound to 127.0.0.1 only
host port 3101: clear
host port 3000: not used
```

The TerraFusion PostgreSQL container was not modified.

## Safety

```text
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
PERSISTENCE_IMPLEMENTED: false
LAN_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
AUTONOMY_CHANGED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-039 — Manual Stop / Cleanup Proof
```
