# CO-PILOT BUILD LEDGER — live task tracker

Updated each loop pass. Status: ✅ done · 🔧 in progress · ⬜ pending · ❌ blocked

## Phase 1 — Brain + Chat
| Task | Status | Notes |
|------|--------|-------|
| T1 Dev tooling + Ollama setup | ✅ | 42a9460; models pulled (qwen2.5:7b 4.7GB + nomic-embed) |
| T2 llm.py (Ollama client) | ✅ | 55ce185, 7 tests |
| T3 tools.py (catalog + gated runner) | ✅ | d49f2e7+10428a7, full review, 11 tests, catalog=91 |
| T4 memory.py (sqlite) | ✅ | 80f4971, 9 tests |
| T5 loop.py (agent loop) | ✅ | ed94184+ab87aa8, full review, 5 tests (deny-path tested) |
| T6 app.py routes (/api/chat SSE) | ✅ | ba0892f, 34 tests, no regressions |
| T7 frontend chat pane + approval | ✅ | 6316d3b, build clean; +d7cda50 dev-port fix |
| T8 integration + gate 9/9 | ✅ | LIVE SMOKE PASSED on 14B; 38 tests, FE build, cc-smoke 18/18, prod 9/9 |

### Phase 1 LIVE conversational smoke — PASSED (2026-06-19)
- Model: **qwen2.5:14b-instruct-q4_K_M** (now default; 7B mis-routed twice → upgraded for reliability)
- "what is my backup status?" → routed to `backup-status` (single call), plain-English summary of real state ✓
- "snapshot now" → routed to `snapshot`, loop PAUSED with approval event, no execution ✓
- Denied approval → snapshot never ran, git HEAD unchanged (no commit) ✓
- Approve path: unit-tested (resume confirmed=True) + shares verified resume() path; live-skip to avoid stray commit
- Fixes during closure: llm.py 5s→300s timeout; stronger routing/summary prompt; loop repeat-guard + non-empty-final; 14B default

### Phase 1 integration findings fixed
- `779a120` — SQLite Memory thread-safety (FastAPI worker threads)
- `20a4b77` — agent loop yields clean error event on LLM backend failure
- `c72c678`/`acd9a61` — copilot-health added to smoke as INFORMATIONAL; production gate decoupled from optional model (binary PASS/FAIL), stays 9/9 PASS when Ollama offline
- **Environmental:** Ollama install was corrupted (missing `llama-server.exe`); reinstalled 0.30.10; models being re-pulled

## Phase 2 — Briefing + Watchdog ✅ COMPLETE (gate green)
| Task | Status | Notes |
|------|--------|-------|
| P2-T1 briefing.py: build_briefing() + watch() | ✅ | aaa6883, 37 tests (verified) |
| P2-T2 routes GET /api/briefing + /api/alerts | ✅ | 755005c, 78 tests |
| P2-T3 UI BriefingCard + AlertList | ✅ | a933825, build clean |
| P2-T4 gate | ✅ | 78 tests, cc-smoke 18/18, production-readiness 9/9 |
## Phase 3 — Capture + Memory ✅ COMPLETE (gate green + live memory smoke passed)
| Task | Status | Notes |
|------|--------|-------|
| P3-T1 `remember` tool → durable facts (loop + tools) | ✅ | 2a8f31d, 92 tools (verified; recovered from worktree) |
| P3-T2 session list/get API + memory.list_sessions | ✅ | 7cf3daf + rowid-ordering fix |
| P3-T3 UI: session resume + quick-capture box | ✅ | 3a43464, build clean |
| P3-T4 gate + LIVE memory smoke | ✅ | 95 tests, cc-smoke 18/18, prod 9/9 |

