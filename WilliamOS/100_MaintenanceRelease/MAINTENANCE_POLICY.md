---
type: governance
status: accepted
tags:
  - maintenance
  - policy
  - governance
---

# Maintenance Policy

## What a Maintenance Release Is

A maintenance release is a local checkpoint that validates post-baseline additions and creates a snapshot marker. It is not a product release, not a cloud deployment, and not a remote push.

## Why WO-017 Through WO-020 Are Included

These four work orders added the operating governance layer on top of v1.0:

| WO | Layer | Purpose |
|----|-------|---------|
| WO-017 | Operating Routine | Daily/weekly/monthly review generation |
| WO-018 | Human Review Queues | Queue scanning, reports, checklists |
| WO-019 | Official Acceptance | One-item controlled acceptance with logging |
| WO-020 | Post-Acceptance Closure | Queue refresh, check, snapshot recommendation |

Together they complete the human-in-the-loop review cycle: routine review → queue scanning → acceptance → closure.

## Rules

1. **No remote push.** Maintenance releases are local only.
2. **No remote creation.** Do not create remotes during maintenance.
3. **No upload.** Do not upload notes, reports, or archives.
4. **No source-note modification.** Maintenance never touches official folders.
5. **No automatic commit.** Maintenance reports are generated but not committed automatically.
6. **No automatic tag.** Tags require explicit `--name` argument.
7. **No tag if checks fail.** Blocking failures prevent tagging.
8. **No internet required.** All checks are local.
9. **No secrets.** Forbidden file scan must pass before tagging.
10. **No Git history rewrite.** Tags are additive — never amend or force-push.

## Maintenance Check Categories

Checks are classified as:

- **Required** — must pass for tagging to proceed (check, git-status, remote-status, forbidden files, remote scan)
- **Warning** — tracked but do not block tagging (routine-status, review-status, etc.)

## Maintenance Flow

1. Run `maintenance-review --dry-run` to preview
2. Run `maintenance-review` to generate report
3. Run `maintenance-manifest` to generate manifest
4. Run `maintenance-tag --name vX.Y.Z --dry-run` to preview tag
5. Create snapshot commit if working tree is dirty
6. Run `maintenance-tag --name vX.Y.Z` to create local tag
7. Do NOT push
