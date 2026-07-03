# WO-LOCAL-067 — Live Status Boundary Gate

## Result

PASS / LIVE STATUS BOUNDARY DEFINED.

This work order defines the hard boundary between future read-only OMEN local status visibility and local command execution.

## Base

```text
origin/main = dc62a0c2af46319f63b4a11e4562aa1f6b587ac5
```

## Boundary

Future live local status may:

- read safe local posture metadata
- display status, stale state, and unknown state
- show warnings and manual instructions
- link to existing operator-run PowerShell wrappers
- fail closed to `unknown` when data cannot be read safely

Future live local status must not:

- start, stop, restart, remove, or create containers
- register services, startup items, or scheduled tasks
- mutate Docker, PostgreSQL, firewall, router, DNS, Azure, Vercel, or production configuration
- run arbitrary shell commands from the UI
- expose LAN or public access
- print, store, or display secrets
- touch TerraFusion Postgres
- activate Hermes, MCP, autonomy, or background workers

## Allowed Status Reads

- Postgres proof container presence and health state, if collected through a later approved read-only mechanism.
- App proof container presence, if collected through a later approved read-only mechanism.
- Port state for `3100`, `3101`, and `15432`.
- Local health/readiness HTTP results from localhost.
- Backup metadata fields approved by a separate backup metadata gate.
- Static known posture from repo docs/configuration.

## Safe Failure Mode

The future implementation must degrade to:

```text
status: unknown
reason: unavailable | unsafe | stale | unauthorized
action: show manual wrapper instructions
```

It must never attempt remediation automatically.

## Operator-Facing Disclaimer

```text
Live status is read-only. WilliamOS may display local posture, but it cannot start, stop, restart, expose, schedule, persist, or repair local services from the UI.
```

## Future Stop Conditions

Stop future implementation if it requires:

- shell execution from the UI
- action parameters
- Docker mutation
- service or schedule registration
- LAN/public binding
- secret disclosure
- DB/schema migration
- package/dependency changes outside explicit scope

## Safety

```text
LIVE_STATUS_BOUNDARY_DEFINED: true
IMPLEMENTATION_ADDED: false
COMMAND_EXECUTION_ADDED: false
MUTATION_ADDED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
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
WO-LOCAL-068 — Read-Only Status Source Design
```