### Phase 3 LIVE memory smoke — PASSED (2026-06-19)
- "Remember my favorite project is TerraFusion" → model called `remember` tool, fact persisted to copilot.db ✓
- NEW session "what is my favorite project?" → "Your favorite project is TerraFusion." ✓ (cross-session recall)
- BUG found+fixed live (8f4b734): facts as system messages were IGNORED when the 92-tool catalog was present; fix folds facts into the user turn → model now uses memory reliably with tools.
## Phase 4 — Vault RAG ✅ COMPLETE (gate green + live RAG smoke grounded)
| Task | Status | Notes |
|------|--------|-------|
| P4-T1 retrieval.py + copilot-index | ✅ | 37b244b, 117 tests, LIVE retrieval verified (trust.md score 0.75) |
| P4-T2 wire retrieval into loop context | ✅ ee1535c, 122 tests | inject top-k note excerpts+paths |
| P4-T3 citations in answers + UI | ✅ d721df5, build clean |
| P4-T4 gate + LIVE RAG smoke | ✅ | 122 tests, cc-smoke 18/18, prod 9/9; live smoke grounded+cited |
## Phase 5 — Polish (desktop + voice stretch) 🔧

### Phase 5A — No-Slop Operator Shell ✅ COMPLETE (accepted 2026-06-23)
- Operator shell implemented as a serious control center over the existing engine: runtime status strip, command pane, review-required surface, evidence rail, memory/history, briefing/alerts, and model online/offline state.
- Deterministic gate: PASS — frontend build previously green, control-center-smoke 18/18, runtime-smoke 28/28, production-readiness 9/9.
- Live model gate: PASS after restoring Ollama server readiness. `qwen2.5:14b-instruct-q4_K_M` and `nomic-embed-text` visible in `/api/tags`; no downgrade used.
- Live governance loop: "what is my backup status?" routed to `backup-status`, streamed visibly, and rendered full backup evidence. "snapshot now" showed Review Required before execution; denial left git HEAD unchanged and finalized with no execution.
- Acceptance fix: added narrow backend direct-intent guards for `backup-status` and `snapshot` so the 92-tool catalog cannot turn a status check into a write operation.
- Routing-shim boundary: deterministic guards are allowed only for critical canonical commands with proven repeated model misroutes, and must still pass through `safety.check_command` / approval gates. Do not grow this into a broad phrase-router or a second hidden command system.
- Screenshots captured: desktop and mobile shell render with briefing, evidence, history, and command surfaces intact.

### Phase 5B — Launcher Runtime ✅ COMPLETE (accepted 2026-06-24)
- Launcher/runtime hardening completed without UI redesign, new autonomy, new routing guards, or Research Drop Zone scope.
- One-command launch verified with `control-center --no-open`; existing healthy server detection adopts port 8420 ownership instead of starting duplicates.
- Stop/restart hardened: stale runtime state handled, unknown port owners are not killed automatically, `control-center-restart --no-open` added as an explicit CLI command.
- Status output now reports backend/frontend/build state, server PID/ownership, runtime mode/start time, local model online/offline detail, and Ollama model inventory.
- Safety model preserved: read-only Control Center status/smoke are safe; launch/stop/restart/build are confirmation-gated if invoked through the governed command runner.
- Phase 5B completed launcher/runtime hardening. It did not implement native Tauri/tray packaging. Native Tauri/PWA/Docker packaging remains a future production-hardening track and is not required for v1.3.0.
- Phase 5A live loop re-verified after launcher changes: `backup-status` streamed and rendered evidence; `snapshot` showed Review Required before execution; denial prevented execution.
- Gates: control-center-smoke 18/18 PASS; runtime-smoke 28/28 PASS, 0 critical; production-readiness 9/9 PASS; command registry reconciled at 92/92.
- Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.

