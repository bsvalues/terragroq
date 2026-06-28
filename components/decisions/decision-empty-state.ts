export type DecisionEmptyStateStep = {
  id: string
  title: string
  description: string
}

export const DECISION_EMPTY_STATE_STEPS: DecisionEmptyStateStep[] = [
  {
    id: "capture",
    title: "Capture the call",
    description: "Record what was decided, why, and which scope the decision governs.",
  },
  {
    id: "authority",
    title: "Separate authority",
    description: "A decision can document policy, but execution still requires the correct work-order gate.",
  },
  {
    id: "lineage",
    title: "Preserve lineage",
    description: "Supersede decisions instead of overwriting them so rationale and evidence remain auditable.",
  },
]

export function getDecisionEmptyStateSteps(): DecisionEmptyStateStep[] {
  return DECISION_EMPTY_STATE_STEPS
}
