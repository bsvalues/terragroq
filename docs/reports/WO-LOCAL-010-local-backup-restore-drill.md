# WO-LOCAL-010 — Local Backup and Restore Drill

## Result

PASS / LIMITED DATASET.

The WilliamOS local PostgreSQL proof database was backed up and restored into a disposable isolated PostgreSQL container. The restore target had no host port binding and was removed after verification.

The current proof database contains zero public tables, so this drill verifies backup/restore mechanics, database catalog restore, and source/restore table-list equivalence for the current dataset. It does not yet prove row-level application data recovery because there is no application data in the proof database.

## Base

```text
origin/main = 17109bb8bac59428d29a64a8ec12b4fa36eef323
```

## Backup Procedure Executed

Source:

```text
container: williamos-postgres-proof
database: williamos_local
binding: 127.0.0.1:15432 -> container 5432
```

Backup command shape:

```text
docker compose exec -T postgres pg_dump -U williamos -d williamos_local -Fc -f /backup/<backup-file>.dump
```

Backup artifact:

```text
C:\Users\bsval\williamos-local-runtime\backups\williamos-local-drill-20260702-193307.dump
```

Artifact size:

```text
902 bytes
```

Backup duration:

```text
2747 ms
```

No secret values were printed, committed, or copied into this report.

## Restore Target Description

Restore target:

```text
container: williamos-restore-drill-20260702-193307
image: postgres:16-bookworm
database: williamos_restore_drill
host port binding: none
network posture: isolated; no host exposure
```

Restore command shape:

```text
docker exec <restore-container> pg_restore -U postgres -d williamos_restore_drill /backup/<backup-file>.dump
```

Restore duration:

```text
260 ms
```

Cleanup:

```text
temporary restore container removed
```

## Restore Validation Results

Restore readiness:

```text
/var/run/postgresql:5432 - accepting connections
```

Source database:

```text
williamos_local
```

Restored database:

```text
williamos_restore_drill
```

Integrity checks:

```text
source public tables: 0
restore public tables: 0
source/restore table lists match: true
temporary restore container remaining: false
```

## Integrity Verification Checklist

```text
Backup artifact created outside repo: pass
Backup artifact non-empty: pass
Restore target isolated from WilliamOS source database: pass
Restore target isolated from TerraFusion: pass
Restore target had no host port exposure: pass
Restore command completed: pass
Restored database accepted connections: pass
Source/restore public table counts matched: pass
Source/restore public table lists matched: pass
Temporary restore target removed after proof: pass
Secrets disclosed: false
```

Dataset limitation:

```text
No public application tables or rows were present in williamos_local during this drill.
```

## TerraFusion / Production Safety

TerraFusion proof:

```text
terrafusion-postgres-dev: still running separately on 5432
```

WilliamOS proof:

```text
williamos-postgres-proof: healthy on 127.0.0.1:15432->5432
```

Safety:

```text
TERRAFUSION_AFFECTED: false
PRODUCTION_AFFECTED: false
AZURE_CHANGED: false
VERCEL_CHANGED: false
PUBLIC_EXPOSURE: false
SECRETS_DISCLOSED: false
HERMES_MCP_AUTONOMY_CHANGED: false
```

## Lessons Learned

- A disposable restore container is safer for routine drills than restoring into the live proof database.
- The local safety hook blocked an initial database cleanup command shape, which is useful protection.
- Backup/restore mechanics are proven, but the next meaningful drill should run after WilliamOS has non-sensitive local application data.
- The runbook should recommend disposable restore drills before any destructive live-database restore path.

## Recommended Recovery Procedure

For routine proof validation:

1. Create a timestamped custom-format backup under `C:\Users\bsval\williamos-local-runtime\backups`.
2. Start a temporary PostgreSQL restore container with no host port binding.
3. Restore the backup into the temporary database.
4. Verify restore readiness and catalog/table equivalence.
5. Remove the temporary restore container.
6. Leave the source `williamos-postgres-proof` database untouched.

For real recovery:

1. Stop the WilliamOS app process.
2. Confirm the backup file is the intended WilliamOS backup.
3. Confirm TerraFusion is not the target.
4. Use an owner-approved recovery work order before replacing or rebuilding the live local proof database.
5. Verify `/api/health` and `/api/auth/readiness` after recovery.

## Runbook Improvements Identified

Update the local operator runbook to add a disposable restore-drill procedure before any live recovery operation.

## Validation

```text
git diff --check: pass
npm test -- --run: pass, 106 files / 437 tests
npm run build: pass
```

Note: the first build attempt hit the known stale generated `.next/standalone` Windows `EPERM` scan error. The generated `.next` directory was removed from inside the repository and the build was rerun successfully.

## Next Recommended WO

WO-LOCAL-011 — Container Stack Definition.

Purpose: define the complete Docker Compose stack for WilliamOS, PostgreSQL, optional supporting services, backup volumes, logs, and future migration boundaries before adding durable services or Kubernetes.
