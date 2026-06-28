---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - safety
---

# Safety Allowlist

Source: `control-center/backend/safety.py`

## SAFE_COMMANDS (run freely, no arguments)

check, mcp-check, orphans, stale-decisions, cockpit-status, routine-status, review-status, accept-status, accept-log, closure-status, semantic-status, cortex-status, git-status, backup-status, restore-status, remote-status, release-status, maintenance-status, drive-backup-status, production-status, obsidian-status, schema-status, schema-check, command-status, runtime-status, inbox-status, doctrine-status, decision-status, concept-status, project-status, synth-status, help-all

## SAFE_WITH_ARGS (run with validated arguments)

| Command | Required Args | Allowed Flags |
|---------|--------------|---------------|
| inbox | text | |
| today | | |
| weekly | | |
| decision | title | |
| doctrine | title | |
| concept | title | |
| case | title | |
| semantic-search | query | |
| review-queues | | --dry-run |
| accept-plan | | --draft |
| daily-review | | --dry-run |
| weekly-review | | --dry-run |
| cockpit | | --dry-run |
| process-inbox | | --dry-run |
| production-readiness | | |
| runtime-smoke | | --dry-run |
| obsidian-quality | | --dry-run |

## CONFIRM_REQUIRED (user must confirm in UI)

| Command | Reason |
|---------|--------|
| snapshot | Creates a git commit |
| backup | Creates a backup archive |
| drive-backup | Copies to external drive |
| accept-draft | Moves a draft into an official folder |
| release-tag | Creates a release tag |
| maintenance-tag | Creates a maintenance tag |

## FORBIDDEN (blocked entirely)

semantic-clear, git-init, remote-strategy, remote-readiness
