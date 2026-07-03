# WO-LOCAL-023 — Observability / Logs Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines minimum logs, checks, and operator-visible evidence required before a dedicated always-on local WilliamOS host can be trusted. It does not install monitoring, create agents, register schedulers, start background workers, mutate containers, or change runtime behavior.

## Base

```text
origin/main = 31437b3968814249415e1a5f1d0fe892c0c511d1
```

## Observability Policy

WilliamOS local hosting must make failures visible without creating autonomous repair behavior.

Observability goals:

- prove the app is running
- prove readiness is healthy or degraded with reason
- prove the database is reachable
- prove backups are recent and restorable
- prove disk usage is safe
- preserve enough logs for diagnosis
- redact secrets consistently
- provide evidence for Work Orders

Observability must not become an execution or remediation subsystem in this batch.

## App Logs

Required future app log categories:

- startup logs
- request/route errors
- health/readiness failures
- auth configuration readiness posture
- database connection failures
- access grant disabled/enabled posture
- unexpected server errors

Log storage options:

```text
Docker container logs
systemd journal, if systemd is later authorized
operator-local log directory outside repo
```

Blocked:

- logging secret values
- logging full `DATABASE_URL`
- logging session tokens
- logging auth secrets
- logging provider API keys

## Database Logs

Required future database evidence:

- container health status
- startup status
- connection failures
- backup command result
- restore drill result
- disk/volume capacity warnings

PostgreSQL logs must remain scoped to WilliamOS PostgreSQL only. TerraFusion PostgreSQL logs are not part of the WilliamOS runtime.

## Container Logs

Container evidence should include:

```text
docker ps status
docker logs tail for WilliamOS app
docker logs tail for WilliamOS Postgres
docker inspect health status for Postgres
docker compose ps, if compose is used
```

Container logs should be collected on demand or by an explicitly approved future monitoring workflow. No collection agent is installed here.

## Health Endpoint Checks

Required endpoint checks:

```text
GET /api/health
GET /api/auth/readiness
GET /goal-console
```

Expected healthy state:

```text
/api/health: 200
/api/auth/readiness: 200
/goal-console: 200
```

Expected degraded state:

```text
structured 503 with non-secret reason categories
```

Health checks must not trigger database migration, auto-repair, access grant activation, or worker execution.

## Readiness Checks

Readiness should prove:

- required env names are present
- database connection works
- auth configuration is coherent
- trusted origins are configured
- email/OTP or access grants remain disabled unless explicitly authorized
- no production secret is printed

Readiness is evidence, not action.

## Disk Usage Checks

Dedicated-host trust requires disk checks for:

- Docker image/cache growth
- PostgreSQL volume
- backup directory
- app logs
- system logs

Recommended thresholds:

```text
warning: below 20% free
critical: below 10% free
stop-before-upgrade: below 15% free
```

No disk monitoring automation is installed in this work order.

## Backup Status Checks

Minimum backup evidence:

- latest backup file path
- latest backup timestamp
- backup file size
- restore drill date
- restore drill result
- retention cleanup result

Backup evidence must not contain credentials.

## Operator Dashboard / Runbook Expectations

The Primary Operator should be able to answer:

- is WilliamOS running?
- is PostgreSQL healthy?
- is readiness green?
- when was the last backup?
- when was the last restore drill?
- what changed recently?
- what is blocked?
- what requires authority?

The initial implementation can be command/runbook driven. A UI dashboard is a later product lane.

## Log Retention

Recommended initial retention:

```text
app logs: 14 days
database logs: 14 days
health check reports: 30 days
backup reports: match backup retention
failure evidence: keep until resolved
```

Retention must be balanced against disk capacity and must not delete the only evidence of an unresolved failure.

## Redaction / Secrets Policy

Always redact:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- provider API keys
- access tokens
- session tokens
- passwords
- private keys
- email provider secrets
- OAuth secrets

Allowed:

```text
VARIABLE_NAME: present
VARIABLE_NAME: missing
route: status code
container: healthy/unhealthy
backup: file path and size
```

Blocked:

```text
raw env dumps
connection strings
token values
secret screenshots
full credential-bearing command output
```

## Failure Evidence

Failure reports should include:

- timestamp
- host
- command/check run
- route/status
- container status
- non-secret error category
- recent deployment/work order reference
- rollback state
- next recommended safe action

Failure evidence must not include automatic repair or autonomous continuation.

## Stop Conditions

Stop before implementation if observability requires:

- monitoring service installation
- background worker
- scheduler
- cloud telemetry
- public network access
- secret disclosure
- production-write behavior
- DB/schema mutation
- Hermes/MCP/autonomy activation

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note:

```text
The first combined validation command timed out without returning a source failure.
Validation was rerun as discrete commands, and the generated .next directory was removed before the successful build to avoid the known Windows stale standalone artifact scan issue.
```

## Safety Posture

```text
MONITORING_INSTALLED: false
BACKGROUND_WORKER_STARTED: false
SCHEDULER_CREATED: false
SERVICE_REGISTERED: false
LOG_AGENT_INSTALLED: false
CLOUD_TELEMETRY_CONFIGURED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
LAN_EXPOSURE_ENABLED: false
FIREWALL_CHANGED: false
DNS_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-024 — Dedicated Host Evidence Rollup
```
