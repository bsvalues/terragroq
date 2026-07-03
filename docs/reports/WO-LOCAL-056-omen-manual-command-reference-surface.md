# WO-LOCAL-056 — OMEN Manual Command Reference Surface

## Result

PASS / COMMAND REFERENCE ADDED.

This work order adds a read-only command reference for the validated OMEN manual wrappers to the Local Operations surface.

## Base

```text
origin/main = bfe4ec91756fe56b74978fe76d152df937220a81
```

## Command Reference Added

The surface now displays:

```text
Status: scripts/local/williamos-omen-status.ps1
Backup check: scripts/local/williamos-omen-backup-check.ps1
Start: scripts/local/williamos-omen-start.ps1
Stop: scripts/local/williamos-omen-stop.ps1
Help: -Help supported by all wrappers
```

The panel explicitly states that commands are operator-run in PowerShell and WilliamOS does not execute them from the UI.

## Safety

```text
COMMAND_REFERENCE_ADDED: true
COMMANDS_EXECUTED_BY_UI: false
SHELL_ENDPOINT_ADDED: false
COMMAND_BUTTONS_ADDED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
SECRETS_DISCLOSED: false
TERRAFUSION_TOUCHED: false
```

## Validation

```text
focused local operator surface test: pass, 4 tests
git diff --check: pass
npm test -- --run: pass, 107 files / 441 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-057 — Local Backup Status Surface
```
