# WO-LOCAL-041 — Manual Backup Reminder Gate

## Result

PASS / BACKUP REMINDER POLICY CREATED.

This work order defines the manual backup reminder policy for OMEN local WilliamOS operation. It does not create a schedule, automation, service, or backup job.

## Base

```text
origin/main = cd108788251f0d4a9d938af5321a6c3fffae4ed7
```

## Backup Reminder Policy

Before meaningful local operation, the Primary Operator should take or confirm a recent WilliamOS PostgreSQL backup.

Meaningful local operation includes:

- local work that changes WilliamOS data
- extended manual use
- troubleshooting that may alter runtime state
- future persistence decisions or proofs
- restore, upgrade, or migration rehearsals

## Backup Location

Backups live outside the repository:

```text
C:\Users\bsval\williamos-local-runtime\backups
```

Recommended naming convention:

```text
williamos-omen-manual-backup-YYYYMMDD-HHMMSS.dump
```

## Restore Expectation

A backup is not trusted until restore has been proven or the operator understands the restore path.

Current evidence:

```text
WO-LOCAL-010: local backup and restore drill passed
```

## What Not To Back Up

Do not place the following in repository backups, reports, screenshots, or commits:

- `.env` files
- database URLs
- Better Auth secrets
- access grant secrets
- secret-bearing logs
- Docker Desktop credential material

## Operator Checklist

```text
recent backup exists in C:\Users\bsval\williamos-local-runtime\backups
backup timestamp matches the operation risk
backup file remains outside the repository
restore expectation is understood
TerraFusion PostgreSQL is not reused, modified, stopped, or restored into
no secret values are printed or committed
```

## Future Persistence Precondition

Before any future persistence implementation is authorized, the owner must confirm:

```text
fresh backup exists
backup location is outside the repository
restore path is known
secret material is excluded
rollback posture is documented
```

## Safety

```text
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_CREATED: false
SERVICE_REGISTERED: false
PERSISTENCE_IMPLEMENTED: false
LAN_EXPOSURE_ENABLED: false
DB_SCHEMA_CHANGED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
AUTONOMY_CHANGED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-042 — Manual Operations Evidence Rollup
```
