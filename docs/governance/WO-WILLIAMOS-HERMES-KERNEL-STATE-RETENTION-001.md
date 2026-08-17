# WO-WILLIAMOS-HERMES-KERNEL-STATE-RETENTION-001 — govern what accumulates in kernel state

**Status:** OPEN · **Raised:** 2026-08-17 · **Source:** P3 independent review
(`review-2026-08-17-t1-indep-opus5`), condition C8 and weaknesses W3/W4
**Deviation record:** [`hermes-kernel-v2-doctrine-deviations-2026-08-17.md`](hermes-kernel-v2-doctrine-deviations-2026-08-17.md) (D2)
**Doctrine:** [`WO-WILLIAMOS-HERMES-KERNEL-V1.md`](WO-WILLIAMOS-HERMES-KERNEL-V1.md) §2

## Already done (do not redo)

`containment.threadStateRetention` (`maxThreads: 20`, `maxAgeHours: 168`), pruned by `startThread`.
The prune removes **only `kernel-state/`** — the persisted model-authored memory — and keeps
`session.json` and `turns/`, because the orchestrator's ledger retains only `turnResultDigest` and
deleting the thread dir would leave those digests attesting to bytes that exist nowhere. A missing or
malformed budget falls back rather than walls: retention is housekeeping over already-contained
state, not a containment control.

## What remains open

1. **Who reviews what accumulates.** WO §2 classifies kernel memory and skills as a code-execution
   trust surface that is *review-gated and never auto-adopted*. P2b proved the opposite property is
   live: a tool-free second turn recalled the first turn's content from host-persisted `state.db`, so
   model-authored text re-enters context **unreviewed**. Retention bounds how long that survives. It
   does not decide what may accumulate, or who inspects it. Bounded today only by
   `runtime-hermes-agent/config.yaml` disabling skills/code-execution/memory/plugins — now
   digest-pinned, but a *mitigation*, not a review rule.
2. **W4 — retention can terminalize an owner-decision resume.** The prune is age/count based with no
   knowledge of live leases. An outcome parked awaiting an owner decision for longer than
   `maxAgeHours` (168h = 7 days) loses its `kernel-state/`; `resumeThread` then walls
   `RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE`, and the owner-decision path in `orchestrator.mjs`
   raises `HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL` — **terminal**, rather than falling back to a
   fresh thread the way the non-owner-decision path does. Seven days is inside the plausible range
   for an owner decision. Availability foot-gun, not a containment issue.
   **Fix:** exclude threads referenced by live checkpoints from the prune, or make the owner-decision
   resume path degrade to a fresh thread. Until then the runbook records that the budget must exceed
   the owner-decision SLA.
3. **Evidence retention proper.** `turns/` now grows unbounded (packets + sanitised stdout). That is
   deliberate for audit, but it is a policy question nobody has answered.

## Do not

Do not widen `maxAgeHours` to keep evidence — the prune no longer deletes evidence. Do not make the
missing-budget fallback a wall; see the deviation record for why.
