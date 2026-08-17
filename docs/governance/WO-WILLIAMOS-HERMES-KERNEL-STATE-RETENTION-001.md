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
2. ~~**W4 — retention can terminalize an owner-decision resume.**~~ **FIXED 2026-08-17.**
   An outcome parked awaiting an owner decision does no turns while it waits, so its thread aged past
   `maxAgeHours`; deleting its `kernel-state/` made `resumeThread` wall, and the owner-decision path
   in `orchestrator.mjs` turns that specific failure into a **terminal**
   `HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL` rather than starting a fresh thread as the ordinary
   path does. A slow human decision destroyed the work.

   **Fixed in the prune, not the wall.** The wall is correct and deliberately fail-closed (S2 spec
   §1), so loosening it was the wrong lever. A thread that captured a kernel session and still has
   its state dir — precisely what `resumeThread` requires — is now **exempt from age expiry**.

   Of the two candidate fixes originally listed, "exclude threads referenced by live checkpoints" was
   **not implementable in the client**: `threadId` is written to the Postgres governance event, and
   the local state store's `metadata()` is a whitelist that excludes it, so there is no on-disk
   source of live thread ids (and `DATABASE_URL` is unset in any case). Resumability is the best
   available proxy and is the exact property the resume path tests.

   **What was traded:** the *time* bound on resumable state. `maxThreads` still applies to every
   thread, so volume stays bounded — which was the C8 requirement. Covered by two tests: the
   exemption itself, and that the count cap still evicts the oldest resumable thread.
3. **Evidence retention proper.** `turns/` now grows unbounded (packets + sanitised stdout). That is
   deliberate for audit, but it is a policy question nobody has answered.

## Do not

Do not widen `maxAgeHours` to keep evidence — the prune no longer deletes evidence. Do not make the
missing-budget fallback a wall; see the deviation record for why.
