# WO-LOCAL-035 — Backup Before Persistence Gate

## Result

PASS / DESIGN GATE ONLY.

This report defines the required backup posture before any future OMEN persistence implementation can be authorized. It does not create backup automation, schedules, services, startup items, or persistence.

## Base

```text
origin/main = c0af40a0885bcc108bf4ac4534b807d3627c7f95
```

## Backup Before Persistence Policy

Before any future persistence implementation:

```text
fresh manual backup required
```

The backup must be created after the owner authorizes a persistence implementation batch and before any service/startup/schedule mechanism is created.

## Required Backup

Required source:

```text
williamos-postgres-proof
```

Required target:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Required format:

```text
PostgreSQL custom-format dump
```

Required proof:

- backup file exists
- backup file is non-empty
- backup path is outside repository
- backup command did not print secrets
- backup timestamp is recorded

## Backup Naming Convention

Recommended naming:

```text
williamos-before-persistence-YYYYMMDD-HHMMSS.dump
```

Example:

```text
C:\Users\bsval\williamos-local-runtime\backups\williamos-before-persistence-20260703-120000.dump
```

## Restore Verification Expectation

Minimum expectation before persistence:

- restore command documented
- restore target defined as disposable/isolated
- active WilliamOS proof database not overwritten
- TerraFusion PostgreSQL not touched

Stronger expectation before long-lived persistence:

```text
perform an isolated restore drill and verify table list/row counts where data exists
```

## Retention Guidance

Minimum retention for pre-persistence backups:

```text
keep until persistence rollback is proven
```

If persistence is implemented and later accepted:

```text
retain pre-persistence backup for at least 14 days or until a newer restore-tested backup exists
```

Never delete the latest known-good backup without a newer verified recovery point.

## What Not To Back Up

Do not automatically back up:

- `.env`
- `app-container.env`
- raw `DATABASE_URL`
- Better Auth secret
- provider API keys
- session tokens
- SSH keys
- browser cookies
- unrelated TerraFusion databases
- Azure/Vercel credentials

Secret recovery requires separate operator-controlled handling.

## Secret Exclusion

Allowed report content:

```text
backup path
backup size
backup timestamp
source container name
variable name present/missing
```

Blocked report content:

```text
connection strings
passwords
raw env files
tokens
secret screenshots
```

## Failure Handling

If backup fails:

```text
STOP_CONDITION: true
```

Do not proceed to persistence implementation if:

- backup file is missing
- backup file is zero bytes
- backup path is inside repo
- backup command exposes secrets
- PostgreSQL proof is unhealthy
- restore path is unknown

## Owner Confirmation Required

Before persistence implementation, owner must confirm:

1. the backup path is acceptable
2. the backup file exists
3. the backup is recent enough
4. restore path is understood
5. no secrets were disclosed
6. persistence implementation scope remains local-only

## Schedule / Automation

```text
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_INSTALLED: false
```

This gate does not authorize backup schedules or automatic backup jobs.

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
BACKUP_BEFORE_PERSISTENCE_POLICY: defined
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_INSTALLED: false
SERVICE_REGISTERED: false
STARTUP_ITEM_CREATED: false
PERSISTENCE_IMPLEMENTED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
LAN_EXPOSURE_ENABLED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-036 — OMEN Persistence Evidence Rollup
```
