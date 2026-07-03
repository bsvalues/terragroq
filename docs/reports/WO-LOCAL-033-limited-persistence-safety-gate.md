# WO-LOCAL-033 — Limited Persistence Safety Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the minimum safety requirements that must be satisfied before any future limited persistence is allowed on the OMEN. It does not implement persistence.

## Base

```text
origin/main = 493ff269333ebf60b318ac6811205b1ac2634098
```

## Limited Persistence Policy

Limited persistence may be considered later only for local development convenience. It must not turn the OMEN into an always-on production host, public endpoint, LAN service, scheduler, worker host, or autonomous system.

Current recommendation remains:

```text
manual-only for now
```

## Allowed Future Persistence

Potential future allowed scope, only after separate owner approval:

- keep `williamos-postgres-proof` running across development sessions
- optionally define a named app container start/stop script
- optionally define a Docker Compose file for manual use
- optionally define a local-only app process with explicit operator start/stop

Required constraints:

- localhost-only binding
- no host port `3000`
- no `0.0.0.0`
- no automatic DB migration
- no public exposure
- no LAN exposure unless separately approved
- no Hermes/MCP/autonomy activation

## Blocked Persistence

Blocked by default:

- Windows service registration
- scheduled task at boot/login
- startup folder shortcut
- Docker daemon config changes
- automatic app container restart
- automatic backup schedule
- background worker
- Hermes/MCP runtime
- public tunnel
- router/firewall/DNS changes
- access grant activation
- email/OTP sending
- production-write behavior

## Required Pre-Persistence Backup

Before any future persistence implementation:

1. create a fresh PostgreSQL backup outside the repo
2. verify backup file exists and is non-empty
3. record backup path
4. verify restore command is known
5. confirm no secrets were printed or committed

Persistence implementation must stop if backup fails.

## Service Manager Options

Preferred current mode:

```text
manual Docker commands
```

Future possible options, requiring separate approval:

- Docker Compose manual profile
- Windows service wrapper only after security review
- scheduled task only after explicit owner approval

Windows service/scheduled-task approaches are not recommended for the next step because the OMEN remains a Phase 1 development/proof host.

## Blocked Service Modes

Blocked:

- start at boot
- start at login
- restart always
- run as elevated service without explicit need
- run under broad permissions
- run with env file copied into repo
- run with public/LAN binding

## Restart Policy Rules

If restart policy is ever approved:

```text
app: no automatic restart by default
database: retain current manual/controlled posture
workers: disabled
```

Any restart behavior must:

- be visible to the operator
- have a documented stop command
- avoid restart loops
- preserve logs
- not auto-repair readiness failures

## Secret Handling

Persistence must not:

- copy env files into the repo
- print `DATABASE_URL`
- print `BETTER_AUTH_SECRET`
- bake secrets into images
- store secrets in task definitions without owner approval
- expose env values in logs

Allowed:

```text
variable name present/missing
operator-local env file path
redacted evidence
```

## Log Handling

Future persistence must define:

- app log source
- database log source
- log retention
- redaction policy
- failure evidence location

Logs must not include secrets or full env dumps.

## Operator Override

The Primary Operator must always be able to:

- stop the app
- remove the app container
- stop persistence
- verify ports are clear
- keep PostgreSQL running while app is stopped
- remove any startup mechanism

No persistence can be accepted without an operator override path.

## Rollback / Removal Plan

Future rollback must include:

1. stop app container/process
2. disable persistence mechanism
3. remove persistence mechanism
4. verify no app process/container remains
5. verify `3100/3101` are clear
6. verify PostgreSQL proof status
7. verify no matching service/task/startup entry remains
8. document evidence

## Stop Conditions

Stop before persistence implementation if it requires:

- service/startup registration without approval
- scheduled task
- Docker daemon config change
- firewall/router/DNS change
- LAN/public exposure
- DB/schema migration
- package/dependency change
- secret disclosure
- committed env file
- Hermes/MCP/autonomy activation
- background worker activation

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

## Safety Posture

```text
LIMITED_PERSISTENCE_POLICY: defined
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
SCHEDULE_CREATED: false
AUTOMATIC_STARTUP_ENABLED: false
DOCKER_DAEMON_CONFIG_CHANGED: false
LAN_EXPOSURE_ENABLED: false
PUBLIC_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
PACKAGE_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-034 — Startup/Shutdown Runbook Gate
```
