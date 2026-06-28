export type DecisionEmptyStateStep = {
  title: string
  description: string
}

export function getDecisionEmptyStateSteps(): DecisionEmptyStateStep[] {
  return [
    {
      title: "Capture the call",
      description: "Record what was decided, why, and which scope the decision governs.",
    },
    {
      title: "Separate authority",
      description: "A decision can document policy, but execution still requires the correct work-order gate.",
    },
    {
      title: "Preserve lineage",
      description: "Supersede decisions instead of overwriting them so rationale and evidence remain auditable.",
    },
  ]
}
