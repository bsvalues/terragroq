# GOAL — WilliamOS Co-Pilot ("Second Brain") Build

**Set:** 2026-06-19 · **Mode:** autonomous self-paced loop + subagent-driven execution
**Spec:** [docs/superpowers/specs/2026-06-19-williamos-copilot-design.md](docs/superpowers/specs/2026-06-19-williamos-copilot-design.md)
**Work Order:** [docs/superpowers/plans/2026-06-19-williamos-copilot.md](docs/superpowers/plans/2026-06-19-williamos-copilot.md)

## North star

Turn the 91-command CLI into a local-first conversational co-pilot — a "second me /
second brain." Talk to it in plain English; it routes to the proven WilliamOS
commands (tiered safety), briefs proactively, and answers grounded in your own notes.
Local LLM (Ollama), no cloud, no API keys, no per-use cost.

## Definition of done (loop stops only when ALL true)

1. **Phase 1 (Brain + chat)** complete: `/api/chat` agent loop runs tools via the
   safety tiers; chat UI streams; "snapshot now" triggers an approval prompt. All Task-1..8 boxes checked.
2. **Phase 2 (Briefing + watchdog)** complete and usable.
3. **Phase 3 (Capture + memory)** complete and usable.
4. **Phase 4 (Vault RAG)** complete: answers cite real notes.
5. **Phase 5 (Polish)** complete: launches to desktop/tray (voice = stretch, may defer with a logged note).
6. After EVERY phase: `runtime-smoke` 0 critical AND `production-readiness` **9/9 PASS**.
7. All new Python units have passing tests (pytest green, Ollama mocked).
8. Each phase committed; final v1.3.0 considered via release governance.

## Hard rules (never violate to "make it pass")

- Every command execution goes through `safety.check_command` → `command_runner`. No direct shell-out to `william.py` from new code.
- Local-only bind `127.0.0.1`. No cloud LLM, no auth server.
- Don't weaken a gate to make it green; fix the real gap.
- Don't auto-approve governance-gated human review/promotion as a side effect.

## Execution method

- Subagent-driven (superpowers:subagent-driven-development): fresh subagent per task,
  two-stage review between tasks, TDD per the Work Order.
- Self-paced `/loop`: each iteration advances the next unchecked task/phase, updates
  the ledger, and re-arms until done-criteria met. Nothing skipped.
- Build on `master` with snapshot-based rollback (no remote; governance snapshots are the safety net).

## Extended scope ("push further", 2026-06-19)

Beyond the original 5 phases, the build now targets a proactive "second me":
Phase 4.5 response streaming (UX), Phase 6 proactive intelligence, Phase 7 routines/
multi-step autonomy, Phase 8 adaptive learning, Phase 9 "ask my whole brain" deep
synthesis. Loop continues through all of these until the second-brain vision is realized.
Same discipline: TDD, independent verification of subagent claims, live model smoke for
model-facing features, 9/9 gate after each phase.

## Progress

See [COPILOT_BUILD_LEDGER.md](COPILOT_BUILD_LEDGER.md).

---
_Prior goal (Full Green Sweep, 2026-06-19) — COMPLETE; see SWEEP_LEDGER.md._
