# Hermes free development agent

This provider runs the open-source Nous Research Hermes Agent on the physical Hermes lab server. OMEN is only the control workstation. The agent never mounts the canonical WilliamOS checkout.

## Safety boundary

- Runtime image: `williamos-hermes-agent:0.20.0-fa83af3`, pinned by image ID in policy.
- Model: local `williamos-qwen3-4b:64k`, derived from `qwen3:4b-instruct`; cloud fallback is disabled.
- Network: the one-shot agent joins only `williamos_free_agent_internal`. Its only peer is the inference proxy.
- The proxy allows only `GET /v1/models` and `POST /v1/chat/completions`; Ollama management routes are denied.
- Workspace: every invocation receives a unique clone below `D:\HermesWorkspaces\williamos-free-dev-agent\runs`.
- Container: read-only root filesystem, no Docker socket, no credential mounts, no published ports, and only file/terminal tools.
- Lifecycle: one host-wide invocation at a time, at most 20 turns, 1,800-second timeout, exact-container cleanup, and durable quarantine if cleanup cannot be proven.

## Invoke a pilot

On Hermes, edit a copy of `pilot-packet.json` without changing its field set, model, workspace root, toolsets, or Work Order ID. Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\HermesServices\williamos-hermes-agent\invoke-hermes-free-dev-agent.ps1 `
  -PacketPath D:\HermesServices\williamos-hermes-agent\pilot-packet.json `
  -PolicyPath D:\HermesServices\williamos-hermes-agent\hermes-free-dev-agent-v1.policy.json
```

Success prints `HERMES_FREE_AGENT_COMPLETE` with the unique run ID and workspace. Inspect the workspace and its Git diff before moving any change elsewhere. The provider cannot push or merge.

## Fail-closed operations

Do not delete `HERMES_FREE_AGENT_QUARANTINED` merely to make a run proceed. If it exists, inspect the recorded exact container name, reconcile Docker state, prove the container absent, and only then remove the marker. A cleanup, network-membership, image-ID, baseline, packet, promotion, timeout, or concurrency wall means the run is not accepted.

The standing inference proxy may remain healthy between invocations. No agent container may remain after a completed or failed invocation.

## v2 — owned-worktree mode (WilliamOS resident executor, S2)

Policy: `config/execution-fabric/hermes-free-dev-agent-v2.policy.json` (`placement.workspaceMode: OWNED_WORKTREE`).
Invoked only by the WilliamOS orchestrator when `WILLIAMOS_EXECUTOR=resident-model`, through
`ResidentModelExecutionBackend.runCodexClient` → `createHermesKernelClient`. The adapter writes a
v2 packet under `<runtime root>\hermes-kernel\threads\<threadId>\turns\<n>\packet.json` and runs:

    powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File invoke-hermes-free-dev-agent.ps1 `
      -PacketPath <packet> -PolicyPath <v2 policy> -WorkspacePath <owned worktree> -RunId <turnId> `
      -QuarantinePath <runtime root>\hermes-kernel\HERMES_FREE_AGENT_QUARANTINED

`-QuarantinePath` keeps the durable quarantine marker in the runtime root instead of the
version-controlled `config/execution-fabric/` directory. Both locations are checked: a marker at
either one refuses the run.

The workspace must be under `placement.allowedWorkspaceRoots` (the orchestrator's `worktrees` dir),
must not be the canonical checkout, and must contain no symlink components; otherwise the invoker
walls (`HERMES_FREE_AGENT_WORKSPACE_*_WALL`). No baseline clone is made in this mode. The kernel's
final fenced ```json block is the turn result the orchestrator validates; validation, commit, push,
PR and merge stay in WilliamOS.

The v2 lane is gated by evidence: every line in `promotion.requiredEvidence` must have a non-null
value in `promotion.satisfiedEvidence`, and both the client (`RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN`)
and the invoker (`HERMES_FREE_AGENT_EVIDENCE_WALL`) refuse to run while any declared line is unproven.
`OWNED_WORKTREE_CONFINEMENT_PROVEN` was set by the P2 probe on HERMES on 2026-08-16 (turn
`b9fbca28-…`; see `docs/reports/hermes-kernel-p2-resident-model-probe-2026-08-16.md`). Never fill an
evidence value in to make a run proceed — a new declared line closes the lane again until proven.

