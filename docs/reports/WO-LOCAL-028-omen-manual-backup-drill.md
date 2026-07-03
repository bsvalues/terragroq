# WO-LOCAL-028 — OMEN Manual Backup Drill

## Result

PASS.

A manual backup drill was completed on the OMEN for the local WilliamOS proof PostgreSQL container. The backup artifact was created outside the repository under the approved operator-local runtime path.

No schedule, automation, service registration, cloud sync, schema migration, restore, production export, or secret disclosure occurred.

## Base

```text
origin/main = 5b1d25d63ec81c4d5ab513e2fdbe846d28e5e2a5
```

## Backup Created

```text
BACKUP_CREATED: true
```

Backup artifact:

```text
Location: C:\Users\bsval\williamos-local-runtime\backups\williamos-omen-manual-backup-20260703-060207.dump
Size: 902 bytes
Format: PostgreSQL custom-format dump
Source container: williamos-postgres-proof
Source container health before backup: healthy
```

The small file size is expected for the current proof database posture because the local proof database does not yet contain a meaningful application dataset.

## Procedure Executed

Command class:

```text
docker exec williamos-postgres-proof sh -lc "pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/<backup-file>.dump"
docker cp williamos-postgres-proof:/tmp/<backup-file>.dump C:\Users\bsval\williamos-local-runtime\backups\<backup-file>.dump
docker exec williamos-postgres-proof rm -f /tmp/<backup-file>.dump
```

Secret handling:

```text
POSTGRES_USER and POSTGRES_DB expanded inside the container.
No database password, DATABASE_URL, or env file content was printed.
```

## Quoting Correction

The first backup attempt failed because PowerShell quoting passed an invalid role string to `pg_dump`.

Impact:

```text
backup artifact created: false
secrets disclosed: false
database mutated: false
```

The command was rerun with corrected container-side shell expansion and succeeded.

## Restore Path Documented

Restore was not executed in this WO. The manual restore path remains:

1. keep the active WilliamOS proof database untouched
2. create a disposable isolated PostgreSQL restore container or restore database
3. copy the selected `.dump` file into the restore target
4. run `pg_restore` against the disposable target
5. verify table list and row counts where data exists
6. remove the disposable restore target after proof
7. never restore into TerraFusion PostgreSQL
8. never overwrite the active WilliamOS database without a separate owner-approved recovery work order

## Schedule / Automation

```text
SCHEDULE_CREATED: false
BACKUP_AUTOMATION_INSTALLED: false
SERVICE_REGISTERED: false
```

## Secret Handling

```text
SECRETS_DISCLOSED: false
SECRETS_COMMITTED: false
DATABASE_URL_PRINTED: false
ENV_FILE_PRINTED: false
```

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
BACKUP_CREATED: true
BACKUP_LOCATION_OUTSIDE_REPO: true
RESTORE_PATH_DOCUMENTED: true
SCHEDULE_CREATED: false
SERVICE_REGISTERED: false
CLOUD_SYNC_CONFIGURED: false
PRODUCTION_DATA_EXPORTED: false
DB_SCHEMA_CHANGED: false
DATABASE_MUTATED: false
TERRAFUSION_AFFECTED: false
SECRETS_DISCLOSED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
DNS_CHANGED: false
PRODUCTION_DEPLOYED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Next Recommended WO

```text
WO-LOCAL-029 — OMEN Rollback Drill
```
