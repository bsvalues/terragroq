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
