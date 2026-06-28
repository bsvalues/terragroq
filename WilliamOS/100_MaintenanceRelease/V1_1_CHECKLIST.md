---
type: governance
status: accepted
tags:
  - maintenance
  - checklist
  - governance
---

# v1.1 Maintenance Checklist

This is the 20-point checklist for validating WilliamOS v1.1 maintenance release readiness.

## Required Checks (Blocking)

These must pass for tagging to proceed.

| # | Check | Command | Category |
|---|-------|---------|----------|
| 1 | Vault governance | `python scripts/william.py check` | required |
| 13 | Git governance status | `python scripts/william.py git-status` | required |
| 16 | Remote status | `python scripts/william.py remote-status` | required |
| 19 | Forbidden file scan | (direct scan) | required |
| 20 | Remote scan | (direct scan) | required |

## Warning Checks (Non-Blocking)

These are tracked but do not block tagging. Warnings indicate areas that may need attention.

| # | Check | Command | Category |
|---|-------|---------|----------|
| 2 | Routine status | `python scripts/william.py routine-status` | warning |
| 3 | Daily review dry-run | `python scripts/william.py daily-review --dry-run` | warning |
| 4 | Weekly review dry-run | `python scripts/william.py weekly-review --dry-run` | warning |
| 5 | Monthly review dry-run | `python scripts/william.py monthly-review --dry-run` | warning |
| 6 | Review queue status | `python scripts/william.py review-status` | warning |
| 7 | Review queues dry-run | `python scripts/william.py review-queues --dry-run` | warning |
| 8 | Acceptance checklist (all) | `python scripts/william.py acceptance-checklist --lane all` | warning |
| 9 | Accept status | `python scripts/william.py accept-status` | warning |
| 10 | Closure status | `python scripts/william.py closure-status` | warning |
| 11 | Post-acceptance dry-run | `python scripts/william.py post-acceptance --dry-run` | warning |
| 12 | Cockpit status | `python scripts/william.py cockpit-status` | warning |
| 14 | Backup status | `python scripts/william.py backup-status` | warning |
| 15 | Restore status | `python scripts/william.py restore-status` | warning |
| 17 | Orphan check | `python scripts/william.py orphans` | warning |
| 18 | Stale decisions | `python scripts/william.py stale-decisions` | warning |

## Result Classification

| Result | Meaning |
|--------|---------|
| **PASS** | All 20 checks passed. Safe to tag. |
| **PASS_WITH_WARNINGS** | Required checks passed, some warnings. Review before tagging. |
| **FAIL** | One or more required checks failed. Do not tag. |

## Running the Checklist

```bash
python scripts/william.py maintenance-review --dry-run
python scripts/william.py maintenance-review
```

The `maintenance-review` command runs all 20 checks automatically and generates a report with results classified by category.
