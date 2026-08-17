# P3 — independent review result: hermes-free-dev-agent **v2 owned-worktree mode**

**Reference:** `review-2026-08-17-t1-indep-opus5`
**Verdict: `APPROVE_WITH_CONDITIONS`** → all nine conditions closed → closure independently
re-verified **`CONDITIONS_CLOSED`** (2026-08-17, same reviewer, against `main` = `d87c400`).

**PROMOTION GRANTED 2026-08-17.**
`promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED = "review-2026-08-17-t1-indep-opus5"`,
`promotion.status = "PROMOTED"`. **This review is now closed.**

> **The grant authorises promotion only. It authorises NO activation.** `control/activation`,
> `DATABASE_URL`, and running the launcher remain three separate owner decisions. A 4B model
> committing, pushing, opening and merging to `main` under a bot-only merge gate is a distinct
> authorisation no reviewer has been asked for, and **this record must not be cited as having given
> it** (reviewer's words, on both passes).

The CI content pin was **re-pinned to the granted value, not deleted** — it is the only non-circular
leg of the evidence machinery, since both runtime enforcement points read the same operator-controlled
policy file. `promotion.evidenceScope` is now pinned too (W5).

Requested by
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
| C1 | Restate what promotion authorises: the runbook names this review as the activation gate, and merge review is bot-only | yes | **closed** |
| C2 | Correct the false PR attribution for the "fixed minors" claim | yes (record) | **closed** (below) |
| C3 | `runTurn` does not bind the thread to the workspace, unlike `resumeThread` | yes | **closed** |
| C4 | Owned mode does not require `-QuarantinePath`, so the marker can land in the checkout | yes | **closed** |
| C5 | Record the T2 §4 **and §5** deviations as dated accepted deviations with a named follow-up WO | yes (record) | **closed** |
| C6 | Pin or verify the three deployed host files the containment claim rests on | no | **closed** |
| C7 | Neutralise the leftover `PROVISIONAL` probe policy on HERMES | no | **closed** (partly pre-existing; structural remainder tracked) |
| C8 | Adopt a per-thread state retention rule and state the trust-surface argument | no | **closed** |
| C9 | Make the inherited v1 review line's scope legible inside the policy file | no | **closed** |

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

### C1 — closed
The promotion packet now carries a dated amendment at the head of "What promotion would authorise"
stating what this review actually gates: the runbook forbids starting the launcher before this review
lands, and starting it begins autonomous cycling in which the orchestrator commits, pushes, opens
**and merges** PRs driven by the local 4B model, under a **bot-only** merge gate
(`reviewed: hasExactHeadReview || hasCodeRabbitReview`, `repository-lifecycle.mjs:1191`) — which the
review-sourcing supersession classes as Tier 3, additive only, never sufficient. The amendment states
explicitly that granting `V2_OWNED_WORKTREE_REVIEW_APPROVED` authorises **none** of the three
activation steps, which remain separate owner decisions.

### C5 — closed
Both deviations are recorded, dated, and scoped in
[`docs/governance/hermes-kernel-v2-doctrine-deviations-2026-08-17.md`](../governance/hermes-kernel-v2-doctrine-deviations-2026-08-17.md),
with named follow-up work orders:

- **D1 (§4, SEA)** — accepted for this lane on the WO's own reasoning (§3: in-process hooks are not
  the boundary; `terminal` is allowed regardless, so disabling `file` would not remove free-form
  editing). Records plainly that §4's *reliability* criterion — atomic apply, verify, rollback — is
  **uncompensated**, not compensated, by path re-derivation. Follow-up
  `WO-WILLIAMOS-HERMES-KERNEL-SEA-001`.
- **D2 (§5, host mounts + non-disposable runtime)** — the live worktree and the second writable state
  mount, neither previously written down. Accepted on the evidenced confinement and the
  `agent`/`agent-owned` containment equivalence, with the `config.yaml` mitigation named as
  load-bearing and now digest-pinned by C6. Records that persisted kernel state is a trust surface
  bounded by no retention or review rule. Follow-up
  `WO-WILLIAMOS-HERMES-KERNEL-STATE-RETENTION-001`, which also carries C8.

### C8 — closed
Thread state now has a declared, enforced budget: `containment.threadStateRetention`
(`maxThreads: 20`, `maxAgeHours: 168`). `startThread` prunes thread dirs beyond either bound, never
touching the thread it just created, only uuid-shaped leaves strictly inside the runtime's own
threads root. Ordering uses `session.json.createdAt`, falling back to directory mtime.

A missing or malformed budget is deliberately **not** a wall — retention is housekeeping over
already-contained state, not a containment control, and closing the lane over a bookkeeping error
would trade a real capability for nothing. A conservative fallback still bounds growth, and both
behaviours are tested.