### Phase 5C — Research Drop Zone ✅ COMPLETE (accepted 2026-06-24)
- Implemented as an intake pipeline, not an autonomous research agent: drag/drop or file-select on Operator Home, controlled original storage, extracted markdown note, metadata JSON, recent history, and Evidence rail visibility.
- Supported intake: PDF, text, markdown, CSV, HTML, and common image files. Unsupported files fail with a clear operator message and are not copied.
- Metadata recorded per file: source filename, SHA-256 hash, size, type, content type, timestamp, classification, original path, note path, search index result, and RAG index result.
- Duplicate handling verified by hash: repeat upload returns the existing intake item and does not create a second original or note.
- Authority boundary encoded in every generated note: `authority: unreviewed`, `canon: false`, and an intake-only notice. Promotion to canon remains a separate reviewed action.
- Indexing verified: extracted notes are written under `WilliamOS/07_Learning/Research Intake`, semantic search finds the note, and the copilot RAG index cites the extracted note path.
- Live acceptance file: `phase5c-research-marker.txt` created an original copy, normalized note, history entry, Evidence rail entry, semantic-search result, and RAG-cited chat answer with visible token streaming.
- Screenshots captured: desktop and mobile Operator Home render with Drop Research, Evidence, and History surfaces intact.
- Gates: npm build PASS; backend tests 136/136 PASS; control-center-smoke 18/18 PASS; runtime-smoke 28/28 PASS, 0 critical; production-readiness 9/9 PASS.
- Boundaries held: no cloud upload, no new autonomy, no broad routing guard, no Phase 6 proactive synthesis.

### Phase 5D — Agent Dock / External Worker Registry ✅ COMPLETE
- Goal: allow WilliamOS to discover, register, and safely delegate bounded tasks to optional workers such as Claude Code, Codex, Hermes, or local agents without making them authority.
- Control model: WilliamOS remains the command center, dispatcher, approval gate, and evidence/history system. External workers may propose work; WilliamOS verifies, gates, records, and controls any write/commit/promotion.
- User-facing surface: `Workers` / `Agent Dock`, not a multi-agent autonomy surface. Show worker name, type, status, allowed scope, approval requirement, last run, last output, logs, and enable/disable state.
- Registry shape: worker id/label/kind/mode, availability check, allowed tasks, default permission, scope policy, blocked secret paths, and required evidence fields.
- Required flow: Bill asks WilliamOS -> WilliamOS classifies task -> WilliamOS suggests eligible worker and scope -> Bill approves delegation -> worker returns output/evidence -> WilliamOS displays diff/output -> Bill approves any write/commit/promote step.
- Worker categories: local model workers, code workers, research workers, and ops workers. Research workers must flow through Research Drop Zone/evidence; code workers may propose patches but cannot directly commit.
- Deliverables: worker registry file, availability checks, worker status API, Operator Shell Workers panel, delegation approval event, worker output/evidence capture, and no automatic write/commit/promotion.
- Non-goals: no always-on autonomous external agents, no cloud dependency for core WilliamOS, no bypass of `safety.check_command`, no direct commit by external worker, no automatic canon promotion, no broad internet research agent, no secrets exposure, no hidden background work.
- Acceptance: unavailable workers fail cleanly; available workers report status; delegation requires explicit approval; scope and permission boundary are visible; evidence is recorded; tests/gates remain green.
- Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.

#### Phase 5D-1 — Worker Registry + Availability Status ✅ COMPLETE (accepted 2026-06-24)
- Discovery complete: Claude Code, Codex, Hermes, Ollama, and WilliamOS local command surfaces are visible to the registry.
- Registry file added with worker kind/mode, availability check, allowed tasks, delegation policy, scope policy, blocked secret paths, and required evidence fields.
- Claude Code, Codex, and Hermes are registered as disabled-by-default external workers with `confirm_required`, `proposal_only`, no write, no commit, no promotion, and required evidence.
- Ollama is registered separately as `local_model_runtime`, not as a delegatable worker. Install health and service reachability are reported separately.
- WilliamOS is registered as the `control_plane`; external workers are not authority.
- Read-only `/api/workers/status` reports all worker states. No worker task execution endpoint was added.
- Operator Home now shows a read-only Workers panel. No delegate/run controls exist.
- Live status: Claude Code available, Codex available, Hermes available, Ollama installed but service offline, WilliamOS available, delegatable workers = 0.
- Gates: npm build PASS; backend tests 141/141 PASS; control-center-smoke 18/18 PASS; runtime-smoke 28/28 PASS, 0 critical; production-readiness 9/9 PASS.
- Boundaries held: no delegation execution, no external worker writes, no proactive behavior, no Phase 6 behavior.

