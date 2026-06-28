---
type: governance
status: accepted
tags:
  - backup
  - external-drive
  - policy
  - governance
---

# External Drive Backup Policy

## Purpose

This policy governs how WilliamOS backups are created on external drives or removable storage.

## Rules

1. **Destination must be explicit.** Every command requires `--dest <path>`. The engine never assumes, detects, or remembers a drive path.
2. **Destination must be outside the repo.** Backing up into the live repo is blocked.
3. **No overwriting.** Each backup has a unique timestamped name. Existing archives are never overwritten.
4. **No deleting from destination.** The engine never deletes files from the external drive.
5. **No formatting.** The engine never formats drives or partitions.
6. **No background sync.** Backups are manual, one-shot operations.
7. **No cloud.** This is local-to-local only.
8. **No remote push.** Backups are archives, not git pushes.
9. **No secrets.** Forbidden files are detected and blocked before archive creation.
10. **Verification required.** Every backup should be verified with `backup-verify`.
11. **Restore drill recommended.** After verifying, run a restore drill to a temporary folder.

## What Happens During a Drive Backup

1. Destination is validated (exists, writable, outside repo, has space)
2. Existing backup engine scans files, excludes caches/secrets
3. Zip archive is created at the destination with a timestamp name
4. SHA-256 checksum sidecar is written alongside the archive
5. Archive is verified for integrity and required files
6. Log entry is appended to `DRIVE_BACKUP_LOG.md`
7. Restore drill command is recommended (not run automatically)

## What Does NOT Happen

- No automatic scheduling
- No drive detection
- No encryption (future policy decision)
- No deletion of source or destination files
- No git commit (you decide when to snapshot)
