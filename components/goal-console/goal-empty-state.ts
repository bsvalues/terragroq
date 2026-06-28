export type GoalEmptyStatePrompt = {
  prompt: string
  intent: string
}

export function getGoalEmptyStatePrompts(): GoalEmptyStatePrompt[] {
  return [
    {
      prompt: "Inspect the current dashboard and report active work orders",
      intent: "Safe read-only classification",
    },
    {
      prompt: "Plan the next operator onboarding improvement",
      intent: "Plan-mode goal with no execution",
    },
    {
      prompt: "Verify the audit log renders after the latest merge",
      intent: "Read-only loop verifier candidate",
    },
  ]
}
