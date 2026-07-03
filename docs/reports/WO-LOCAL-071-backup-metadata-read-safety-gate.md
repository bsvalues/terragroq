# WO-LOCAL-071 — Backup Metadata Read Safety Gate

## Result

PASS / BACKUP METADATA POLICY DEFINED.

This work order defines how WilliamOS may safely display backup metadata in a future read-only local status implementation. No backup scanning, automation, or scheduling is implemented in this batch.

## Base

```text
origin/main = 079e7c2c2147d9469224e9ba8c1a5f5571a093b9
```

## Safe Metadata Fields

Future display may include:

- backup directory exists: `true | false | unknown`
- latest backup filename, if it matches the expected local backup naming convention
- latest backup timestamp
- backup age bucket: `fresh | aging | stale | unknown`
- manual reminder state
- restore drill reminder
- metadata checked timestamp

## Blocked Backup Data

Future display must not include:

- backup file contents
- database dump contents
- database row data
- env files
- database URLs
- Better Auth secrets
- access grant secrets
- secret-bearing logs
- cloud sync state unless separately authorized
- full filesystem scans outside the documented local runtime backup path

## Redaction Rules

- show filename and timestamp only, never file contents
- show only the documented local runtime backup path category
- avoid printing secret-like tokens from filenames or paths
- if metadata is suspicious or outside the expected path, return `unknown`
- if access is denied, return `unknown`, not an error requiring repair

## Stale and Unknown States

Recommended future states:

```text
fresh: within owner-approved freshness window
aging: present but should be reviewed
stale: older than the approved freshness window
unknown: missing, unreadable, unsafe, or not implemented
```

The UI should pair `aging`, `stale`, and `unknown` with manual backup-check instructions.

## Future Test Requirements

Future implementation must test:

- no backup contents appear in responses or UI
- no secrets appear in responses or UI
- missing backup directory returns `unknown`
- unexpected path returns `unknown`
- stale backup shows manual reminder only
- no backup creation, schedule, or automation occurs

## Safety

```text
BACKUP_METADATA_POLICY: metadata-only
SAFE_METADATA_FIELDS_DEFINED: true
BACKUP_SCAN_IMPLEMENTED: false
BACKUP_AUTOMATION_ADDED: false
SCHEDULE_CREATED: false
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
WO-LOCAL-072 — Live Status Design Evidence Rollup
```