The trust-surface argument is stated where it belongs rather than left implicit: in the client beside
the code, and in the deviation record (D2). The point is not disk. Model-authored text persists in
`state.db` and re-enters the next turn's context **without review** — precisely what P2b proved — and
WO §2 classifies kernel memory as review-gated and never auto-adopted. Retention bounds how long that
survives; it does **not** answer who reviews what accumulates, which stays with
`WO-WILLIAMOS-HERMES-KERNEL-STATE-RETENTION-001`.

### C9 — closed
`promotion.evidenceScope` now annotates every evidence line in the v2 policy itself, so scope is
legible in the file rather than only in a packet. It records that `INDEPENDENT_REVIEW_APPROVED`
(`2026-08-13T17:05:00Z`) is **v1-scoped**, predates owned-worktree mode, did not examine the
live-worktree mount, per-thread state mount or resume path, does **not** constitute review of v2, and
is deliberately absent from `promotionRequires`. It also records that `WORKSPACE_CONFINEMENT_PROVEN`
is superseded for v2 by `OWNED_WORKTREE_CONFINEMENT_PROVEN`, and that
`V2_OWNED_WORKTREE_REVIEW_APPROVED` stays `null` while this review's conditions remain open.

### C6 — closed
The deployed `compose.yaml`, `config.yaml` and `run_agent.py` were verified against the repo copies on
2026-08-17 and **byte-match**:

| Artifact | SHA-256 (deployed on HERMES == repo copy) |
|---|---|
| `compose.yaml` | `ada957ab2af985aec2f117fc5757f31e326564e344f1ba2358ff37ce1b7d21be` |
| `config.yaml` | `f8d55cf9c44a3352ee28627b30f8bcaf2f4555a7cdfa419dfae4e67675e454e1` |
| `run_agent.py` | `8cd7619ddeb7cdbb59c14c9288da1ada4e9c0c8e3d5a6f570dc6f838105e849d` |

That confirms the load-bearing claim the reviewer could not verify — **as of that moment**, which is
exactly why a one-off check is not the fix. The digests are now recorded in
`containment.deployedArtifactSha256` in the v2 policy, and the invoker verifies all three against it
in owned mode before any turn, raising `HERMES_FREE_AGENT_DEPLOYED_ARTIFACT_WALL` on a missing,
malformed or mismatched artifact. Previously the image ID and network membership were pinned, but
`ComposeFile` was only checked to **exist** and the other two were not checked at all.

The digests sit under `containment`, which `tests/hermes-free-dev-agent-provider.test.ts` deep-equals
— so a deployed-artifact change cannot land without a reviewed policy change in the same commit, and
the provider test additionally asserts the invoker actually enforces the field rather than merely
carrying it. The digests pin the **deployed** bytes and are deliberately not compared against a repo
working copy, whose line endings vary by checkout platform.

### C7 — closed, and it was already true before the review
The named artifact does not exist. Verified on HERMES 2026-08-17: `Test-Path` on
`D:\HermesServices\williamos-hermes-agent\hermes-free-dev-agent-v2.probe.policy.json` → `False`, and a
full listing of that directory shows only `hermes-free-dev-agent-v1.policy.json`. It was removed on
2026-08-16 after the P2 report was written; the removal was recorded in a commit message but never in
the report that advertised it, so the reviewer — who correctly flagged P2/P2b content as accepted
without verification — read a stale claim. The P2 report now carries a dated correction.

**The structural remainder is NOT closed:** the invoker accepts any `-PolicyPath` and the v2 policy is
not byte-sealed, so a hand-written policy is still a possible bypass on any host. This repo already
digest-seals other authority-bearing files. Tracked with the Q4 finding; the C6 wall does not address
it, because that wall checks deployed artifacts, not which policy file was supplied.

**Attempted and reverted 2026-08-17 — recorded so the next attempt starts better informed.** I
implemented a `HERMES_FREE_AGENT_POLICY_PATH_WALL` requiring `-PolicyPath` in owned mode to resolve
inside the repository's `config/execution-fabric/`. It works in production (the client already passes
exactly that path) but broke four behavioural invoker tests, which deliberately supply **synthetic
policies from temp directories** in order to prove the workspace-root, evidence, promotion and
quarantine walls fire. The only ways to make them pass were to weaken the wall, or to have tests write
policies into a version-controlled directory — and a dirty working tree breaks the suites that assert
on real git state, which cost 16 spurious failures earlier the same day. Shipping a control whose only
route to green is making tests dirty the repo is worse than leaving the gap recorded.

The right shape is probably **content**, not path: require the supplied policy to byte-match a
reviewed copy, with the behavioural tests reworked to use the real policy plus injected evidence
rather than hand-written files. That is a test-harness change as much as a control change.
Follow-up: `WO-WILLIAMOS-HERMES-POLICY-PROVENANCE-001`.

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
