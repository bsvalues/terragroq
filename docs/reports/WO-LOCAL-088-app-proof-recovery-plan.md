# WO-LOCAL-088 — App Proof Recovery Plan

## Result

PASS / PLAN READY.

The app proof container is missing, which is the expected safe stopped posture
after prior manual operation. Ports `3100` and `3101` are clear. The local app
image and operator-local app container env file exist.

## Expected App Proof

```text
EXPECTED_CONTAINER: williamos-omen-app-proof
EXPECTED_IMAGE: williamos-app-proof:omen
EXPECTED_INTERNAL_PORT: 3000
EXPECTED_HOST_PORT_PRIMARY: 127.0.0.1:3100
EXPECTED_HOST_PORT_FALLBACK: 127.0.0.1:3101
EXPECTED_START_WRAPPER: scripts/local/williamos-omen-start.ps1
EXPECTED_STOP_WRAPPER: scripts/local/williamos-omen-stop.ps1
```

## Current Prerequisites

```text
APP_IMAGE_PRESENT: true
APP_CONTAINER_ENV_FILE_PRESENT: true
APP_CONTAINER_PRESENT: false
PORT_3100: clear
PORT_3101: clear
```

## Recovery Plan

1. Start only through `scripts/local/williamos-omen-start.ps1`.
2. Bind only to `127.0.0.1:3100` or the pre-approved fallback
   `127.0.0.1:3101`.
3. Do not use host port `3000`.
4. Do not bind `0.0.0.0`.
5. Verify shell and API routes by HTTP GET only.
6. Stop only through `scripts/local/williamos-omen-stop.ps1`.
7. Confirm the app proof container is removed and ports `3100`/`3101` are clear.

## Safety

```text
LAN_EXPOSURE_ENABLED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
COMMAND_EXECUTION_FROM_UI: false
TERRAFUSION_POSTGRES_TOUCHED: false
SECRETS_DISCLOSED: false
```

## Next Recommended WO

```text
WO-LOCAL-089 — Authorized Manual Runtime Recovery
```
