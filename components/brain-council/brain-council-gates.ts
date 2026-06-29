import gateScoreboard from "@/brain-council/GATE_SCOREBOARD.json"

export type BrainCouncilGateExplanation = {
  gate: string
  status: string
  authority: string
  category: "complete" | "inactive" | "review"
  explanation: string
}

function explainGate(gate: { gate: string; status: string; authority: string }): BrainCouncilGateExplanation {
  if (gate.status === "PASS") {
    return {
      ...gate,
      category: "complete",
      explanation: "This setup or verification gate has completed.",
    }
  }

  if (gate.status === "NOT_AUTHORIZED") {
    return {
      ...gate,
      category: "inactive",
      explanation: "This gate is intentionally inactive until the owner grants explicit authority.",
    }
  }

  return {
    ...gate,
    category: "review",
    explanation: "This gate remains available for review but is not required for runtime activation.",
  }
}

export function getBrainCouncilGateExplanations(): BrainCouncilGateExplanation[] {
  return gateScoreboard.gates.map(explainGate)
}

export function summarizeBrainCouncilGates() {
  const gates = getBrainCouncilGateExplanations()

  return {
    complete: gates.filter((gate) => gate.category === "complete").length,
    inactive: gates.filter((gate) => gate.category === "inactive").length,
    review: gates.filter((gate) => gate.category === "review").length,
    gates,
  }
}
