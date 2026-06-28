---
type: governance
status: active
area: production-readiness
tags:
  - governance
  - production
  - policy
---

# Production Readiness Policy

## When to Run

Run `production-readiness` before any release tag. The gate must pass before
`release-tag` or `maintenance-tag` is created.

## Gate Structure

The gate runs ten checks. Each produces PASS or FAIL.

| # | Check | Source | Blocking |
|---|-------|--------|----------|
| 1 | Global governance check | `william.py check` | Yes |
| 2 | Runtime smoke suite | `williamos_smoke.py` | Critical commands only |
| 3 | Control Center smoke suite | `william.py control-center-smoke` | Yes |
| 4 | Restore runtime proof | `93_RestoreDrill/proofs/` | Yes |
| 5 | Schema validation | `williamos_schema.py` | Yes |
| 6 | Command registry reconciliation | `williamos_commands.py` | Yes |
| 7 | Backup archive exists | `92_BackupGovernance/` | Yes |
| 8 | Git safety (no remote, no push) | `william.py git-status` | Yes |
| 9 | Required docs present | All governance folders | Yes |
| 10 | No forbidden files in tree | `.env`, secrets, keys | Yes |

## Verdict Rules

- **PASS**: All 10 checks pass. Safe to tag.
- **WARN**: All blocking checks pass but non-critical smoke commands failed. Tag with caution.
- **FAIL**: One or more blocking checks failed. Do not tag.

## Report Storage

- Markdown reports: `106_ProductionReadiness/reports/`
- JSON data: `106_ProductionReadiness/data/`
- Reports have `status: draft` and `type: production-readiness-report`.

## Non-Negotiables

- No push, no remote, no sync.
- No modifying source notes.
- No claiming readiness without proof artifacts.
- No automatic acceptance or tagging — readiness is a checkpoint, not a trigger.
