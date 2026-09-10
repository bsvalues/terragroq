import { describe, expect, it } from "vitest"

import { bindOllamaRoster, ollamaBindingEligible } from "../scripts/execution-fabric/ollama-runtime.mjs"

// The real commissioned HERMES Ollama roster (from /api/tags, 2026-09-10).
const liveRoster = [
  { name: "williamos-qwen3-14b:64k", digest: "201cfcc6a274cdbceeb2752e8508a399f85fa879ec0f3fadd23ef835755c0c02", sizeBytes: 9.3e9, family: "Qwen3", contextWindow: 65536 },
  { name: "williamos-qwen3-4b:64k", digest: "63d09764f352964a8de7c6960fd7cc80d39810ebc957f1a81fe1bd2b53062c30", sizeBytes: 2.5e9, family: "Qwen3", contextWindow: 65536 },
  { name: "qwen3:14b", digest: "bdbd181c33f2ed1b31c972991882db3cf4d192569092138a7d29e973cd9debe8", sizeBytes: 9.3e9, family: "Qwen3" },
  { name: "snowflake-arctic-embed2:latest", digest: "5de93a84837d0ff00da872e90830df5d973f616cbf1e5c198731ab19dd7b776b", sizeBytes: 1.2e9, family: "Snowflake", modalities: ["EMBEDDING"] },
]

describe("operationalize Ollama as a governed Fabric runtime", () => {
  it("binds the live roster to qualified ModelArtifacts with real digest evidence", () => {
    const artifacts = bindOllamaRoster(liveRoster, { observedAt: "2026-09-10T19:30:00Z" })
    expect(artifacts).toHaveLength(4)
    for (const a of artifacts) {
      expect(a.immutableIdentity).toBe(`${a.repository}@${a.revision}`)
      expect(a.source).toBe("ollama")
      expect(a.revision).not.toMatch(/^0+$/) // real digest, not placeholder
    }
  })

  it("each binding is admitted as a CANDIDATE (must be qualified before promotion)", () => {
    const artifacts = bindOllamaRoster(liveRoster)
    for (const a of artifacts) expect(a.admission).toBe("CANDIDATE")
  })

  it("the commissioned Ollama config is preserved (bound to hermes-ollama, not rebuilt)", () => {
    const artifacts = bindOllamaRoster(liveRoster)
    const qwen14 = artifacts.find((a) => a.repository === "williamos-qwen3-14b:64k")
    expect(qwen14.source).toBe("ollama")
    expect(qwen14.context.maxInputTokens).toBe(65536) // the commissioned 64k window preserved
  })

  it("a binding is placement-eligible only with a real digest, runtime binding, and admission", () => {
    const artifacts = bindOllamaRoster(liveRoster)
    for (const a of artifacts) expect(ollamaBindingEligible(a).eligible).toBe(true)
    // a malformed digest (not full 64-hex) is not eligible
    const fake = { ...artifacts[0], revision: "abc123" }
    expect(ollamaBindingEligible(fake).eligible).toBe(false)
    expect(ollamaBindingEligible(fake).reason).toBe("no-real-digest")
    // a non-ollama source is not eligible
    const wrongSource = { ...artifacts[0], source: "huggingface" }
    expect(ollamaBindingEligible(wrongSource).eligible).toBe(false)
  })

  it("the embedding model binds with the EMBEDDING modality (multimodal tier preserved)", () => {
    const artifacts = bindOllamaRoster(liveRoster)
    const embed = artifacts.find((a) => a.repository === "snowflake-arctic-embed2:latest")
    expect(embed.modalities).toContain("EMBEDDING")
  })

  it("an empty or incomplete roster is refused", () => {
    expect(() => bindOllamaRoster([])).toThrow(/OLLAMA_ROSTER_EMPTY/)
    expect(() => bindOllamaRoster([{ name: "x" }])).toThrow(/OLLAMA_MODEL_INCOMPLETE/)
  })
})
