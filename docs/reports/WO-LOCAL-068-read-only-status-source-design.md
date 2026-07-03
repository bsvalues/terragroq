# WO-LOCAL-068 — Read-Only Status Source Design

## Result

PASS / STATUS SOURCES DESIGNED.

This work order designs the safe source model for future OMEN live status without implementing readers, polling, endpoints, or command execution.

## Base

```text
origin/main = 2767861b9265fddbc4ac8284e56c4c366fdd5a4b
```

## Preferred Source Model

Use a layered read-only model:

1. Static posture from repo-owned surface data for always-safe defaults.
2. Localhost HTTP checks for WilliamOS app health/readiness when manually running.
3. Local port checks for approved ports only: `3100`, `3101`, `15432`.
4. Docker metadata reads for named WilliamOS containers only, if later approved.
5. Backup metadata reads for approved backup metadata fields only, if later approved.

Every source must independently degrade to `unknown` when unavailable, stale, or unsafe.

## Safe Sources

```text
SAFE_SOURCES:
- static known posture from repo model/docs
- GET-only localhost health/readiness checks
- localhost port-listening checks for 3100, 3101, 15432
- Docker inspect/status read-only for explicitly named WilliamOS containers only
- backup directory metadata read for approved fields only
- operator-run wrapper output as evidence, not as app-executed source
```

## Blocked Sources

```text
BLOCKED_SOURCES:
- shell command execution from UI
- arbitrary Docker command execution from app
- Docker mutation commands
- process kill/start/restart actions
- service/schedule/firewall/router/DNS state mutation
- reading secret-bearing env files
- reading backup file contents
- touching TerraFusion Postgres
- polling worker or background daemon
```

## Displayable Data

- status state: `ready`, `not running`, `stale`, `unknown`, `blocked`
- named container existence/health without logs or env values
- approved port state without binding changes
- localhost route result code and timestamp
- approved backup metadata fields

## Redaction Rules

- never display env values, database URLs, auth secrets, access grant secrets, or dump contents
- never display full container env/config
- show only known container names and safe status labels
- represent missing or unsafe data as `unknown`, not as an error requiring repair

## Safety

```text
STATUS_SOURCES_DESIGNED: true
IMPLEMENTATION_ADDED: false
COMMAND_EXECUTION_ADDED: false
DOCKER_MUTATION_ADDED: false
POLLING_WORKER_ADDED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-069 — Local Status API Safety Gate
```