#### Phase 5D-2 — Delegation Approval Event ✅ COMPLETE (accepted 2026-06-24)
- Added a paper-gate delegation request shape: worker, task, scope, authority, write/commit/promotion restrictions, reason, approve label, deny label, execution state, and created timestamp.
- Added backend validation for delegation review events: disabled workers cannot be selected, unavailable workers cannot be selected, and only available + enabled proposal-only external workers can produce a review event.
- Added approval/denial decision recording. Deny records `denied_no_delegation`; approve records `approved_intent_recorded`.
- Evidence/history records the decision with empty `commands_run`, empty `files_touched`, empty patch/log fields, and `executed: false`.
- Added Operator Home paper-gate UI under Workers. Current real external workers are disabled, so the UI correctly blocks review preparation.
- Live disabled-worker check: Claude Code request returned `delegation_not_allowed`; pending/history remained empty.
- Unit acceptance covers enabled-worker review event creation and approve/deny paths without using the real disabled registry.
- Gates: npm build PASS; backend tests 149/149 PASS; control-center-smoke 18/18 PASS; runtime-smoke 28/28 PASS, 0 critical; production-readiness 9/9 PASS.
- Boundaries held: no external worker process executes, no writes, no commits, no promotions, no proactive behavior, no Phase 6 behavior.

#### Phase 5D-3 — Proposal-Only Worker Execution + Evidence Capture ✅ COMPLETE (accepted 2026-06-24)
- Added a separate proposal execution lane after delegation approval. Approval intent does not execute by itself; `run_proposal` is a distinct action.
- External workers remain proposal-only: no write, no patch apply, no commit, no promotion, and no canon mutation endpoint was added.
- Disabled workers cannot execute, unavailable workers cannot execute, unsafe worker policies are rejected, and unconfigured real workers fail cleanly without starting a process.
- Proposal evidence captures command preview, stdout, stderr, return code, timeout state, summary, files touched, patch/diff text, test results, logs, and before/after git status.
- Git status is checked before and after proposal execution. Any repo mutation is recorded as `proposal_boundary_violation_git_changed`, not accepted as a clean proposal run.
- Cancel behavior exists for approved-but-not-run proposal requests. Timeout/failure paths record evidence cleanly.
- Operator Home now shows proposal command preview, run/cancel controls only for approved pending proposals, and the latest worker run status with git-unchanged proof.
- Real Claude Code, Codex, and Hermes registry entries remain disabled by default and proposal execution config remains disabled until an operator explicitly configures the CLI invocation.
- Unit acceptance uses a synthetic enabled proposal worker to prove execution/evidence behavior without enabling real external worker authority.
- Gates: npm build PASS; backend tests 158/158 PASS; control-center-smoke 18/18 PASS; runtime-smoke 28/28 PASS, 0 critical; production-readiness 9/9 PASS.
- Boundaries held: no direct external writes, no patch apply, no commit endpoint, no promotion endpoint, no proactive delegation, no Phase 6 behavior.

---
## EXTENDED ROADMAP — "push further" (beyond the original 5-phase plan, 2026-06-19)
Goal: from a reactive assistant to a true proactive "second me / second brain."

### Phase 4.5 — Response streaming ✅ COMPLETE (e4e4acc; live: 44 token events, 126 tests)
- Stream model tokens to the chat UI (SSE token events already scaffolded) so the 14B (~57s/turn) FEELS responsive. Biggest perceived-quality win. Do alongside/after Phase 4.

### Phase 6 — Proactive Intelligence ⬜ EXPANSION GATE — intentionally blocked
- The co-pilot INITIATES: model-narrated morning briefing, "what changed since yesterday," cross-note connections surfaced unprompted, watchdog alerts phrased in plain English. Wire existing agent.explain_* + 60_Synthesis + 88_CortexMap into proactive pushes.
- This is not a production gap. WilliamOS v1.3.0 is production-stable without Phase 6. Phase 6 is an optional expansion gate requiring explicit operator authorization.

