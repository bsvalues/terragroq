# WO-LOCAL-031 — OMEN Persistence Decision Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the decision framework for whether WilliamOS on the HP OMEN should remain manual-run only or later receive limited local persistence for development. It does not implement persistence.

## Base

```text
origin/main = e0b7c1bbd92396afa9328bb11937370dc4544383
```

## Context

Phase 1 OMEN proof is complete:

- host confirmed: HP OMEN Gaming Laptop 16-ap0xxx
- Docker runtime works
- WilliamOS app image builds
- app proof runs on `127.0.0.1:3100`
- `/api/health` and `/api/auth/readiness` pass in the local proof
- manual backup exists outside the repo
- rollback returned the host to a safe state

Current local posture:

```text
williamos-postgres-proof: healthy on 127.0.0.1:15432
app proof container: removed
ports 3100/3101: clear
```

## Manual-Only Option

Definition:

```text
The Primary Operator starts, verifies, and stops WilliamOS manually when local operation is needed.
```

Characteristics:

- lowest implementation risk
- no automatic startup
- no Windows service
- no scheduled task
- no Docker daemon config changes
- no LAN exposure
- easy rollback because app containers are temporary
- operator must remember startup, health checks, shutdown, and backup discipline

Best fit:

```text
current Phase 1 development/proof work
```

## Limited-Persistence Option

Definition:

```text
A later owner-approved implementation allows a narrow local persistence model for development convenience.
```

Possible future scope:

- persistent PostgreSQL proof container only
- manual app container remains preferred
- or app container persistence with explicit stop/start commands
- no LAN/public exposure
- no autonomy
- no scheduler except separately approved backup automation

Required before implementation:

- fresh backup
- rollback procedure
- operator stop command
- log location
- health/readiness verification
- confirmation that secrets stay operator-local

## Risk Comparison

| Area | Manual-only | Limited persistence |
| --- | --- | --- |
| Startup convenience | Lower | Higher |
| Accidentally running stale app | Lower | Higher |
| Port conflict risk | Lower | Medium |
| Secret exposure risk | Lower | Medium |
| Recovery simplicity | Higher | Medium |
| Operator burden | Higher | Lower |
| Evidence clarity | Higher | Medium |
| Good for Phase 1 proof | Yes | Maybe later |

## Operator Burden

Manual-only burden:

- start Docker Desktop if needed
- verify PostgreSQL proof health
- build/reuse image
- start app container
- verify routes
- stop/remove app container
- create backups manually

Limited-persistence burden:

- fewer manual starts
- more responsibility to verify what is currently running
- more need for logs, stop commands, and stale-state checks

## Boot / Restart Implications

Manual-only:

```text
safe after reboot because WilliamOS app does not start automatically
```

Limited persistence:

```text
requires explicit safe boot design so the app does not expose LAN, run stale code, or hide degraded readiness
```

## Backup Requirements

Before any future persistence:

- create a fresh backup
- verify backup exists and is non-empty
- record backup path
- document restore target
- confirm no secrets are in backup logs

## Rollback Requirements

Before persistence implementation:

- stop command
- remove/disable persistence command
- port-clear verification
- service/scheduled-task absence check
- Postgres retention decision
- rollback evidence report

## Security Implications

Manual-only is safer by default because it avoids implicit runtime.

Limited persistence increases the need for:

- clear env handling
- log redaction
- no LAN exposure
- no public exposure
- no automatic repair
- no autonomous worker activation

## Recommended Posture

```text
RECOMMENDED_POSTURE: manual-only for now, with limited persistence deferred behind a future implementation gate
```

Rationale:

- the OMEN proof is successful but still Phase 1
- the app can be started manually when needed
- persistence adds convenience but also stale-runtime and secret-handling risk
- PostgreSQL proof is already retained and healthy
- no current need justifies Windows service/startup registration

## Owner Decision Required Before Implementation

Owner must explicitly decide one of:

```text
Option A: keep OMEN manual-only
Option B: approve limited persistence design only
Option C: approve limited persistence implementation under a separate batch
```

This WO does not authorize Option C.

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
PERSISTENCE_IMPLEMENTED: false
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
WO-LOCAL-032 — Manual-Only Operating Mode Gate
```
