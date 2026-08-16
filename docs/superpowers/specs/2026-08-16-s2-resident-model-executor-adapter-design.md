# S2 — Resident-model executor adapter over the Hermes-Agent kernel

**Date:** 2026-08-16 · **Status:** P1 merged (PR #804). P2 done — owned-worktree confinement proven
on HERMES (PR #805, `docs/reports/hermes-kernel-p2-resident-model-probe-2026-08-16.md`). P2b done —
per-thread kernel state + session continuity proven
(`docs/reports/hermes-kernel-p2b-session-continuity-2026-08-16.md`); `sessionResumeProven` is now
`true`. P3: the promotion gate is built and the review packet written
(`docs/reports/hermes-kernel-p3-promotion-review-packet-2026-08-16.md`); promotion itself is
**pending an independent reviewer** — the authoring project cannot satisfy
`V2_OWNED_WORKTREE_REVIEW_APPROVED`.
**Builds on:** S1 (`ResidentModelExecutionBackend`, commit `3558e65`), WO-WILLIAMOS-HERMES-KERNEL-V1
(T2 doctrine), `hermes-free-dev-agent` provider (policy v1, `PILOT_AUTHORIZED`).

**Ledger:** S2 P1 — resident-model executor adapter over Hermes-Agent kernel — branch
wo/s2-resident-executor-adapter — P2 live smoke pending owner.

## 0. Decision and why

WilliamOS currently executes work only through Codex (`LocalExecutionBackend.runCodexClient` →
`CodexAppServerClient`). The owner's stated intent is a resident executor on the lab's own model.
Two substrates were considered:

- **B — a native tool loop** inside `ResidentModelExecutionBackend` (own agent loop, own tool
  dispatch, code-level containment). **Rejected**: T2 doctrine assigns "agent loop, tool dispatch,
  provider transport" to the Nous Hermes Agent kernel, edits to SEA, and command policy to CAPG in
  the kernel; a second loop is a bypass however small.
- **A′ — an adapter over the existing Hermes-Agent lane** so that lane satisfies the orchestrator's
  client contract. **Chosen.** WilliamOS keeps authority, evidence, validation, commit/PR/merge; the
  kernel does the work; containment stays the reviewed Docker boundary.

S2 therefore builds **no kernel**. It builds: (1) the client adapter, (2) a v2 of the free-dev-agent
policy + invoker that admits the orchestrator's owned worktree as the run workspace and persists
per-thread session state, (3) contract tests with a fake invoker, (4) a live acceptance on HERMES.

## 1. The contract the adapter must satisfy (verified from source)

Consumer: `scripts/hermes-bridge/orchestrator.mjs` (`:1558–1560`, `:1617–1665`, `:1718–1740`,
`:2033`), smoke at `cli.mjs:231`. Selection: S1's exact `WILLIAMOS_EXECUTOR === "resident-model"`.

| Member | Called with | Must return / do |
|---|---|---|
| `connect()` | — | resolve when the lane is usable; throw a typed wall otherwise |
| `startThread({cwd, approvalPolicy:"never", sandbox:"workspace-write", ephemeral:false})` | worktree path | a `threadId` string |
| `resumeThread(threadId, {cwd, approvalPolicy, sandbox})` | prior id | resolve if the thread can continue; **throw** if not (orchestrator then starts a new thread, except during owner-decision resume, where it walls — correct fail-closed) |
| `runTurn({threadId, prompt, turn:{outputSchema, effort, approvalPolicy, runtimeWorkspaceRoots, sandboxPolicy}, timeoutMs})` | delivery / remediation / owner-decision-resume prompt (`prompt.mjs`) + `HERMES_TURN_OUTPUT_SCHEMA` | `{ threadId, turnId, status:"completed", finalText }` where `finalText` is the JSON the orchestrator validates via `validatedTurnResult` |
| `close()` | — | release nothing that survives the process; idempotent |

Turn semantics: the kernel makes the code changes **inside the orchestrator's owned worktree**,
within the reviewed contract's `reservations`; the orchestrator (not the client) runs
`validationCommands`, commits, pushes, opens the PR, merges, and checkpoints. `turn.effort`,
`sandboxPolicy` etc. are informational to this lane and are recorded, not enforced by it.

Error taxonomy the orchestrator already handles (`orchestrator.mjs:2021`): `APP_SERVER_TURN_FAILED`,
`APP_SERVER_TURN_INTERRUPTED`, `APP_SERVER_TIMEOUT` are retryable walls; the adapter reuses those
classes from `app-server-client.mjs` so orchestrator retry/abandon logic is unchanged.

## 2. Architecture

```
orchestrator ──runCodexClient()──▶ ResidentModelExecutionBackend
                                    └─ createHermesKernelClient()  (new: scripts/hermes-bridge/hermes-kernel-client.mjs)
                                         ├─ SessionStore        <runtimeRoot>/hermes-kernel/threads/<threadId>/session.json
                                         ├─ PacketBuilder       prompt.mjs delivery prompt + output-contract epilogue → packet.v2.json
                                         ├─ Invoker (transport) commandRunner → powershell invoke-hermes-free-dev-agent.ps1 (v2 flags)
                                         └─ OutputHarvester     last fenced ```json``` block from invoker stdout → finalText
                          Docker (HERMES): williamos-hermes-agent image (pinned) ── /workspace = owned worktree (rw)
                                                                                     network    = inference-proxy only
```

Everything above the Docker line is WilliamOS; everything below is the reviewed kernel lane.

## 3. Components

### 3.1 `ResidentModelExecutionBackend.runCodexClient({workspacePath, timeoutMs})`
Replaces S1's typed throw. Returns `createHermesKernelClient({ workspacePath, timeoutMs,
runtimeRoot, commandRunner, policyPath, invokerPath })`. All collaborators injectable
(the backend already owns `commandRunner`, `runtimeRoot`).

### 3.2 `createHermesKernelClient` (new module)
- `connect()`: reads policy v2; requires `promotion.status ∈ {PILOT_AUTHORIZED, PROMOTED}`,
  `placement.workspaceMode === "OWNED_WORKTREE"`, `workspacePath` under
  `<runtimeRoot>/worktrees/` (realpath, no symlinks); requires the durable quarantine marker
  (`HERMES_FREE_AGENT_QUARANTINED`) to be absent. Any failure → `AppServerWallError` with a
  `RESIDENT_MODEL_LANE_*` code. Never invokes Docker.
- `startThread()`: mints `threadId` (UUID v4), creates the thread dir + `session.json`
  `{schemaVersion:1, threadId, workspacePath, createdAt, turns:[]}`; returns id.
- `resumeThread(threadId)`: loads `session.json`; requires the same `workspacePath`; if kernel
  resume is not proven for the installed image
  (policy `execution.sessionResumeProven !== true`) → throw `AppServerWallError`
  `RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE`. Fail-closed by default; flipped only by §6 P2 evidence.
- `runTurn({threadId, prompt, turn, timeoutMs})`:
  1. PacketBuilder → packet v2 (§3.3), written to `<thread>/turns/<n>/packet.json` (0600).
  2. Invoker runs the ps1 with `-PacketPath -PolicyPath -WorkspacePath <worktree> -RunId <turnId>`
     via `commandRunner` with `timeoutMs` (default = the orchestrator's `TURN_TIMEOUT_MS`),
     `credentialAccess:false`, plus `-StatePath <thread>/kernel-state` (P2b).
  3. Exit 0 and a `HERMES_FREE_AGENT_COMPLETE runId=<turnId> …` line required; otherwise map (§5).
  4. OutputHarvester extracts the **last** fenced ```json block from stdout, must parse and satisfy
     `HERMES_TURN_OUTPUT_SCHEMA` (structural check here; the orchestrator re-validates). Missing/
     invalid → `AppServerTurnEndedError("failed")` (retryable) with `detail` recorded.
  5. Append `{turnId, packetSha256, stdoutSha256, exitCode, harvested:true|false, at}` to
     `session.json`; write raw stdout (secret-sanitised via `sanitizeAppServerText`) to
     `<thread>/turns/<n>/stdout.txt`.
  6. Return `{ threadId, turnId, status:"completed", finalText }`.