**Promotion is separate from running.** `promotion.requiredEvidence` gates *running* the lane;
`promotion.promotionRequires` gates *claiming* `promotion.status: "PROMOTED"`. The v2 mode declares
`V2_OWNED_WORKTREE_REVIEW_APPROVED`, which is `null`: the lane runs as `PILOT_AUTHORIZED`, and
setting the status to `PROMOTED` without that line fails closed at both enforcement points
(`RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN` / `HERMES_FREE_AGENT_PROMOTION_EVIDENCE_WALL`). The line is
v2-scoped on purpose: `INDEPENDENT_REVIEW_APPROVED` is inherited from v1 (2026-08-13) and predates
owned-worktree mode, so it cannot stand in for a review of it. Promotion procedure and the review
checklist: `docs/reports/hermes-kernel-p3-promotion-review-packet-2026-08-16.md`. It must be granted
by someone who did not build the lane.

The invoker also refuses an owned workspace that contains `node_modules` or any top-level reparse
point (`HERMES_FREE_AGENT_WORKSPACE_CONTENT_WALL`), and the client re-asserts the workspace's
`git rev-parse --git-common-dir` after the invocation, walling on a mismatch.

**`RESIDENT_MODEL_LANE_WORKSPACE_DEPENDENCIES` — the one wall with a routine cause.** WilliamOS
junctions `<worktree>\node_modules` to the workspace copy so validators can run
(`repository-lifecycle.mjs:853`) and unlinks it afterwards (`:919`). A cycle that dies in between
leaves the junction, and every later turn on that worktree walls non-retryably. That is correct —
the kernel must never inherit a bin/symlink farm reaching outside the worktree — and the wall is
*not* to be worked around by widening the check. Clear it instead, after confirming what it is:

    Get-Item <worktree>\node_modules | Select-Object LinkType, Target   # expect Junction → <workspace>\node_modules
    cmd /c rmdir "<worktree>\node_modules"                              # removes the junction, never its target

If it is a real directory rather than a junction, something other than the validation lane wrote it:
investigate before deleting. A dangling junction (target already gone) raises the same wall — the
check uses `lstat`, so it names the leftover rather than falling through to a generic refusal.

The turn budget is re-checked per turn, not only at `connect()`: a `runTurn` `timeoutMs` below the
policy's `execution.timeoutSeconds` walls `RESIDENT_MODEL_LANE_TIMEOUT` before anything is written
or spawned. A shorter budget would let the host runner kill the invoker mid-run, so the invoker
would never reach its own `HERMES_FREE_AGENT_TIMEOUT_WALL` and its container cleanup and quarantine
marking would never happen. Raise the caller's budget; do not lower `timeoutSeconds` to fit it.

