# Accepted doctrine deviations — hermes-free-dev-agent **v2 owned-worktree mode**

**Date:** 2026-08-17
**Doctrine:** [`WO-WILLIAMOS-HERMES-KERNEL-V1.md`](WO-WILLIAMOS-HERMES-KERNEL-V1.md) §4, §5
**Raised by:** P3 Tier 1 independent review, condition **C5** — ref `review-2026-08-17-t1-indep-opus5`
([record](../reports/hermes-kernel-p3-independent-review-2026-08-17.md))
**Status:** accepted **for the pilot lane**, with the follow-up work orders named below.
**Scope:** these deviations describe v2 owned-worktree mode only. They do **not** authorise
activation of the lane, which remains a separate owner decision.

Recorded because an unrecorded deviation silently turns doctrine into dead letter. Until now the
justification for §4 existed only as prose inside a spec's "why that is defensible" note, and the §5
deviation was not written down anywhere at all — the promotion packet raised only §4.

---

## D1 — §4: edits do not go through SEA

**Doctrine (§4:54-57):** disable the kernel's **native file-edit toolset** and route edits through
SEA (model emits structured JSON → deterministic apply → verify → rollback). *"Acceptance: a worker
edit lands only via SEA; an invalid edit rolls back with no partial write."*

**Actual:** v2 uses the kernel's native `file` toolset. No SEA, no structured-edit adapter.

**Why accepted for this lane.** The reviewer's finding, which I accept: SEA is **not** a containment
precondition, on the WO's own reasoning. §3 states that in-process hooks *"are not a boundary… the OS
boundary (§5) is the control."* SEA sits in that same in-process layer. Containment here is Docker
plus host-side re-derivation of changed paths, and `terminal` is in `execution.allowedToolsets`
regardless — so disabling the `file` toolset would not actually remove free-form editing. Requiring
SEA as a *containment* gate would be theatre.

**What is NOT compensated — state plainly.** §4's acceptance criterion is about *reliability*, not
containment: atomic apply, verify, and rollback with no partial write, motivated by small local
models emitting literal diff markers or hallucinated paths. Re-deriving changed paths from git tells
you **which** files moved. It does not validate an edit, does not apply atomically, and does not roll
back a partial write. A botched edit becomes a dirty worktree that fails validation and enters the
remediation loop. That is an acceptable outcome, but it is a **different claim** from "§4 is
compensated," and earlier wording in the S2 spec implied the stronger claim.

**Follow-up:** `WO-WILLIAMOS-HERMES-KERNEL-SEA-001` — introduce the SEA edit path and re-assert §4's
acceptance criterion. Not a blocker for pilot operation; **is** a precondition for any future claim
that §4 is satisfied rather than deviated from.

---

## D2 — §5: two writable host mounts, and the runtime is not disposable

**Doctrine (§5:65,67):** *"Filesystem: no host mounts; workspace-only writes"* and *"Process: run
under a disposable/contained runtime."*

**Actual:** v2 deviates twice.
1. `/workspace` is the orchestrator's **live owned worktree**, mounted rw — not a disposable clone of
   a pinned baseline (v1's `BASELINE_CLONE`). Kernel writes survive the run by design.
2. A **second writable host mount** carries per-thread kernel state:
   `<runtime root>\hermes-kernel\threads\<threadId>\kernel-state` → `/opt/data`, via the `agent-owned`
   compose service (P2b). v1 kept `/opt/data` on tmpfs, so state died with the container.

**Why accepted for this lane.**
- The container itself remains contained and one-shot: `read_only: true`, `cap_drop: ALL` with five
  explicit `cap_add`, `no-new-privileges`, `pids_limit`, `mem_limit`, `cpus`, internal-only network
  with a single inference-proxy peer. The reviewer diffed `agent` against `agent-owned` and confirmed
  they are identical in **every** containment property; the only deltas are the added state bind and
  removal of the now-redundant tmpfs.
- Confinement of the live worktree is evidenced (`OWNED_WORKTREE_CONFINEMENT_PROVEN =
  p2-b9fbca28-…`) and enforced by layered, conjunctive walls from two independent sources of truth
  (client root vs policy `allowedWorkspaceRoots`), plus canonical-checkout refusal, symlink/reparse
  checks, a pre/post `git-common-dir` identity check, and a post-turn recursive sweep.
- The state mount's blast radius is bounded by `runtime-hermes-agent/config.yaml`, which disables
  skills, code execution, delegation, web, browser, messaging, cron, memory and plugins. **That
  mitigation is load-bearing and was not stated in the promotion argument.** It is now pinned: the
  deployed `config.yaml` digest is enforced at run time (C6,
  `containment.deployedArtifactSha256` + `HERMES_FREE_AGENT_DEPLOYED_ARTIFACT_WALL`).

**What remains true and uncomfortable.** Persisted kernel state means model-authored text survives the
container and re-enters the next turn's context without review — a trust surface, not just disk. WO §2
classifies kernel memory/skills as review-gated and never auto-adopted. Bounded today by the disabled
toolsets above and by threads never crossing outcomes; **not** bounded by any retention or review rule.

**Partly addressed 2026-08-17 (P3 condition C8).** Retention now exists and is enforced:
`containment.threadStateRetention` (`maxThreads: 20`, `maxAgeHours: 168`), pruned by `startThread`,
never touching the thread being started and only uuid-shaped leaves inside the runtime's own threads
root. A missing budget falls back conservatively rather than walling, because retention is
housekeeping over already-contained state, not a containment control.

**Follow-up (still open):** `WO-WILLIAMOS-HERMES-KERNEL-STATE-RETENTION-001` — retention bounds how
long model-authored state survives; it does **not** answer *what may accumulate in kernel state and
who reviews it*, which is the WO §2 requirement (kernel memory review-gated, never auto-adopted).
That question remains open.

---

## Standing conditions on both deviations

- Neither deviation is a precedent for other lanes. v1 `BASELINE_CLONE` mode is unchanged and remains
  the default for the pilot lane.
- Any change to the deployed `compose.yaml`, `config.yaml` or `run_agent.py` now requires a reviewed
  policy change in the same commit (the digests sit under `containment`, which
  `tests/hermes-free-dev-agent-provider.test.ts` deep-equals).
- If either follow-up WO lands, this record must be updated rather than deleted, so the history of
  what was deviated from and when stays legible.
