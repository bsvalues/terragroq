---
type: governance
status: active
area: control-center
tags:
  - governance
  - control-center
  - smoke
---

# Control Center Smoke Tests

Run with:
```
william control-center-smoke
```

## What It Checks

| # | Check | What It Verifies |
|---|-------|-----------------|
| 1 | status | `/api/status` returns 200 |
| 2 | home | `/api/home` returns inbox_count |
| 3 | today | `/api/today` returns date |
| 4 | review_queues | `/api/review-queues` returns total |
| 5 | agent_next | `/api/agent/next` returns recommendation |
| 6 | safety | `/api/safety` returns status |
| 7 | unsafe_refusal | `/api/run` with `semantic-clear` is refused |
| 8 | frontend | Root URL returns 200 (built UI served) |
| 9 | review_items | `/api/review/items` returns items + total |
| 10 | path_safety | `/api/acceptance/plan` rejects protected folder paths |
| 11 | accept_wrong_confirm | `/api/acceptance/accept` rejects wrong confirmation text |
| 12 | accept_bad_dest | `/api/acceptance/accept` rejects invalid destination folder |
| 13 | accept_generic_refused | `/api/run` with `accept-draft` is forbidden |
| 14 | closure_checklist | `/api/closure/checklist` returns ok |
| 15 | closure_dry_run | `/api/closure/dry-run` returns ok |
| 16 | snapshot_dry_run | `/api/git/snapshot-dry-run` returns ok |
| 17 | agent_post_acceptance | `/api/agent/post-acceptance` returns guidance with steps |
| 18 | accept_traversal | `/api/acceptance/accept` rejects path traversal |
| 19 | devops_playbook | `/api/devops/playbook` exposes the operational playbook, first slices, mistake patterns, and handoff banner |
| 20 | devops_current_truth | `/api/devops/current-truth` confirms Phase 6 remains blocked and Current Truth exposes blocked actions |
| 21 | devops_goal_classifier | `/api/devops/goal` caps unsafe mutation authority, returns a draft WO, and flags Phase 6 drift |
| 22 | devops_loop_planner | `/api/devops/loop` returns a bounded non-executing verifier packet |

## Expected Output

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
  [PASS] devops_playbook: PASS
  [PASS] devops_current_truth: PASS
  [PASS] devops_goal_classifier: PASS
  [PASS] devops_loop_planner: PASS

  Smoke: PASS (22/22)
```

## Offline Smoke

If the server is not running, `control-center-smoke` falls back to running the backend's built-in smoke check (state reader + agent + safety, no HTTP).
