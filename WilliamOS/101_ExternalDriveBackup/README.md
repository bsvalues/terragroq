---
type: governance
status: accepted
tags:
  - backup
  - external-drive
  - governance
---

# External Drive Backup

This folder contains the governance documentation and generated artifacts for the WilliamOS External Drive Backup Runbook.

## Why External Drive Backup Matters

Your WilliamOS vault is a local-first personal brain. Git snapshots protect against code-level mistakes, but they live on the same machine. An external drive backup puts a verified copy on physically separate storage — protection against drive failure, theft, or accidental deletion.

## How to Choose a Destination

Pick any writable folder on a removable drive, external SSD, USB stick, or network-attached storage mount point. The destination must:

- Be an existing directory
- Be outside the live repo
- Be writable
- Have enough free space (at least 2x estimated backup size recommended)

You provide the path explicitly every time. The engine never guesses.

## What Gets Backed Up

Everything the existing backup engine includes:
- All vault notes and folders
- Scripts and governance docs
- Git history (`.git/` directory)
- Configuration files

## What Is Excluded

- Secrets and credentials (`.env`, `*.pem`, `*.key`, etc.)
- Virtual environments (`venv/`, `.venv/`)
- Node modules
- Generated caches
- Existing backup archives

## How This Differs From Private Remote Strategy

| Feature | External Drive Backup | Private Remote |
|---------|----------------------|----------------|
| Destination | Removable drive (explicit path) | Git remote (GitHub, etc.) |
| Format | Zip archive + SHA-256 | Git push |
| Frequency | Manual, per-session | Manual push |
| Verification | Archive verify + restore drill | Git pull/clone |
| Requires internet | No | Yes (for remote) |

## Commands

| Command | Purpose |
|---------|---------|
| `drive-backup-status` | Show readiness and latest log |
| `drive-backup-plan --dest <path>` | Generate backup plan for destination |
| `drive-backup-plan --dest <path> --dry-run` | Preview plan without writing |
| `drive-backup --dest <path>` | Run backup to destination |
| `drive-backup-log` | Show backup run history |

## Generated Artifacts

- `plans/` — backup plans (Markdown, committable)
- `logs/DRIVE_BACKUP_LOG.md` — append-only backup run log (committable)
