---
type: governance
status: active
area: production-readiness
tags:
  - governance
  - production
  - readiness
---

# Production Readiness Gate

## Purpose

This folder governs the production readiness gate — the final checkpoint before
a WilliamOS release can be tagged as production-ready. The gate aggregates
results from all subsystems (runtime smoke, Control Center smoke, restore proof,
schema registry, command registry, backup governance, git safety) into a single
PASS/FAIL verdict.

## Commands

| Command | Purpose |
|---------|---------|
| `production-status` | Show current production readiness status |
| `production-readiness` | Run the full production readiness gate |

## Gate Criteria

All of the following must pass for a PASS verdict:

1. **Runtime smoke**: All critical commands pass
2. **Control Center smoke**: All 22 Control Center smoke checks pass, including DevOps playbook endpoints
3. **Restore proof**: Latest proof has HIGH or MEDIUM confidence
4. **Schema check**: All schemas valid, templates match
5. **Command registry**: Registry count matches CLI count
6. **Backup verified**: At least one verified local archive
7. **Git safety**: No remotes, no push history, clean status awareness
8. **Global check**: `william.py check` passes
9. **Required docs**: All governance folders have required docs
10. **Forbidden files**: No secrets or env files in repo

## Files

- `README.md` — This file
- `PRODUCTION_POLICY.md` — Production readiness policy and criteria
- `reports/` — Generated production readiness reports
- `data/` — Machine-readable gate results (JSON)

## Safety

- Read-only checks. Never modifies source notes.
- No push, no remote, no sync.
- Reports are generated artifacts with `status: draft`.
