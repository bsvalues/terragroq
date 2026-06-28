---
type: governance
status: accepted
tags:
  - backup
  - external-drive
  - restore
  - cadence
  - governance
---

# Restore Drill Cadence

## Why Run Restore Drills

A backup you have never tested is not a backup. Restore drills verify that:

- The archive can be extracted
- Required files are present
- No secrets leaked into the archive
- Git history is intact
- The vault structure is complete

## Recommended Cadence

| Frequency | When | What to Test |
|-----------|------|-------------|
| After every backup | Same session | Quick restore drill to temp folder |
| Monthly | First week of month | Full restore drill + check on extracted copy |
| After maintenance release | Same session as tag | Verify the tagged backup can restore |

## How to Run a Restore Drill

```bash
python scripts/william.py restore-drill \
  --archive "D:\WilliamOS-Backups\WilliamOS-backup-20260615-120000.zip" \
  --dest "D:\restore-test"
```

The restore drill:
1. Extracts the archive to the destination
2. Runs health checks on the extracted copy
3. Reports pass/fail
4. Cleans up (unless `--keep` is specified)

## After a Failed Restore Drill

If a restore drill fails:

1. Check the drill report for specific failures
2. Do NOT delete the archive — it may still be partially usable
3. Create a new backup from the live repo
4. Run a restore drill on the new backup
5. If the new backup also fails, investigate the backup engine output

## Storage Recommendations

- Keep at least the 2 most recent verified backups on your external drive
- Delete older backups only after verifying newer ones pass restore drills
- Label your archives by date — the timestamp in the filename handles this automatically
