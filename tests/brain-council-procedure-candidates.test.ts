import { describe, expect, it } from "vitest"
import { getBrainCouncilProcedureCandidates } from "@/components/brain-council/brain-council-procedure-candidates"

describe("Brain Council procedure candidates", () => {
  it("shows repeated procedures as inactive candidates", () => {
    const set = getBrainCouncilProcedureCandidates()

    expect(set.summary.total).toBe(3)
    expect(set.summary.candidates).toBe(2)
    expect(set.summary.needsEvidence).toBe(1)
    expect(set.summary.active).toBe(0)
  })

  it("requires evidence and a blocked-until condition for each candidate", () => {
    const set = getBrainCouncilProcedureCandidates()

    expect(set.candidates.every((candidate) => candidate.evidence.length > 0)).toBe(true)
    expect(set.candidates.every((candidate) => candidate.blockedUntil.length > 0)).toBe(true)
    expect(set.candidates.every((candidate) => candidate.activationStatus === "inactive")).toBe(true)
  })

  it("does not activate Hermes or any procedure runtime", () => {
    const set = getBrainCouncilProcedureCandidates()

    expect(set.safety.readOnly).toBe(true)
    expect(set.safety.wouldExecute).toBe(false)
    expect(set.safety.activationEnabled).toBe(false)
    expect(set.safety.hermesRuntimeEnabled).toBe(false)
    expect(set.safety.productionWrite).toBe(false)
  })
})
