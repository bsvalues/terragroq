# WO-LOCAL-043 — Manual Wrapper Design Gate

## Result

PASS / WRAPPER DESIGN CREATED.

This work order defines the thin manual wrapper pattern for OMEN local WilliamOS operation. It does not add helper scripts or implement persistence.

## Base

```text
origin/main = 950c462e2065df244bcc84613e02491ec0ff9cbd
```

## Wrapper Design

### Script Location

Manual helper scripts may live under:

```text
scripts/local/
```

This keeps OMEN-local helper commands separated from existing WilliamOS Python governance scripts.

### Naming Convention

```text
williamos-omen-<verb>.ps1
```

Approved initial names:

```text
williamos-omen-status.ps1
williamos-omen-start.ps1
williamos-omen-stop.ps1
williamos-omen-backup-check.ps1
```

### Allowed Commands

Wrappers may:

- inspect Docker container status
- inspect localhost port state
- check for the operator-local env file by path only
- check for the local backup directory and latest safe backup filename
- build the existing local app proof image when explicitly invoked by the start helper
- start the WilliamOS app proof container manually
- stop and remove only the WilliamOS app proof container manually
- verify localhost-only routes

### Blocked Commands

Wrappers must not:

- register Windows services
- create scheduled tasks
- create startup items
- configure Docker daemon startup
- bind to `0.0.0.0`
- use host port `3000`
- expose WilliamOS on LAN or public interfaces
- mutate TerraFusion containers or databases
- run DB/schema migrations
- print secret values
- commit or create repo-local env files
- change Azure, Vercel, DNS, firewall, router, package, dependency, production, Hermes, MCP, autonomy, or background-worker posture

## Status Output Format

Wrapper output should be plain text with stable labels:

```text
WILLIAMOS_OMEN_STATUS
MANUAL_ONLY: true
POSTGRES_PROOF: <status>
APP_CONTAINER: <status>
PORT_3100: <status>
PORT_3101: <status>
BACKUP_DIR: <present|missing>
LATEST_BACKUP: <filename|none>
EXPECTED_URL: http://127.0.0.1:<port>
SAFETY: localhost-only / operator-triggered / no persistence
```

The output must not include secret values.

## Port Behavior

```text
container internal port: 3000
preferred host binding: 127.0.0.1:3100
pre-authorized fallback: 127.0.0.1:3101
blocked: 0.0.0.0
blocked: host port 3000
stop if 3100 and 3101 are both unavailable
```

## Env Handling

Expected operator-local env path:

```text
C:\Users\bsval\williamos-local-runtime\app-container.env
```

Wrappers may check path presence. They must not print file contents or individual secret values.

## Cleanup Behavior

Stop cleanup must affect only:

```text
williamos-omen-app-proof
```

The helper must not stop, remove, restart, or inspect secret-bearing internals for TerraFusion containers or unrelated local Postgres processes.

## Backup Reminder Behavior

Backup checks may inspect:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

They may print the latest backup filename and timestamp. They must not print credentials, database URLs, env values, or secret-bearing backup command arguments.

## Operator Safety Warnings

Wrappers should explicitly state:

```text
manual-only
localhost-only
operator-triggered
no service registration
no scheduled task
no automatic startup
no LAN exposure
```

## Safety

```text
PERSISTENCE_IMPLEMENTED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
LAN_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
TERRAFUSION_TOUCHED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-044 — Manual Status Command
```
