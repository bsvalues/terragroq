import { describe, expect, it } from "vitest"

import {
  assertAgentExecutesPlacedModel,
  placementDecisionFromFabric,
  resolveAgentModelBinding,
} from "../scripts/execution-fabric/hermes-agent-worker.mjs"
import { buildKernelPacket } from "../scripts/hermes-bridge/hermes-kernel-client.mjs"

// The commissioned worker policy shape (v2), including the Tier 2 qualified roster.
const workerPolicy = {
  providerId: "hermes-agent-local-qwen-v2",
  runtime: "NousResearch/hermes-agent@fa83af3f9a42790730b8966ff67e7d9fb627899f",
  placement: { controlNode: "omen", executionNode: "hermes-node", composeProject: "williamos-hermes-agent" },
  modelRoster: [
    { modelIdentity: "williamos-qwen3-4b:64k@fabric:commissioned-v1", alias: "williamos-qwen3-4b:64k", runtimeId: "hermes-ollama", computeId: "hermes-node", executionClass: "LOCAL" },
    { modelIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218", alias: "Qwen3-8B", runtimeId: "daedalus-hf-transformers", computeId: "daedalus", executionClass: "LOCAL" },
  ],
}

describe("Tier 2 — Hermes Agent as a governed Fabric worker runtime", () => {
  it("the agent consumes the Fabric-selected model, not its own fixed default", () => {
    const placement = { selected: { model: { immutableIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" }, runtimeId: "daedalus-hf-transformers", compute: { id: "daedalus" }, executionClass: "LOCAL" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    expect(binding.modelBinding).toBe("Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218")
    expect(binding.modelAlias).toBe("Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218".split("@")[0])
    expect(binding.providerId).toBe("hermes-agent-local-qwen-v2")
  })

  it("the agent can consume an Ollama-bound model (Tier 1) selected by the Fabric", () => {
    const placement = { selected: { model: { immutableIdentity: "williamos-qwen3-14b:64k@201cfcc6a274cdbceeb2752e8508a399f85fa879ec0f3fadd23ef835755c0c02" }, compute: { id: "hermes-node" }, executionClass: "LOCAL", runtimeId: "hermes-ollama" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    expect(binding.modelBinding).toContain("williamos-qwen3-14b:64k@")
    expect(binding.runtimeId).toBe("hermes-ollama")
  })

  it("the agent can consume an external API model (Tier 3) when the Fabric selects one", () => {
    const placement = { selected: { model: { immutableIdentity: "moonshotai/kimi-k3@external-api:v1" }, compute: { id: "openrouter" }, executionClass: "EXTERNAL_MODEL_API", runtimeId: "openrouter-api" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    expect(binding.executionClass).toBe("EXTERNAL_MODEL_API")
    expect(binding.compute).toBe("openrouter")
  })

  it("a model × runtime × compute binding is required in full — incomplete placements fail closed", () => {
    const noRuntime = { selected: { model: { immutableIdentity: "m@r" }, compute: { id: "daedalus" } } }
    expect(() => resolveAgentModelBinding(noRuntime, workerPolicy)).toThrow(/PLACEMENT_INCOMPLETE:no-runtime-binding/)
    const noCompute = { selected: { model: { immutableIdentity: "m@r" }, runtimeId: "daedalus-hf-transformers" } }
    expect(() => resolveAgentModelBinding(noCompute, workerPolicy)).toThrow(/PLACEMENT_INCOMPLETE:no-compute-binding/)
    const noPolicyRuntime = resolveAgentModelBinding.length // sanity
    expect(noPolicyRuntime).toBeGreaterThan(0)
    expect(() => resolveAgentModelBinding({ selected: { model: { immutableIdentity: "m@r" }, runtimeId: "r", compute: { id: "c" } } }, { providerId: "p" })).toThrow(/WORKER_POLICY_INCOMPLETE:no-runtime/)
  })

  it("the agent executes the exact placed model — a mismatch is refused (fail-closed)", () => {
    const placement = { selected: { model: { immutableIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" } } }
    const good = { modelBinding: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" }
    const bad = { modelBinding: "Qwen/Qwen3-4B@different" }
    expect(assertAgentExecutesPlacedModel(good, placement).ok).toBe(true)
    const r = assertAgentExecutesPlacedModel(bad, placement)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("model-mismatch")
    // a malformed invocation returns a structured refusal, never a TypeError
    expect(assertAgentExecutesPlacedModel(null, placement).ok).toBe(false)
    expect(assertAgentExecutesPlacedModel(undefined, placement).reason).toBe("no-invocation-model-binding")
  })

  it("no placement decision or no worker policy is refused", () => {
    expect(() => resolveAgentModelBinding(null, workerPolicy)).toThrow(/NO_PLACEMENT_DECISION/)
    expect(() => resolveAgentModelBinding({ selected: {} }, null)).toThrow(/NO_WORKER_POLICY/)
    expect(() => resolveAgentModelBinding({ selected: {} }, workerPolicy)).toThrow(/PLACEMENT_HAS_NO_MODEL_BINDING/)
  })

  it("the live Fabric recommendation maps through the qualified roster to one exact binding", () => {
    const decision = placementDecisionFromFabric({ recommendation: { recommendation: { node_id: "daedalus" } }, qualifiedBindings: workerPolicy.modelRoster })
    const binding = resolveAgentModelBinding(decision, workerPolicy)
    expect(binding.modelBinding).toBe("Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218")
    expect(binding.compute).toBe("daedalus")
  })

  it("a recommended node with no qualified binding is refused — the worker never improvises a model", () => {
    expect(() => placementDecisionFromFabric({ recommendation: { recommendation: { node_id: "atlas" } }, qualifiedBindings: workerPolicy.modelRoster })).toThrow(/PLACEMENT_INCOMPLETE:no-model-for-node:atlas/)
    expect(() => placementDecisionFromFabric({ recommendation: null })).toThrow(/NO_PLACEMENT_RECOMMENDATION/)
  })

  it("the packet carries the placed model + provenance; the default packet is unchanged", () => {
    const policy = { workOrderId: "WO-TEST", model: { id: "williamos-qwen3-4b:64k" }, execution: { maximumTurns: 20, allowedToolsets: ["file"] } }
    const plain = buildKernelPacket({ policy, prompt: "p", workspacePath: "D:\\w", runId: "r", statePath: "D:\\s" })
    expect(plain.model).toBe("williamos-qwen3-4b:64k")
    expect("placement" in plain).toBe(false)
    const placed = buildKernelPacket({ policy, prompt: "p", workspacePath: "D:\\w", runId: "r", statePath: "D:\\s", placementBinding: { modelAlias: "Qwen3-8B", modelBinding: "Qwen/Qwen3-8B@b968", providerId: "p", runtime: "rt", runtimeId: "daedalus-hf-transformers", compute: "daedalus", executionClass: "LOCAL" } } as any)
    expect(placed.model).toBe("Qwen3-8B")
    expect((placed as any).placement).toEqual({ runtimeId: "daedalus-hf-transformers", computeId: "daedalus", executionClass: "LOCAL" })
    // the immutable identity is NEVER a packet field — only the derived alias + provenance travel
    expect(JSON.stringify(placed)).not.toContain("b968")
  })
})
