---
type: work-order-report
work_order: WO-035
title: Control Center Confirmed Acceptance Flow
status: complete
area: control-center
completed: 2026-06-17
---

# WO-035 — Control Center Confirmed Acceptance Flow

## Mission

Add a safe, one-item, human-confirmed, copy-by-default acceptance flow to the Control Center Review Workbench. User types ACCEPT, clicks the button, draft is copied to the official folder, log is written, queues refresh. Not auto-acceptance. Not batch.

## What Changed

### Backend (4 files)

| File | Change |
|------|--------|
| `control-center/backend/safety.py` | Moved `accept-draft` from `CONFIRM_REQUIRED` to `FORBIDDEN` — blocked through generic `/api/run` |
| `control-center/backend/command_runner.py` | Added `run_acceptance()` — dedicated function that bypasses safety gate to call CLI `accept-draft --confirm` |
| `control-center/backend/state_reader.py` | Added `validate_acceptance_dest()` — checks destination against `TARGET_FOLDERS` allowlist |
| `control-center/backend/app.py` | Added `AcceptRequest` model and `POST /api/acceptance/accept` endpoint with triple validation |

### Frontend (2 files)

| File | Change |
|------|--------|
| `control-center/frontend/src/api.ts` | Added `acceptDraft()` API call |
| `control-center/frontend/src/App.tsx` | Added acceptance confirmation panel, typed ACCEPT input, accept button with gate logic, result panel with official path display, queue auto-refresh on success |

### Smoke & Governance (2 files)

| File | Change |
|------|--------|
| `scripts/williamos_control_center.py` | Expanded smoke suite from 10 to 14 checks (acceptance safety) |
| `WilliamOS/110_ControlCenter/SMOKE_TESTS.md` | Updated reference table and expected output |

## Safety Architecture

```
User clicks Accept Draft
        │
        ▼
  ┌─ confirmation === "ACCEPT"? ──── No ──→ Rejected
  │     Yes
  ▼
  ┌─ draft path in allowed draft folder? ──── No ──→ Rejected
  │     Yes
  ▼
  ┌─ destination in TARGET_FOLDERS? ──── No ──→ Rejected
  │     Yes
  ▼
  ┌─ CLI accept-draft --confirm ──→ shutil.copy2 + log entry
  │
  ▼
  Result panel + queue refresh
```

### Triple validation on `POST /api/acceptance/accept`:
1. `confirmation` must be exactly `"ACCEPT"` (case-sensitive)
2. `draft_path` validated by `validate_review_path()` — must be in a recognized draft folder, no traversal, no protected folders
3. `dest` validated by `validate_acceptance_dest()` — must match a known `TARGET_FOLDERS` value, folder must exist

### Safety gate design:
- `accept-draft` is in `FORBIDDEN` — cannot be executed through generic `/api/run`
- Dedicated `run_acceptance()` in command_runner bypasses the gate — only reachable through the validated `/api/acceptance/accept` endpoint
- Copy, not move — original draft stays in place
- Append-only log written by CLI

## Frontend UX

### Confirmation panel (appears after plan generated + ready):
- Shows target folder path
- Text input: "Type ACCEPT to confirm"
- Accept button disabled until typed text equals `ACCEPT`
- Green accent when ready, "Accepting..." state during call
- Safety reminder: "One item. Human-confirmed. Copy, not move. Append-only log."

### Result panel:
- Success: green card, "Draft promoted to official folder", CLI output, paths, Copy Official Path button, Back to Drafts button
- Failure: red card with error message
- Queue auto-refreshes on successful acceptance

### Button gate logic:
- Accept button requires: draft selected + plan generated + plan ready + destination valid + confirmation text equals ACCEPT

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
  [PASS] accept_traversal: PASS

  Smoke: PASS (14/14)
```

## Non-Negotiables Preserved

- No automatic acceptance — typed ACCEPT required
- No batch acceptance — one item at a time
- No moving drafts — copy only (shutil.copy2)
- No rewriting official notes — append-only log
- No push, no remote, no cloud sync
- No secrets, no tokens, no .env
- Protected folders cannot be used as draft sources
- Path traversal blocked
- Invalid destinations rejected
- Generic run of accept-draft forbidden

## Definition of Done

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Accept button disabled until plan + ACCEPT typed | PASS |
| 2 | Backend triple-validates before calling CLI | PASS |
| 3 | Wrong confirmation rejected | PASS |
| 4 | Invalid destination rejected | PASS |
| 5 | Path traversal rejected | PASS |
| 6 | Protected folder rejected as draft source | PASS |
| 7 | Generic run of accept-draft forbidden | PASS |
| 8 | Result panel shows official path | PASS |
| 9 | Queue refreshes after acceptance | PASS |
| 10 | 14/14 smoke PASS | PASS |
| 11 | No new dependencies | PASS |
