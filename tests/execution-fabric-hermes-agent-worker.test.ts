import { describe, expect, it } from "vitest"

import { assertAgentExecutesPlacedModel, resolveAgentModelBinding } from "../scripts/execution-fabric/hermes-agent-worker.mjs"

// The existing commissioned worker policy (v2).
const workerPolicy = {
  providerId: "hermes-agent-local-qwen-v2",
  runtime: "NousResearch/hermes-agent@fa83af3f9a42790730b8966ff67e7d9fb627899f",
  placement: { controlNode: "omen", executionNode: "hermes-node", composeProject: "williamos-hermes-agent" },
}

describe("Tier 2 — Hermes Agent as a governed Fabric worker runtime", () => {
  it("the agent consumes the Fabric-selected model, not its own fixed default", () => {
    const placement = { selected: { model: { immutableIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" }, compute: { id: "daedalus" }, executionClass: "LOCAL" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    // The model the agent loads is the one the Fabric selected, not the hardcoded local qwen.
    expect(binding.modelBinding).toBe("Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218")
    expect(binding.providerId).toBe("hermes-agent-local-qwen-v2")
  })

  it("the agent can consume an Ollama-bound model (Tier 1) selected by the Fabric", () => {
    const placement = { selected: { model: { immutableIdentity: "williamos-qwen3-14b:64k@201cfcc6a274cdbceeb2752e8508a399f85fa879ec0f3fadd23ef835755c0c02" }, compute: { id: "hermes-node" }, executionClass: "LOCAL", runtimeId: "hermes-ollama" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    expect(binding.modelBinding).toContain("williamos-qwen3-14b:64k@")
    expect(binding.runtimeId).toBe("hermes-ollama")
  })

  it("the agent can consume an external API model (Tier 3) when the Fabric selects one", () => {
    const placement = { selected: { model: { immutableIdentity: "moonshotai/kimi-k3@external-api:v1" }, compute: { id: "openrouter" }, executionClass: "EXTERNAL_MODEL_API" } }
    const binding = resolveAgentModelBinding(placement, workerPolicy)
    expect(binding.executionClass).toBe("EXTERNAL_MODEL_API")
    expect(binding.compute).toBe("openrouter")
  })

  it("the agent executes the exact placed model — a mismatch is refused (fail-closed)", () => {
    const placement = { selected: { model: { immutableIdentity: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" } } }
    const good = { modelBinding: "Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218" }
    const bad = { modelBinding: "Qwen/Qwen3-4B@different" }
    expect(assertAgentExecutesPlacedModel(good, placement).ok).toBe(true)
    const r = assertAgentExecutesPlacedModel(bad, placement)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe("model-mismatch")
  })

  it("no placement decision or no worker policy is refused", () => {
    expect(() => resolveAgentModelBinding(null, workerPolicy)).toThrow(/NO_PLACEMENT_DECISION/)
    expect(() => resolveAgentModelBinding({ selected: {} }, null)).toThrow(/NO_WORKER_POLICY/)
    expect(() => resolveAgentModelBinding({ selected: {} }, workerPolicy)).toThrow(/PLACEMENT_HAS_NO_MODEL_BINDING/)
  })
})