### Phase 7 — Routines / multi-step autonomy ⬜
- Named routines the model orchestrates as a sequence with tiered approvals: e.g. "morning" = daily-review + process-inbox + briefing; "wrap up" = synth + snapshot. Builds on the agent loop + safety tiers.

### Phase 8 — Adaptive learning ⬜
- Auto-propose facts to remember from conversation ("want me to remember that?"), adapt verbosity/tone to learned preferences, track accepted vs ignored suggestions.

### Phase 9 — "Ask my whole brain" (deep synthesis) ⬜
- Multi-note RAG + synthesis for reasoning questions across the whole vault (not just top-k lookup): "what's my thinking on X across everything I've written?" with citations.

## Gate status (re-check each phase boundary)
- [x] Phase 1: COMPLETE — live conversational smoke PASSED on 14B (route+answer+approval-pause+deny verified); 38 backend tests, cc-smoke 18/18, production-readiness 9/9. Commit f76936a.
- [x] Phase 2 gate: COMPLETE — Briefing + Watchdog accepted; 78 tests, control-center-smoke 18/18, production-readiness 9/9.
- [x] Phase 3 gate: COMPLETE — Capture + Memory accepted; live memory smoke passed; 95 tests, control-center-smoke 18/18, production-readiness 9/9.
- [x] Phase 4 gate: COMPLETE — Vault RAG accepted; live grounded/cited smoke passed; 122 tests, control-center-smoke 18/18, production-readiness 9/9.
- [x] Phase 5A gate: COMPLETE — no-slop Operator Shell accepted live on 14B; cc-smoke 18/18, runtime-smoke 28/28, production-readiness 9/9.
- [x] Phase 5B gate: COMPLETE — launcher/runtime accepted; cc-smoke 18/18, runtime-smoke 28/28, production-readiness 9/9.
- [x] Phase 5C gate: COMPLETE — Research Drop Zone intake accepted; search/RAG indexing verified; cc-smoke 18/18, runtime-smoke 28/28, production-readiness 9/9.
- [x] Phase 5D gate: COMPLETE — Worker Registry + Availability Status, Delegation Approval Event, and Proposal-Only Execution + Evidence Capture accepted; Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.
- [x] v1.3.0 release governance: TAGGED at 2c44ff2; Phase 6 remains an intentionally blocked expansion gate; WilliamOS v1.3.0 is the stable local operator baseline.

## Loop log
- 2026-06-19: spec + Work Order written and committed. Goal set. Loop starting at Phase 1 / T1.
- 2026-06-23: Phase 5A Operator Shell accepted after Ollama server restart and narrow live-route guard; Phase 5B launcher runtime remained pending; Phase 6 remained an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5B launcher/runtime accepted; Research Drop Zone remained Phase 5C pending; Phase 6 remained an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5C Research Drop Zone accepted as a bounded intake pipeline; Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5D Agent Dock / External Worker Registry added as next candidate infrastructure phase; Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5D-1 Worker Registry + Availability Status accepted; no delegation execution added; Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5D-2 Delegation Approval Event accepted as approval-intent only; no external worker execution added; Phase 6 remains an intentionally blocked expansion gate pending explicit operator authorization.
- 2026-06-24: Phase 5D-3 Proposal-Only Worker Execution + Evidence Capture accepted; external workers can only produce proposals after approval, and writes/commits/promotions remain blocked.
- 2026-06-24: v1.3.0 release governance validated baseline 93c0ac5 with full gates green; release notes drafted; tag decision recorded as HOLD until a clean-tree release window.
- 2026-06-24: v1.3.0 tagged at 2c44ff2 after clean-tree final tag gate; Phase 6 remains an intentionally blocked expansion gate; WilliamOS v1.3.0 is the stable local operator baseline.