**Kernel state is a trust surface, and it is now bounded.** Model-authored text persists in the
thread's `state.db` and re-enters the next turn's context without review (that is what P2b proved),
so it must not accumulate across outcomes. `containment.threadStateRetention` declares the budget
(`maxThreads: 20`, `maxAgeHours: 168`) and `startThread` prunes thread dirs beyond either bound —
never the thread being started, and only uuid-shaped leaves inside `<runtime root>\hermes-kernel\
threads\`. A missing or malformed budget falls back conservatively instead of walling: retention is
housekeeping over already-contained state, not a containment control. What it does **not** do is
decide *what may accumulate and who reviews it* — that stays with
`WO-WILLIAMOS-HERMES-KERNEL-STATE-RETENTION-001`. Do not widen the budget to keep evidence; copy the
thread dir out instead.

Kernel state is per WilliamOS thread (`containment.agentStatePersistence: PER_THREAD_STATE_DIR`): the
invoker mounts `<runtime root>\hermes-kernel\threads\<threadId>\kernel-state` as the kernel's
`HERMES_HOME` through the `agent-owned` compose service (the v1 `agent` service keeps its tmpfs
`/opt/data`). The client captures the kernel's `Session: <id>` line and passes it back on the next
turn, which the runner turns into `hermes chat --resume <id>`. `execution.sessionResumeProven` is
`true` since P2b (2026-08-16, `docs/reports/hermes-kernel-p2b-session-continuity-2026-08-16.md`), but
`resumeThread` still fails closed per thread unless that thread captured a session id and its state
dir exists.

P2 probe (owner-triggered on HERMES; `pnpm hermes:smoke` is the AEGIS/Codex transport smoke and does
NOT drive this lane): create an owned probe worktree under `<runtime root>\worktrees`
(`git -C <checkout> worktree add -b p2/resident-probe <path> main`), write a probe copy of the v2
policy **without a BOM** (`[IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))`),
then from the checkout root:

    node scripts/hermes-bridge/resident-model-probe.mjs --workspace <probe worktree> --policy <policy> --out <summary.json>

It runs connect → startThread → one turn (a one-line comment in a reserved path + the schema
JSON) → resumeThread, and prints a JSON summary; then verify `git status` of the worktree shows only
the reserved path, the canonical checkout is clean, no `williamos-hermes-agent-*` container remains,
and no quarantine marker exists. Record the summary and hashes under `docs/reports/`.

Add `--turns 2` to run the P2b continuity probe: a second, tool-free turn on the same thread that
must recall the first turn's edit from kernel session memory (`continuity.recalledMarker` and
`continuity.recalledFile` in the summary), proving the state mount and `--resume` path end to end.

## HERMES deployment wiring — INERT pending the P3 review (2026-08-16)

The resident-model executor is wired on HERMES but deliberately switched off. Note first what the
running "WilliamOS deployment" on that host actually is: the **web app** (`server.js` on port 3100
plus `hermes-https-proxy.mjs`, started by the *WilliamOS Live* / *WilliamOS HTTPS* scheduled tasks).
The orchestrator is a separate CLI and **is not running** there; the flat runtime those tasks serve
predates S2 and contains none of this lane's code.

| Piece | State |
|---|---|
| Checkout | `C:\HermesLab\terragroq-s2` on `main`, clean — the lane's deployment source; the probe and the launcher both run from it |
| `<checkout>\.env.local` | read by **every** supervisor start, so it deliberately does **not** set `WILLIAMOS_EXECUTOR` (a run started for any other reason must keep the Codex lane). Carries `WILLIAMOS_REPOSITORY_ROOT` only; the switch is present but commented out |
| `C:\ProgramData\WilliamOS\start-williamos-resident-executor.ps1` | the only thing that selects the lane: it exports `WILLIAMOS_EXECUTOR=resident-model` into its own environment (inherited by the cycle child) and calls `supervisor.ps1`. **Not scheduled, not started** |
| `<runtime root>\control\activation` | `disabled` — `orchestrator.mjs:917` returns `DISABLED` unless it reads exactly `enabled` |
| `DATABASE_URL` | unset — the outcome queue (`outcome-queue-runtime.mjs:468`) has no data source |

Verified read-only (no turn, no Docker): a plain supervisor start resolves to
`LocalExecutionBackend` (Codex lane); the launcher's environment resolves to
`ResidentModelExecutionBackend` with the v2 policy and invoker resolving inside the checkout; the
runtime's `worktrees` directory matches the policy's `allowedWorkspaceRoots` exactly; and
`connect()` succeeds against the real policy, so the lane itself is open.

**Do not start the launcher before the P3 independent review lands**
(`docs/reports/hermes-kernel-p3-promotion-review-packet-2026-08-16.md`). Starting it begins
autonomous cycling: on success the orchestrator commits, pushes, opens **and merges** pull requests,
driven by the local 4B model, on a lane that is still `PILOT_AUTHORIZED`. Turning it on is three
owner decisions — flip `control/activation` to `enabled`, provide `DATABASE_URL`, and run (or
schedule) the launcher.
