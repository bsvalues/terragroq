---
type: work-order-report
work_order: WO-034
title: Control Center Review Workbench
status: complete
date: 2026-06-16
---

# WO-034 — Control Center Review Workbench

## Objective

Make the Review tab actionable: William can see actual drafts, read them, generate acceptance plans, and get agent help — all from the cockpit. No auto-acceptance.

## What Changed

### Backend — 4 new API endpoints

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/api/review/items` | GET | Lists all draft items across 5 queues with title, type, area, created date, checklist progress |
| `/api/review/item?path=<path>` | GET | Reads a single draft: parsed frontmatter, sections, checklist, full content |
| `/api/acceptance/plan` | POST | Generates an acceptance plan: incomplete checklist items, placeholder sections, steps to accept, warnings about duplicates, target folder |
| `/api/agent/review-draft` | POST | Agent reviews a draft: quality checks (title, content, evidence), concerns, recommendation |

### Backend — state_reader.py additions

- `DRAFT_FOLDERS` — module-level constant mapping queue names to filesystem paths
- `TARGET_FOLDERS` — maps draft types to their official destination folders
- `PROTECTED_FOLDERS` — set of folders that must never be accessed through review endpoints
- `validate_review_path()` — safety gate: blocks path traversal, non-WilliamOS paths, protected folders, non-draft-folder paths, missing files
- `get_review_items()` — scans all draft folders, parses frontmatter, extracts titles and checklist counts
- `get_review_item()` — full detail read with sections, checklist parsing
- `generate_acceptance_plan()` — rule-based plan with steps, warnings, readiness check
- `_parse_frontmatter()` — simple YAML frontmatter parser (no pyyaml dependency)
- `_posix()` — Windows path normalization helper

### Backend — agent.py addition

- `review_draft()` — deterministic quality analysis: title quality, content completeness (placeholder detection), evidence presence, checklist status, concerns list, recommendation

### Frontend — Review Workbench (complete rewrite of ReviewTab)

**List view:**
- Queue filter chips with counts (All, Doctrine, Decisions, Concepts, Projects, Work Orders)
- Clickable draft cards showing title, queue badge, created date, area, checklist progress
- Hover states, empty states

**Detail view:**
- Back navigation
- Header card with queue badge, area, date, checklist counter
- Review checklist with check/empty-circle indicators
- Draft content sections with placeholder detection (italicized, left-bordered)
- Two action buttons: "Generate Acceptance Plan" and "Ask Agent to Review"
- Acceptance Plan card: steps to complete, warnings, target folder, ready/not-ready indicator
- Agent Review card: quality checks with status dots, concerns, recommendation
- Raw markdown toggle at bottom

### Frontend — api.ts additions

- `reviewItems()`, `reviewItem(path)`, `acceptancePlan(path)`, `agentReviewDraft(path)`

### Smoke suite expanded: 8 → 10 checks

- Check 9: `review_items` — verifies `/api/review/items` returns items + total
- Check 10: `path_safety` — verifies `/api/acceptance/plan` rejects protected folder paths

### Updated governance docs

- `SMOKE_TESTS.md` — updated to 10-point reference
- `PACKAGE_MANIFEST.md` — updated state_reader description, smoke count

## Safety Verification

| Check | Result |
|-------|--------|
| Path traversal (`../`) | REJECTED |
| Protected folder (`03_Doctrine/`) | REJECTED |
| Non-WilliamOS path | REJECTED |
| Non-draft-folder path | REJECTED |
| Missing file | REJECTED |
| Valid draft path | ALLOWED |
| No files modified by review endpoints | CONFIRMED |
| No auto-acceptance | CONFIRMED |
| No batch acceptance | CONFIRMED |
| Smoke suite | 10/10 PASS |
| TypeScript compilation | CLEAN |
| Frontend build | 178KB bundle |

## Files Modified

- `control-center/backend/state_reader.py` — review workbench functions + path validation
- `control-center/backend/agent.py` — review_draft analysis function
- `control-center/backend/app.py` — 4 new endpoints + ReviewPathRequest model
- `control-center/frontend/src/api.ts` — 4 new API calls
- `control-center/frontend/src/App.tsx` — Review Workbench (complete ReviewTab rewrite)
- `control-center/frontend/dist/` — rebuilt production bundle
- `scripts/williamos_control_center.py` — 2 new smoke checks
- `WilliamOS/110_ControlCenter/SMOKE_TESTS.md` — updated to 10-point reference
- `PACKAGE_MANIFEST.md` — updated descriptions

## What William Can Do Now

1. Open the cockpit → click Review tab
2. See all pending drafts across every queue with filter chips
3. Click a draft → read the full content, see what's placeholder vs. filled
4. See the review checklist with done/not-done indicators
5. Click "Generate Acceptance Plan" → see exactly what needs to happen before acceptance
6. Click "Ask Agent to Review" → get a structured quality assessment
7. Decide what to do: go fill in the draft in Obsidian, or leave it for later

## What William Cannot Do (by design)

- Accept a draft from the cockpit (no accept button exists)
- Auto-accept or batch-accept anything
- Access protected official folders through the review endpoints
- Modify any file through the review workbench (read-only)
