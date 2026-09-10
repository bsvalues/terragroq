import { describe, expect, it } from "vitest"

import { absorbReroute, projectTechnicalView, projectThreadState } from "../scripts/execution-fabric/environment-integration.mjs"

const placementDecision = {
  id: "pd-1",
  reason: "Selected daedalus-qwen: highest score among 2 eligible candidates.",
  selected: { candidateId: "daedalus-qwen" },
  considered: [
    { candidateId: "daedalus-qwen", eligible: true },
    { candidateId: "omen-qwen", eligible: false },
  ],
}
const execution = { id: "exec-1", model: "Qwen/Qwen3-8B", runtime: "daedalus-hf-transformers", compute: "daedalus" }
const optimizerChoice = { rationale: "Local preferred: daedalus-qwen value 0.92 within burst threshold." }

describe("IF-12 Thread-level human state (required path)", () => {
  it("a synthetic-owner job succeeds without infrastructure vocabulary", () => {
    const view = projectThreadState({ status: "done", outcomeSummary: "The 39-county digest is ready." })
    expect(view.state).toBe("done")
    expect(view.message).toBe("The 39-county digest is ready.")
    expect(view.infrastructureVisible).toBe(false)
    // no model/provider/GPU/runtime words leak into the human message
    expect(view.message).not.toMatch(/qwen|gpu|ollama|provider|model|runtime|vram|daedalus|omen/i)
  })

  it("a running job shows a plain working message, no machinery", () => {
    const view = projectThreadState({ status: "running" })
    expect(view.state).toBe("running")
    expect(view.message).toBe("Working on it.")
    expect(view.infrastructureVisible).toBe(false)
  })

  it("the required path has no model picker and no provider-specific conversation", () => {
    const view = projectThreadState({ status: "running" })
    expect(Object.keys(view)).not.toContain("modelPicker")
    expect(Object.keys(view)).not.toContain("providerConversation")
    expect(view.infrastructureVisible).toBe(false)
  })
})

describe("IF-12 reroute does not steal focus", () => {
  it("a provider/model switch does not open panes or navigate", () => {
    const running = projectThreadState({ status: "running" })
    const after = absorbReroute(running)
    expect(after.state).toBe("running") // same job, still running
    expect(after.focusEvent).toBeNull() // no navigation / focus theft
  })

  it("a reroute on a completed job stays done and never navigates", () => {
    const done = projectThreadState({ status: "done", outcomeSummary: "Ready." })
    const after = absorbReroute(done)
    expect(after.state).toBe("done")
    expect(after.focusEvent).toBeNull()
  })
})

describe("IF-12 Technical/Execution projection (provenance on demand)", () => {
  it("the owner can inspect provenance after completion", () => {
    const tech = projectTechnicalView(placementDecision, execution, optimizerChoice)
    expect(tech.visible).toBe(true)
    expect(tech.selected.model).toBe("Qwen/Qwen3-8B")
    expect(tech.selected.compute).toBe("daedalus")
    expect(tech.placementRationale).toMatch(/daedalus-qwen/)
    expect(tech.optimizerRationale).toMatch(/Local preferred/)
    expect(tech.provenance.placementDecisionId).toBe("pd-1")
  })

  it("the technical view reports considered and refused candidates", () => {
    const tech = projectTechnicalView(placementDecision, execution, optimizerChoice)
    expect(tech.consideredCount).toBe(2)
    expect(tech.refusedCount).toBe(1)
  })

  it("provenance is available in the thread state but not shown until asked", () => {
    const view = projectThreadState({ status: "done" })
    expect(view.provenanceAvailable).toBe(true)
    expect(view.infrastructureVisible).toBe(false)
  })
})
