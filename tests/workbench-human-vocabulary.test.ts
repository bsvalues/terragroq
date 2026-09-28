import { describe, expect, it } from "vitest"

import { humanMessage, leaksInfrastructureVocabulary } from "@/lib/workbench/human-vocabulary"

describe("IF-12 wired: owner-facing vocabulary guard", () => {
  it("detects infrastructure vocabulary that must never reach the owner", () => {
    expect(leaksInfrastructureVocabulary("Placed on daedalus via Qwen3-8B on the GPU runtime.")).toBe(true)
    expect(leaksInfrastructureVocabulary("Rerouted to the codex worker lane after a provider rate limit.")).toBe(true)
    expect(leaksInfrastructureVocabulary("The 39-county digest is ready.")).toBe(false)
    expect(leaksInfrastructureVocabulary("Working on it.")).toBe(false)
  })

  it("a message that leaks Fabric vocabulary is replaced with a human fallback", () => {
    expect(humanMessage("Placed on daedalus via Qwen3-8B on the GPU runtime.", "Done.")).toBe("Done.")
    expect(humanMessage("Rerouted to omen through the codex provider.", "Working on it.")).toBe("Working on it.")
  })

  it("a clean human message passes through unchanged", () => {
    expect(humanMessage("The 39-county digest is ready.", "Done.")).toBe("The 39-county digest is ready.")
  })

  it("an empty or missing message falls back", () => {
    expect(humanMessage("", "Done.")).toBe("Done.")
    expect(humanMessage(undefined, "Working on it.")).toBe("Working on it.")
  })
})