- `close()`: no-op beyond flushing `session.json`.

### 3.3 PacketBuilder / packet v2
Exact fields (v2): `schemaVersion:2, workOrderId, model, prompt, maximumTurns, toolsets,
workspaceMode:"OWNED_WORKTREE", workspacePath, runId, statePath, kernelSessionId` (schemaVersion 3
since P2b; `kernelSessionId` is the session captured from the thread's previous turn, or null).
`prompt` = the orchestrator's
delivery prompt verbatim + a fixed epilogue:

> Finish by printing exactly one fenced ```json block that satisfies the following JSON schema and
> nothing after it. Do not commit, push, open PRs, or touch paths outside the reservations.
> `<HERMES_TURN_OUTPUT_SCHEMA>`

`maximumTurns` = policy `execution.maximumTurns` (20). `toolsets` = policy allowlist verbatim.
Prompt length limit raised in v2 (§4).

### 3.4 Invoker (transport)
No new process model: the reviewed PowerShell invoker is extended (v2) — see §4. The adapter shells
out through the backend's `commandRunner` (already the sanctioned local process runner), never via
`docker` directly, so tests can inject a fake runner and production keeps the invoker's
concurrency lock, exact-container cleanup and quarantine semantics.

### 3.5 OutputHarvester
Pure function `harvestTurnOutput(stdout) → { ok:true, finalText } | { ok:false, reason }`; last
fenced json block; also tolerates a final bare JSON object line. Rejects when >1 candidate
disagrees? No — last wins, by construction of the epilogue ("nothing after it"). A companion pure
function `validateAgainstTurnSchema(object, schema) → { ok:true } | { ok:false, reason:"SCHEMA:<detail>" }`
applies the structural check of §3.2 item 4 (no new dependency).

## 4. Policy v2 and invoker v2 (explicit, reviewed changes — each is a WO line)

`config/execution-fabric/hermes-free-dev-agent-v2.policy.json` (v1 stays for the pilot lane):
1. `placement.workspaceMode: "OWNED_WORKTREE"`, `placement.allowedWorkspaceRoots:
   ["C:\\Users\\bs\\.williamos\\hermes-bridge\\worktrees"]` — the supervisor's default
   `RuntimeRoot` (`supervisor.ps1:3`, exported as `WILLIAMOS_HERMES_RUNTIME_ROOT`) plus the
   backend's `worktrees` leaf (`execution-backend.mjs:83`); baseline-clone mode remains
   selectable as `"BASELINE_CLONE"`.
2. `containment.canonicalRepositoryMounted: false` **unchanged** — an owned worktree of the
   runtime is not the canonical checkout; the invoker must refuse a workspace whose `git
   rev-parse --git-common-dir` resolves to the canonical repository path.
3. `containment.agentStatePersistence: "PER_THREAD_STATE_DIR"` (P2b). The pinned runner keeps agent
   state in `HERMES_HOME` (`/opt/data`), which the v1 `agent` compose service mounts as tmpfs — so
   sessions died with the one-shot container. The `agent-owned` service (added by P2b, identical to
   `agent` in every containment property) binds `<runtime root>\hermes-kernel\threads\<threadId>\kernel-state`
   there instead, and the runner resumes a validated session id from `WILLIAMOS_RESUME_SESSION`.
   Nothing else persists; the v1 service is unchanged. No image rebuild was needed.
5. `execution.sessionResumeProven: true` since P2b evidence; `resumeThread` still fails closed per
   thread unless that thread captured a kernel session id and its state dir exists.
6. `execution.timeoutSeconds` unchanged (1800) — must be ≤ orchestrator turn timeout (45 min).
7. Prompt preamble text in the invoker updated from "disposable clone of the pinned baseline" to
   "the owned WilliamOS worktree for Work Order X; change only reserved paths".

Invoker v2 (`invoke-hermes-free-dev-agent.ps1`): new params `-WorkspacePath -RunId` accepted
**only** when policy `workspaceMode === "OWNED_WORKTREE"`; validates workspace under
`allowedWorkspaceRoots`, not the canonical repo, no symlink components; mounts it as `/workspace`
rw (via the existing `WILLIAMOS_AGENT_WORKSPACE` compose variable); everything else identical (image ID pin, network membership check, one host-wide
lock, exact-container cleanup, quarantine marker). Image and runner are **not** rebuilt in S2 —
the JSON-block epilogue works with the pinned runner's log output. If P2 proves the pinned runner
cannot resume a session from a mounted state dir, that becomes a follow-up (own WO), and
`resumeThread` stays fail-closed meanwhile.

**Note — how owned-worktree mode differs from v1, and why that is defensible.** Two containment
properties change: (a) `/workspace` is the *live owned worktree*, not a disposable clone of the
pinned baseline, so kernel writes survive the run; (b) the kernel uses its native `file` toolset for
edits rather than SEA (T2 §4). Neither is a hole, because WilliamOS still re-derives the diff from
git in `assertChangedPathsAllowed` and remains the only party that commits, pushes, opens PRs and
merges — a kernel write outside the reservations is caught and refused, not trusted. It *is*
nevertheless a widened blast radius versus the disposable clone, and that is precisely why
`OWNED_WORKTREE_CONFINEMENT_PROVEN` is a required evidence line gating the lane: until P2 proves
confinement on HERMES, both the client and the invoker refuse to run
(`RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN` / `HERMES_FREE_AGENT_EVIDENCE_WALL`).

`docs/runbooks/hermes-free-dev-agent.md` gains a "v2 owned-worktree mode" section.

## 5. Error handling (fail-closed mapping)

| Condition | Adapter behaviour |
|---|---|
| quarantine marker present, policy not authorised, workspace outside allowed roots | `connect()`/`runTurn()` throw `AppServerWallError` `RESIDENT_MODEL_LANE_*` (non-retryable) |
| invoker exit ≠ 0 with a `HERMES_FREE_AGENT_*_WALL` token | `AppServerWallError` carrying that token (non-retryable) |
| invoker `HERMES_FREE_AGENT_TIMEOUT_WALL` or commandRunner timeout | `AppServerTimeoutError` (retryable) |
| invoker `HERMES_FREE_AGENT_EXECUTION_WALL` (agent exited non-zero) | `AppServerTurnEndedError("failed")` |
| complete but no valid JSON block | `AppServerTurnEndedError("failed")`, `detail:"RESIDENT_MODEL_TURN_OUTPUT_INVALID"` |
| process killed / lost stdout | `AppServerTurnEndedError("interrupted")` |
| resume requested but unproven / state missing | `AppServerWallError` `RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE` |

No silent fallback to Codex or any cloud model (RULE-0005): failure surfaces as a wall; the
orchestrator's existing provider-retry/defer path applies.

## 6. Rollout

- **P1 (this branch, CI-provable):** adapter module + backend wiring; policy v2 file; invoker v2
  changes; unit/contract tests with fake `commandRunner`; runbook section. Owner review = PR.
- **P2 (on HERMES, owner-triggered):** live smoke `pnpm hermes:smoke` with
  `WILLIAMOS_EXECUTOR=resident-model` against a throwaway outcome on the registered contract;
  evidence: run id, container exit 0, harvested JSON, diff confined to reservations. Then the resume
  probe (P2b, done): two turns on one thread, the second tool-free and answerable only from session
  memory; the kernel recalled the exact marker and file, so `sessionResumeProven` was flipped.
- **P3:** promotion is gated by `promotion.promotionRequires` (v2 declares
  `V2_OWNED_WORKTREE_REVIEW_APPROVED`, unproven), enforced in `hermes-kernel-client.mjs`
  (`RESIDENT_MODEL_LANE_PROMOTION_UNPROVEN`) and the invoker
  (`HERMES_FREE_AGENT_PROMOTION_EVIDENCE_WALL`) whenever a policy claims `PROMOTED`. v1's
  `INDEPENDENT_REVIEW_APPROVED` (2026-08-13) predates this mode and deliberately does not gate it.
  Granting promotion = set that line + flip the status; see the review packet.

## 7. Testing (P1)

`tests/hermes-kernel-client.test.ts` (fake commandRunner, temp runtimeRoot):
- exposes exactly the `CodexAppServerClient` surface used by the orchestrator (function identity
  check as in S1's tests).
- `connect` fails closed on: quarantine marker, wrong workspaceMode, workspace outside roots,
  symlinked component.
- `startThread` → UUID, session file; `resumeThread` fail-closed by default; ok when
  `sessionResumeProven` and state present; refuses a different workspace.
- `runTurn`: packet exact field set + verbatim prompt + epilogue with the schema; invoker args
  exact; harvest last json block; each error row of §5 mapped to the right class/code;
  stdout sanitised; session appended.
- `harvestTurnOutput` unit table.
- `execution-backend` test: `WILLIAMOS_EXECUTOR=resident-model` → backend returns a kernel
  client; S1's not-implemented error is gone; other selectors unchanged.
- Orchestrator: existing `hermes-bridge-orchestrator` suite untouched (client is injected there);
  one new test drives a full `cycle()` through the fake kernel client (reuse the continuity
  fixture shape) to prove `finalText` flows into `validatedTurnResult`.

CI: all deterministic; the invoker (PowerShell/Docker) is never executed in tests.

## 8. Out of scope (YAGNI)

Image/runner rebuild; SEA/CAPG changes (kernel-internal, T2 program); multi-kernel placement;
provider health/telemetry surfaces; any Ollama-direct path; changing Codex lane behaviour.

## 9. Open questions

None blocking P1. P2 will answer: does the pinned runner (`/opt/runner/run_agent.py`) resume a
session from a mounted state dir? (Default answer built in: no → fail-closed resume.)
