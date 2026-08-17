# P3 — independent review result: hermes-free-dev-agent **v2 owned-worktree mode**

**Reference:** `review-2026-08-17-t1-indep-opus5`
**Verdict: `APPROVE_WITH_CONDITIONS`**
**Promotion NOT granted.** `promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED` remains
`null` and `promotion.status` remains `PILOT_AUTHORIZED` until the blocking conditions below are
closed. Requested by
[the P3 packet](hermes-kernel-p3-promotion-review-packet-2026-08-16.md); tier per
[`sovereign-runtime-and-review-supersession.md`](../governance/sovereign-runtime-and-review-supersession.md)
**Tier 1 — sovereign independent review** (a reviewer role in a separate isolated context; not the
builder, and not an external advisory service).

Role separation: S2/P2/P2b/P3 were built by Claude (2026-08-16). This review was performed in a
separate isolated reviewer context that did not build the lane, was instructed not to defer to the
builder, and modified no files.

## Summary

No demonstrated containment escape from the owned worktree was found in the current tree, and the
wall layering is real, conjunctive, and tested (54/54 across the three lane suites at review time).
`REJECT` would misstate the mode as unsound. A plain `APPROVE` was refused for two reasons
independent of the code: **the packet materially understates what this review unblocks**, and **the
builder's claim that the open minors were fixed was false for four of the five PRs cited**.

## Conditions

| # | Condition | Blocking | Status |
|---|---|---|---|
| C1 | Restate what promotion authorises: the runbook names this review as the activation gate, and merge review is bot-only | yes | **open** |
| C2 | Correct the false PR attribution for the "fixed minors" claim | yes (record) | **closed** (below) |
| C3 | `runTurn` does not bind the thread to the workspace, unlike `resumeThread` | yes | **closed** |
| C4 | Owned mode does not require `-QuarantinePath`, so the marker can land in the checkout | yes | **closed** |
| C5 | Record the T2 §4 **and §5** deviations as dated accepted deviations with a named follow-up WO | yes (record) | **open** |
| C6 | Pin or verify the three deployed host files the containment claim rests on | no | **open** |
| C7 | Neutralise the leftover `PROVISIONAL` probe policy on HERMES | no | **open** |
| C8 | Adopt a per-thread state retention rule and state the trust-surface argument | no | **open** |
| C9 | Make the inherited v1 review line's scope legible inside the policy file | no | **open** |

### C3 — closed
`runTurn` now rejects a thread belonging to another workspace with
`RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH`, matching `resumeThread`
(`scripts/hermes-bridge/hermes-kernel-client.mjs`). A thread owns the kernel session id and state dir
for one worktree; running a turn from a client pointed elsewhere would hand that session's memory to
the wrong tree. Regression test added in `tests/hermes-kernel-client.test.ts`, asserting the refusal
happens before the invoker runs. This was the same "asserted at connect/resume, absent where it is
used" shape as the turn-budget gap closed earlier.

### C4 — closed
`-QuarantinePath` is now mandatory when `placement.workspaceMode === "OWNED_WORKTREE"`
(`scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1`), raising
`HERMES_FREE_AGENT_QUARANTINE_PATH_WALL` when absent. Without it `$markerPath` stayed at the
policy-directory default (`config/execution-fabric/`), so an aborted run would write
`ACTIVE_CONTAINER=` into the version-controlled checkout — dirtying the repo and quarantining the
lane. The kernel client always passed it; the manual/runbook path did not. Note the behavioural
invoker test for this is host-gated (`it.runIf`), so it does not execute on a Linux runner.

### C2 — closed: correction to the record
The builder stated the packet's open minors were fixed across PRs **#814, #818, #819, #821, #823**.
Only **#814 (`dc0eed6`)** touches this lane. #818 was an NTFS inode-drift test, #819 offload-worker
per-platform timeouts, #821 the scheduler-lock heartbeat, #823 a controller relay `C:\temp` leak.
Accurate status of the five minors:

| Minor | Actual status |
|---|---|
| spec §3.2/§5 wall codes | **fixed** for all 18 client `RESIDENT_MODEL_*` codes; the ~30 `HERMES_FREE_AGENT_*_WALL` invoker codes are still mapped by class only |
| per-turn `timeoutMs` re-check | **fixed** |
| leftover `node_modules` junction: distinct code + documented cleanup | **fixed** |
| continuity fixture duplication | **partially fixed** — within-file only; the cross-file duplication with `tests/goal-operator-continuity.test.ts` (which the minor actually described) remains |
| behavioural invoker tests skip off-Windows | **open** |

## Findings the packet omitted

1. **What activation actually means.** `docs/runbooks/hermes-free-dev-agent.md` states the launcher
   must not start before the P3 review lands, and that starting it begins autonomous cycling where
   the orchestrator commits, pushes, opens **and merges** PRs driven by the local 4B model. The merge
   gate is bot-only: `reviewed = hasExactHeadReview || hasCodeRabbitReview`
   (`scripts/hermes-bridge/repository-lifecycle.mjs`), satisfiable without a human. So the decision
   this review sits in front of is "may a 4B local model merge to `main` under automated review
   only," not "may the pilot caveat be dropped." The three activation decisions remain **separate
   owner decisions that this review does not grant**.
2. **The T2 §5 deviation**, raised nowhere in the packet: §5 requires no host mounts, workspace-only
   writes, and a disposable/contained runtime. v2 replaces the disposable clone with the live
   worktree **and** adds a second writable host mount for kernel state.
