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

The v2 lane **fails closed until `OWNED_WORKTREE_CONFINEMENT_PROVEN` is set by P2 evidence**: the
policy declares that line in `promotion.requiredEvidence` with a `null` value in
`promotion.satisfiedEvidence`, and both the client (`RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN`) and the
invoker (`HERMES_FREE_AGENT_EVIDENCE_WALL`) refuse to run while any declared line is unproven. That
is the intended shipped state — do not fill the value in to make a run proceed; it is set only by the
P2 live smoke on HERMES.

The invoker also refuses an owned workspace that contains `node_modules` or any top-level reparse
point (`HERMES_FREE_AGENT_WORKSPACE_CONTENT_WALL`), and the client re-asserts the workspace's
`git rev-parse --git-common-dir` after the invocation, walling on a mismatch.

`resumeThread` is fail-closed (`execution.sessionResumeProven: false`) until P2 proves kernel session
continuity; the orchestrator then starts a fresh thread, and owner-decision resumes wall — by design.

P2 (owner-triggered on HERMES): `WILLIAMOS_EXECUTOR=resident-model pnpm hermes:smoke` against a
throwaway outcome on the registered contract; record run id, exit code, harvested JSON, and a diff
confined to reservations under `docs/reports/`. Then the two-turn resume probe.
