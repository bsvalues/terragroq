# WO-LOCAL-021 — Persistent Local Service Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the rules for making WilliamOS persistent on a future dedicated local host. It does not create a service, startup item, scheduled task, systemd unit, Docker restart policy, or any durable background process.

## Base

```text
origin/main = 2d048e02a37b49084dd6dcecfbcbe07051d60d1d
```

## Persistence Policy

Persistence may only be introduced after:

- dedicated host requirements are accepted
- localhost-only or LAN access posture is explicitly approved
- local backup/restore policy is accepted
- observability/log expectations are accepted
- app and database health checks are reliable
- rollback/removal commands are documented and tested

This batch does not authorize persistence.

## What May Become Persistent Later

Potential future persistent components:

- WilliamOS application container or process
- WilliamOS PostgreSQL container
- reverse proxy, only after a separate network/SSL gate
- backup automation, only after WO-LOCAL-022 and later implementation approval
- local monitoring checks, only after WO-LOCAL-023 and later implementation approval

Each component needs explicit owner approval before registration.

## What Must Not Become Persistent By Default

Blocked from persistence unless separately authorized:

- Hermes worker execution
- MCP tool execution
- Brain Council autonomous loops
- schedulers or background workers
- access grant issuance or acceptance workers
- email/OTP sending
- public ingress tunnels
- test/proof containers
- disposable restore containers
- any process with production-write behavior

Proof containers must remain manual and temporary unless a later implementation gate promotes them.

## Service Manager Options

### Ubuntu Server LTS

Preferred future dedicated-host option:

```text
systemd-managed Docker Compose or container service
```

Potential patterns:

- systemd unit runs `docker compose up -d`
- systemd unit controls a single app container
- Docker restart policy for database container only after backup policy approval

Systemd is preferred for the dedicated host because it provides explicit boot behavior, logs, status, stop commands, and restart controls.

### Windows 11 / OMEN Proof Host

Acceptable proof-only options:

- manual terminal process
- manual Docker command
- manual Docker Compose command

Blocked until a later implementation gate:

- Windows service wrapper
- scheduled task at login
- startup folder shortcut
- Docker Desktop auto-start dependency

Windows persistence should remain a fallback. Ubuntu Server should be the target for durable always-on hosting.

## Restart Behavior

Future restart behavior should be conservative:

```text
app: restart on failure with bounded retry policy
database: restart unless stopped, only after backup policy approval
workers: disabled unless separately authorized
```

The system must not enter an uncontrolled restart loop. Restart policy must include:

- maximum retry window or documented systemd behavior
- operator-visible failure state
- logs retained for diagnosis
- manual stop override

## Health Checks

Required checks before persistence:

```text
/api/health: 200
/api/auth/readiness: 200
/goal-console: 200
PostgreSQL container health: healthy
backup path: writable
disk capacity: above threshold
```

Health checks must not include secret values in output. Readiness checks must remain evidence-oriented and safe to inspect.

## Manual Stop Commands

Future implementation must provide exact stop commands.

Expected command classes:

```text
systemctl stop <williamos-service>
docker compose down
docker stop <container-name>
```

For the current proof lane, the safe posture remains manual start/stop only.

## Safe Boot Behavior

Safe boot requirements:

- no public exposure on boot
- no `0.0.0.0` binding
- no host port `3000`
- no automatic DB migration
- no automatic access grant activation
- no automatic Hermes/MCP/autonomy activation
- no automatic email/OTP sending
- degraded readiness must not trigger mutation

If the database is unavailable, WilliamOS should fail readiness rather than repair, migrate, or create dependencies automatically.

## Operator Override

The Primary Operator must be able to:

- stop the app
- stop the database
- disable persistence
- inspect logs
- verify current bindings
- restore localhost-only posture
- keep the database running while the app is stopped

Operator override is mandatory before always-on trust.

## Failure Mode

Expected safe failure posture:

```text
app route unavailable or degraded: acceptable
/api/health 503: acceptable evidence
/api/auth/readiness 503: acceptable evidence
automatic repair: blocked
schema migration: blocked
public exposure: blocked
worker activation: blocked
```

Failure should produce evidence, not mutation.

## Rollback / Removal Plan

Future persistence implementation must document:

1. how to stop the service
2. how to disable service startup
3. how to remove the service definition
4. how to confirm no process is listening
5. how to confirm app ports are closed
6. how to preserve database volume and backups
7. how to remove proof containers without touching TerraFusion

No rollback was required here because no service was registered.

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
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
SCHEDULED_TASK_CREATED: false
SYSTEMD_UNIT_CREATED: false
DOCKER_RESTART_POLICY_CHANGED: false
BACKGROUND_WORKER_STARTED: false
LAN_EXPOSURE_ENABLED: false
FIREWALL_CHANGED: false
DNS_CHANGED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-022 — Backup/Restore Automation Gate
```
