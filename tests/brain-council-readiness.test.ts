import { describe, expect, it } from "vitest"
import { getBrainCouncilReadinessEvaluation } from "@/components/brain-council/brain-council-readiness"

describe("Brain Council readiness evaluator", () => {
  it("marks the current reasoning packet safe for operator review", () => {
    const evaluation = getBrainCouncilReadinessEvaluation()

    expect(evaluation.verdict).toBe("SAFE_FOR_OPERATOR_REVIEW")
    expect(evaluation.confidence).toBeGreaterThan(0.8)
    expect(evaluation.nextGate).toContain("Experiment Dashboard")
  })

  it("requires all core reasoning checks", () => {
    const evaluation = getBrainCouncilReadinessEvaluation()

    expect(evaluation.checks.map((check) => check.id)).toEqual([
      "question",
      "evidence",
      "unknowns",
      "hypotheses",
      "verification",
      "safety",
    ])
    expect(evaluation.checks.every((check) => check.status === "pass")).toBe(true)
  })

  it("does not convert readiness into authority", () => {
    const evaluation = getBrainCouncilReadinessEvaluation()

    expect(evaluation.safety.readOnly).toBe(true)
    expect(evaluation.safety.wouldExecute).toBe(false)
    expect(evaluation.safety.autonomyEnabled).toBe(false)
    expect(evaluation.safety.mcpActivation).toBe(false)
    expect(evaluation.safety.productionWrite).toBe(false)
    expect(evaluation.blockedActions).toContain("dispatch workers")
  })
})
