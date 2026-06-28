---
type: governance
status: accepted
tags:
  - backup
  - external-drive
  - runbook
  - governance
---

# Backup Runbook

## Step-by-Step External Drive Backup

### 1. Connect Your Drive

Plug in your external drive, USB stick, or removable storage. Note the mount path.

Windows example: `D:\WilliamOS-Backups`
macOS example: `/Volumes/MyDrive/WilliamOS-Backups`
Linux example: `/mnt/usb/WilliamOS-Backups`

### 2. Check Status

```bash
python scripts/william.py drive-backup-status
```

Verify that governance docs exist and the backup engine is ready.

### 3. Create a Plan (Dry Run)

```bash
python scripts/william.py drive-backup-plan --dest "D:\WilliamOS-Backups" --dry-run
```

Review the destination readiness, estimated size, and any warnings.

### 4. Create a Plan

```bash
python scripts/william.py drive-backup-plan --dest "D:\WilliamOS-Backups"
```

This writes a plan file to `101_ExternalDriveBackup/plans/`.

### 5. Run the Backup

```bash
python scripts/william.py drive-backup --dest "D:\WilliamOS-Backups"
```

This will:
- Validate the destination
- Create a timestamped zip archive
- Write a SHA-256 checksum sidecar
- Verify the archive
- Log the run

### 6. Verify

The backup is automatically verified during creation. To re-verify later:

```bash
python scripts/william.py backup-verify "D:\WilliamOS-Backups\WilliamOS-backup-20260615-120000.zip"
```

### 7. Restore Drill (Recommended)

Test that the backup can be restored:

```bash
python scripts/william.py restore-drill --archive "D:\WilliamOS-Backups\WilliamOS-backup-20260615-120000.zip" --dest "D:\restore-test"
```

### 8. Review the Log

```bash
python scripts/william.py drive-backup-log
```

### 9. Eject Your Drive

Safely eject the drive. The backup is complete.

## Important

- Replace drive paths with your actual mount point
- Never leave the drive path hardcoded — always pass it as an argument
- The engine will never delete files from your drive
- Run a restore drill at least monthly
