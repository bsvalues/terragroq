# WO-LOCAL-022 — Backup/Restore Automation Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines how local WilliamOS backup and restore should become automated before an always-on host is trusted. It does not install automation, create schedules, modify services, change databases, run migrations, expose secrets, or mutate production/cloud systems.

## Base

```text
origin/main = 5556d9024eb0fb7d095c469d7fdf1117d64d9b7e
```

## Backup Automation Policy

Backup automation must prove three things before always-on trust:

1. a backup is created on schedule
2. the backup is stored outside the repository
3. restore is periodically tested into an isolated target

Automation is not trusted until restore has been tested.

## Backup Targets

Primary target:

```text
WilliamOS PostgreSQL database
```

Future optional targets:

- operator-approved config inventory by variable name only
- evidence reports and runbooks already committed to git
- non-secret runtime metadata
- Docker Compose files if they live outside the repo

Blocked targets:

- raw `.env` files
- unencrypted secret files
- committed secrets
- TerraFusion PostgreSQL
- Azure proof resources
- Vercel settings
- unrelated local databases

## Backup Cadence

Recommended first cadence for dedicated host:

```text
daily local database backup
weekly restore drill until stable
monthly restore drill after stability is proven
pre-upgrade backup before any migration, package upgrade, or service model change
```

The first implementation should start with manual invocation or an explicitly approved local scheduler. This report does not authorize a scheduler.

## Retention

Recommended minimum retention:

```text
daily backups: 14 days
weekly backups: 8 weeks
monthly backups: 6 months
pre-upgrade backups: keep until post-upgrade restore point is proven
```

Retention must account for local disk capacity and must never delete the most recent known-good backup automatically without evidence that a newer backup is restorable.

## Restore Drill Cadence

Minimum restore drill policy:

- restore into disposable isolated database/container only
- never restore into TerraFusion PostgreSQL
- never restore into production
- never overwrite the active WilliamOS database without an explicit recovery work order
- verify table list and row counts when data exists
- verify app readiness after a full recovery drill when authorized

Current limitation from WO-LOCAL-010:

```text
backup/restore mechanics are proven, but row-level recovery remains future work because the proof database had no application tables.
```

## Backup Storage Location

Backups must live outside the repo.

Current local proof path:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Dedicated-host target:

```text
/var/backups/williamos or another owner-approved path outside the application repo
```

Secondary copy recommendation:

- external drive
- NAS
- another local trusted machine
- encrypted archive target after secret-handling policy is approved

## What Must Never Be Backed Up Automatically

Blocked from automatic backup unless encrypted and separately approved:

- `.env`
- `app-container.env`
- database URLs
- Better Auth secrets
- provider API keys
- SSH keys
- Azure credentials
- Vercel tokens
- GitHub tokens
- browser/session cookies
- any credential-like value

Secret recovery needs its own operator-controlled procedure.

## Secret Handling

Backup logs and filenames must not include secret values.

Allowed reporting:

```text
DATABASE_URL: present/absent only
BETTER_AUTH_SECRET: present/absent only
backup file: path and size
restore target: container/database name
```

Blocked reporting:

```text
connection strings
passwords
tokens
secret values
full env file contents
```

## Pre-Upgrade Backup Requirement

Before any of these actions:

- DB migration
- schema change
- app package upgrade
- auth behavior change
- access grant activation
- persistent service change
- dedicated-host migration

Required:

1. create a fresh backup
2. record backup path
3. verify backup file exists and is non-empty
4. confirm restore command is known
5. document rollback target

## Failure Alerts

Future automation must produce operator-visible evidence for:

- backup command failed
- backup file missing or zero bytes
- backup path unavailable
- disk threshold exceeded
- restore drill overdue
- retention cleanup failed
- database health degraded

Initial alert mechanism may be a local log/report file. Email, push, or external notification systems are not authorized here.

## Manual Restore Path

Manual restore should remain the canonical recovery path until automation is proven.

Required manual restore sequence:

1. stop app or isolate recovery target
2. create a current emergency backup if the active database is accessible
3. select known-good backup
4. restore into disposable target first
5. verify integrity
6. promote restore only under owner-approved recovery work order
7. verify `/api/health`
8. verify `/api/auth/readiness`
9. document evidence

## Stop Conditions

Stop before automation implementation if it requires:

- scheduler creation
- service registration
- production database access
- TerraFusion database access
- secret disclosure
- committed backup files
- DB/schema migration
- cloud storage
- public network access
- Hermes/MCP/autonomy activation

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
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_INSTALLED: false
RESTORE_AUTOMATION_INSTALLED: false
DATABASE_MUTATED: false
DB_SCHEMA_CHANGED: false
TERRAFUSION_AFFECTED: false
SECRETS_DISCLOSED: false
SECRETS_BACKED_UP_AUTOMATICALLY: false
FIREWALL_CHANGED: false
DNS_CHANGED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-023 — Observability / Logs Gate
```