3. **§4's actual acceptance criterion is uncompensated, not compensated.** §4 requires edits to land
   atomically with verify-and-rollback. Re-deriving changed paths from git tells you *which* files
   moved; it does not validate the edit, apply atomically, or roll back a partial write. A botched
   edit becomes a dirty worktree that fails validation — acceptable, but a different claim.
4. **"Re-derives every changed path" is false.** `git status --porcelain` is invoked without
   `--ignored`, so writes to ignored paths (`.env`, `build/`, `coverage/`, `.venv/`, `.codex/`) are
   never enumerated or checked against reservations. Containment holds; the *reservation* claim does
   not. No path from an ignored write to influencing host-side validation was found.
5. **The post-turn reparse sweep is detective, not preventive**, and a detected
   `RESIDENT_MODEL_LANE_WORKSPACE_TAMPERED` does **not** set the quarantine marker, so a tamper
   finding does not close the lane.
6. **The git-common-dir invariant is blind to a `.git`-link rewrite** (rewriting `gitdir:` to the main
   gitdir leaves `--git-common-dir` unchanged). Rated residual, not blocking, and reasoned from git
   semantics rather than demonstrated.
7. **Containment properties are unverified at run time.** The invoker pins the image ID and network
   membership, but `ComposeFile` is only checked to exist and `config.yaml` / `run_agent.py` are not
   checked at all. Every remaining `containment.*` property is true only if the deployed compose file
   matches the repo — and P2b **hand-edited** the deployed `compose.yaml` and `run_agent.py`, leaving
   `.bak-*` copies. → C6.
8. **A leftover probe policy on HERMES is a standing evidence-gate bypass**: it carries
   `OWNED_WORKTREE_CONFINEMENT_PROVEN: "P2-PROBE-2026-08-16-PROVISIONAL"`, is outside version control,
   and the invoker accepts any `-PolicyPath`. → C7.
9. **The real anti-self-certification control is a CI content pin**, not the two runtime checks:
   `tests/hermes-free-dev-agent-provider.test.ts` deep-equals the whole `satisfiedEvidence` map
   including the `null`, and pins `promotionRequires` and `status`. A quiet local grant fails CI.
   **Its value survives promotion only if the grant re-pins the granted values rather than deleting
   the assertions.** The v2 policy is itself not byte-sealed, unlike other authority-bearing files in
   this repo.
10. **Per-thread state is a trust surface, not just disk.** Nothing prunes thread dirs (~5.4 MB each,
    per outcome). More importantly, model-authored text now survives the container in host-persisted
    `state.db` and re-enters the next turn unreviewed — bounded today only by `config.yaml` disabling
    skills/memory/plugins, which is an **unpinned host file**.
11. **The orchestrator passes a per-turn sandbox policy the kernel client silently drops**
    (`sandboxPolicy.writableRoots`, `networkAccess`, `runtimeWorkspaceRoots`); only
    `turn.outputSchema` is honoured. Containment comes from Docker instead — arguably stronger — but
    the call site reads as though a per-turn sandbox were enforced. Document the drop.

## Confirmed sound

- Both enforcement points accept `PILOT_AUTHORIZED` or `PROMOTED`, and the lane is inert unless
  `WILLIAMOS_EXECUTOR=resident-model` — so promotion changes nothing mechanically at runtime.
- `agent-owned` is genuinely identical to `agent` in every containment property (`read_only`,
  `cap_drop: ALL`, same five `cap_add`, `no-new-privileges`, `pids_limit`, `mem_limit`, `cpus`,
  network, env). The only deltas are the added state bind and removal of the redundant tmpfs.
- `config.yaml` disables skills, code execution, delegation, web, browser, messaging, cron, memory and
  plugins — which defuses the "persistent HERMES_HOME becomes a code-execution surface" concern. This
  mitigation is load-bearing and was **not** stated in the promotion argument.
- `INDEPENDENT_REVIEW_APPROVED` is correctly left untouched and correctly not reused for v2.
- SEA is **not** a precondition for promoting this mode: the WO itself says in-process hooks are not
  the boundary, and `terminal` is in the allowed toolsets regardless, so disabling `file` would not
  remove free-form editing.

## Verified vs accepted on report

**Verified in-tree by the reviewer:** the v1↔v2 policy diff; both enforcement points; the promotion
gate in client and invoker; client wall codes vs spec §5; the per-turn budget re-check; the
dependencies wall and runbook entry; `runTurn`'s missing workspace binding; the optional
`-QuarantinePath`; `assertChangedPathsAllowed` and the `git status` invocations feeding it;
`agent` vs `agent-owned` equivalence; `config.yaml` toolset state; the absence of thread-dir pruning;
backend selection; the bot-only `reviewed` derivation; the runbook activation warning; the CI content
pin; the true contents of the five cited PRs; and the three lane suites (54/54 on Windows).

**Accepted from the P2/P2b reports without independent verification — not re-runnable without HERMES
hardware, and not attempted:** the two live runs and their ids, the confined diff, the clean canonical
checkout, zero leftover containers, absent quarantine markers, the live git-common-dir checks, the
resumed session and turn-2 recall, the state-dir layout, and **the assertion that the deployed
`compose.yaml` / `config.yaml` / `run_agent.py` on HERMES are byte-identical to the repo copies**.
That last is the load-bearing unverifiable claim, which is precisely why C6 exists: today it is prose,
and nothing in code or CI would notice if it stopped being true.
