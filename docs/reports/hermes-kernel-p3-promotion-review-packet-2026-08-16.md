# P3 — promotion review packet: hermes-free-dev-agent **v2 owned-worktree mode**

**Status: NOT PROMOTED. This packet requests a review; it does not grant one.**

The v2 lane runs today as `PILOT_AUTHORIZED` with every run-gating evidence line satisfied
(P2, P2b). Promotion to `PROMOTED` is gated separately on
`promotion.promotionRequires = ["V2_OWNED_WORKTREE_REVIEW_APPROVED"]`, which is `null` and must be
set **by a reviewer who did not build this lane**. The author of S2/P2/P2b (Claude, 2026-08-16)
cannot satisfy it: self-certification is exactly what the evidence gate exists to prevent.

## Why a v2-scoped review line exists

`promotion.satisfiedEvidence.INDEPENDENT_REVIEW_APPROVED` is `"2026-08-13T17:05:00Z"`, **inherited
verbatim from v1**. That review predates owned-worktree mode (P1 merged 2026-08-16), so it could not
have examined the live-worktree mount, the per-thread state mount, or the resume path. Treating it as
v2's review would repeat the C1 defect found in the S2 final review (a policy asserting a control as
proven on evidence that covers something else). The v1 value is therefore left untouched and
promotion keys on a new, v2-scoped line instead.

## What promotion would authorise

Nothing at runtime changes on promotion: both enforcement points already accept
`PILOT_AUTHORIZED` **or** `PROMOTED`. Promotion is a governance statement — that this mode has been
independently examined — and it removes the "pilot" caveat from the lane's status. Because
`PROMOTED` was previously a word with no gate behind it, this change adds one (below).

## The delta under review (v1 → v2)

| Property | v1 (`BASELINE_CLONE`) | v2 (`OWNED_WORKTREE`) |
|---|---|---|
| Workspace | unique disposable clone of a pinned baseline under `D:\HermesWorkspaces\…` | the orchestrator's **live owned worktree** under `<runtime root>\worktrees`, mounted rw |
| Kernel state (`HERMES_HOME` = `/opt/data`) | tmpfs, dies with the container | bind mount of `<runtime root>\hermes-kernel\threads\<threadId>\kernel-state` (service `agent-owned`) |
| Session continuity | none | `hermes chat --resume <id>`, id captured by WilliamOS from the previous turn |
| Packet | schema 2, `workspaceRoot` | schema 3, `workspacePath`, `statePath`, `kernelSessionId` |
| Prompt budget | 16 000 chars | 60 000 (remediation prompts carry findings) |
| Editing path | kernel's native `file` toolset | unchanged — **not** SEA (see risk 2) |
| Image / network / caps / read-only root / proxy allowlist | — | **unchanged**; no image rebuild |

## Evidence already on record

| Line | Value | Source |
|---|---|---|
| `OWNED_WORKTREE_CONFINEMENT_PROVEN` | `p2-b9fbca28-…` | [P2 report](hermes-kernel-p2-resident-model-probe-2026-08-16.md) — two live runs on HERMES; diff confined to one reserved path; canonical checkout clean; 0 containers left; no quarantine marker; git-common-dir unchanged |
| `KERNEL_SESSION_CONTINUITY_PROVEN` | `p2b-1f789bdf-…` | [P2b report](hermes-kernel-p2b-session-continuity-2026-08-16.md) — tool-free second turn recalled the exact marker and file from resumed session `20260816_210244_3232c2` |
| `IMAGE_BUILD_PROVEN`, `NETWORK_ISOLATION_PROVEN`, `LOCAL_MODEL_TOOL_CALL_PROVEN`, `WORKSPACE_CONFINEMENT_PROVEN` | inherited from v1 | v1 pilot; unchanged by v2 except `WORKSPACE_CONFINEMENT_PROVEN`, which v2 supersedes with its own owned-worktree line |

## What a reviewer should check

1. **Containment of the live worktree.** `/workspace` is no longer disposable. Does
   `assertChangedPathsAllowed` (orchestrator, re-derives the diff from `git status`) plus the
   invoker's walls (root prefix, ancestor + top-level reparse points, `node_modules`,
   canonical-checkout refusal) actually bound the blast radius? See
   `scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1` owned-mode block and
   `hermes-kernel-client.mjs` `assertOwnedWorkspace` / `gitCommonDir` pre+post check.
2. **T2 doctrine (WO-WILLIAMOS-HERMES-KERNEL-V1 §4).** Doctrine says SEA replaces the kernel's
   free-form editing. v2 still uses the native `file` toolset; the compensating control is that
   WilliamOS re-derives every changed path from git and owns commit/PR/merge. Is that acceptable,
   or is SEA a precondition for promotion?
3. **Per-thread state.** State is a host directory the kernel writes as uid 10000. Threads are
   never reused across outcomes; nothing prunes old thread dirs (~5 MB each). Is a retention rule
   required before promotion?
4. **The evidence machinery itself.** Are the two enforcement points (client `readPolicy`, invoker
   owned block) sufficient, given that both read the same policy file the operator controls?
5. **Known open minors** (from the S2 final review, deliberately not fixed): spec §3.2/§5 does not
   list every wall code; a per-turn `timeoutMs` override is not re-checked against the kernel
   deadline; a validation junction left by an aborted run makes `node_modules` wall the lane until
   removed by hand; the continuity fixture is duplicated across two test files; behavioural invoker
   tests skip on non-Windows runners.

## How to grant promotion (reviewer action)

1. Set `promotion.satisfiedEvidence.V2_OWNED_WORKTREE_REVIEW_APPROVED` to a durable reference for
   the review (e.g. `review-YYYY-MM-DD-<reviewer>` or a PR/commit URL).
2. Set `promotion.status` to `"PROMOTED"`.
3. Update `tests/hermes-free-dev-agent-provider.test.ts` (the P3 block asserts the un-promoted
   state) and record the review under `docs/reports/`.

If step 1 is skipped, step 2 fails closed: the client raises
`RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN` and the invoker throws
`HERMES_FREE_AGENT_PROMOTION_EVIDENCE_WALL` — proven by unit and behavioural tests. Promotion
cannot be granted by editing one word.
