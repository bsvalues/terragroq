---
type: governance
status: accepted
tags:
  - backup
  - external-drive
  - readiness
  - governance
---

# Destination Readiness

## What Is Checked

Before any backup runs, the destination is validated:

| Check | Required | Details |
|-------|----------|---------|
| Path provided | Yes | Must pass `--dest` explicitly |
| Path exists | Yes | Must be an existing path |
| Is a directory | Yes | Must be a folder, not a file |
| Is writable | Yes | Write test file, then remove it |
| Outside live repo | Yes | Must not be inside the working directory |
| Outside vault | Yes | Must not be inside the WilliamOS folder |
| Not a cache folder | Warning | Warns if path contains `generated/cache` |
| Free space available | Best effort | Uses `shutil.disk_usage()` if platform supports it |

## Free Space

Free space checking uses Python's `shutil.disk_usage()`. This works on most platforms (Windows, macOS, Linux). If the call fails (e.g., on unusual mount points), the result is reported as "unknown" — the backup still proceeds.

A warning is raised if free space is less than 2x the estimated backup size.

## Writable Check

The engine writes a small test file (`.williamos_write_test`) to the destination, then immediately deletes it. If the write fails, the destination is marked as not writable.

## What Blocks a Backup

- Missing destination path
- Destination does not exist
- Destination is not a directory
- Destination is inside the repo or vault
- Destination is not writable

## What Warns But Does Not Block

- Free space is low
- Path looks like a cache folder
- Free space is unknown
