---
type: work-order-report
work_order: WO-036
title: Control Center Post-Acceptance Closure UX
status: complete
area: control-center
completed: 2026-06-17
---

# WO-036 — Control Center Post-Acceptance Closure UX

## Mission

Add post-acceptance closure UX to the Control Center. After a draft is accepted, guide William through closure: checklist generation, queue/cockpit refresh, snapshot recommendation. Not auto-commit. Not auto-backup. Human-guided closure flow.

## What Changed

### Backend — Safety (1 file)

| File | Change |
|------|--------|
| `control-center/backend/safety.py` | Added `post-acceptance-checklist` to `SAFE_COMMANDS`. Added `post-acceptance` to `SAFE_WITH_ARGS` with `--dry-run` and `--refresh-cortex` flags. |

### Backend — Command Runner (1 file)

| File | Change |
|------|--------|
| `control-center/backend/command_runner.py` | Added `run_snapshot_dry_run()` — dedicated function that only passes `--dry-run` to snapshot, bypassing CONFIRM_REQUIRED gate. |

### Backend — Agent (1 file)

| File | Change |
|------|--------|
| `control-center/backend/agent.py` | Added `post_acceptance_guidance()` — deterministic guidance function explaining closure steps, snapshot recommendation, and warnings. |

### Backend — API (1 file)

| File | Change |
|------|--------|
| `control-center/backend/app.py` | Added 5 endpoints: `POST /api/closure/checklist`, `POST /api/closure/dry-run`, `POST /api/closure/run`, `POST /api/git/snapshot-dry-run`, `POST /api/agent/post-acceptance`. |

### Frontend (2 files)

| File | Change |
|------|--------|
| `control-center/frontend/src/api.ts` | Added 5 API calls: `closureChecklist()`, `closureDryRun()`, `closureRun()`, `snapshotDryRun()`, `agentPostAcceptance()`. |
| `control-center/frontend/src/App.tsx` | Added closure actions section inside acceptance result panel: 5 action buttons with generic async handler, inline result rendering, suggested snapshot command display. |

### Smoke & Governance (2 files)

| File | Change |
|------|--------|
| `scripts/williamos_control_center.py` | Expanded smoke suite from 14 to 18 checks (closure endpoints). |
| `WilliamOS/110_ControlCenter/SMOKE_TESTS.md` | Updated reference table and expected output. |

## New Endpoints

| Endpoint | CLI Command | Safety Category |
|----------|-------------|-----------------|
| `POST /api/closure/checklist` | `post-acceptance-checklist` | SAFE_COMMANDS |
| `POST /api/closure/dry-run` | `post-acceptance --dry-run` | SAFE_WITH_ARGS |
| `POST /api/closure/run` | `post-acceptance` | SAFE_WITH_ARGS |
| `POST /api/git/snapshot-dry-run` | `snapshot --dry-run` | Dedicated function |
| `POST /api/agent/post-acceptance` | (agent, no CLI) | Read-only |

## Frontend UX

### Closure Actions Section

Added inside the acceptance result panel, below existing buttons, separated by a border:

**Buttons (in execution order):**
1. Generate Checklist — calls `post-acceptance-checklist`
2. Closure Dry-Run — calls `post-acceptance --dry-run`
3. Run Closure — calls `post-acceptance`
4. Snapshot Dry-Run — calls `snapshot --dry-run`
5. Post-Acceptance Guidance — calls agent guidance

**Behavior:**
- Each button calls its endpoint independently
- Only one action runs at a time (all buttons disabled during loading)
- Results render inline below buttons
- Agent guidance shows structured steps, warnings, snapshot note
- CLI output wrapped in collapsible Details component
- Errors render in red with message
- Suggested snapshot command shown after snapshot dry-run or closure run

**No commit button. No backup button. No push button.**

### State Model

- `closureLoading: string | null` — tracks which action is in flight
- `closureResults: Record<string, any>` — stores results keyed by action
- Generic `runClosureAction(key, apiFn)` handler — prevents code duplication
- State resets on draft selection change or back navigation

## Smoke Results

```
=== Control Center Smoke Test ===

  [PASS] status: PASS
  [PASS] home: PASS
  [PASS] today: PASS
  [PASS] review_queues: PASS
  [PASS] agent_next: PASS
  [PASS] safety: PASS
  [PASS] unsafe_refusal: PASS
  [PASS] frontend: PASS
  [PASS] review_items: PASS
  [PASS] path_safety: PASS
  [PASS] accept_wrong_confirm: PASS
  [PASS] accept_bad_dest: PASS
  [PASS] accept_generic_refused: PASS
  [PASS] closure_checklist: PASS
  [PASS] closure_dry_run: PASS
  [PASS] snapshot_dry_run: PASS
  [PASS] agent_post_acceptance: PASS
  [PASS] accept_traversal: PASS

  Smoke: PASS (18/18)
```

## Safety

| Check | Result |
|-------|--------|
| Commit created | NO |
| Backup created | NO |
| Official folders modified | NO |
| Source notes modified | NO |
| Remote created | NO |
| Push performed | NO |
| Secrets written | NO |
| Commit button exists | NO |
| Backup button exists | NO |

## Non-Negotiables Preserved

- No auto-commit — snapshot command shown as suggestion only
- No auto-backup — no backup button exists
- No push, no remote, no cloud sync
- No delete of drafts — original preserved
- No batch operations
- No secrets, no tokens, no .env
- Protected folders remain protected
- Snapshot only via `--dry-run` in UI; manual commit required

## Definition of Done

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Acceptance result has closure actions | PASS |
| 2 | Closure checklist can be generated from UI | PASS |
| 3 | Closure dry-run can be run from UI | PASS |
| 4 | Closure run can be run from UI | PASS |
| 5 | Snapshot dry-run can be run from UI | PASS |
| 6 | No commit button exists | PASS |
| 7 | No backup button exists | PASS |
| 8 | No push/remote/cloud behavior exists | PASS |
| 9 | Smoke passes (18/18) | PASS |
| 10 | Build passes | PASS |

## What William Can Do Now

```
review → plan → confirm → accept → closure → snapshot recommendation
```

The full in-UI loop is closed. After accepting a draft, William sees exactly what changed, can generate a closure checklist, run closure to refresh queues and cockpit, preview what a snapshot would include, and get agent guidance on next steps — all without leaving the cockpit.
