export type GoalJourneyInput = {
  status: string
  verdict: string
  linkedWorkOrderId?: number | null
}

export type GoalJourneyStep = {
  label: string
  description: string
  action: string
}

export function getGoalJourneyStep(goal: GoalJourneyInput): GoalJourneyStep {
  if (goal.status === "converted" || goal.linkedWorkOrderId) {
    return {
      label: "Work order drafted",
      description: "Continue in Work Orders to review authority, validators, and evidence requirements.",
      action: "Review drafted work order",
    }
  }

  if (goal.status === "dismissed") {
    return {
      label: "Goal dismissed",
      description: "No action remains for this goal. Classify another objective when ready.",
      action: "Classify another goal",
    }
  }

  if (goal.verdict === "refuse") {
    return {
      label: "Safe alternative required",
      description: "Do not execute this objective. Use the recommendation to draft a safer replacement.",
      action: "Rewrite objective",
    }
  }

  if (goal.verdict === "requires_approval") {
    return {
      label: "Approval-gated",
      description: "Convert to a draft work order so authority can be reviewed before any action.",
      action: "Draft gated work order",
    }
  }

  return {
    label: "Ready for work order",
    description: "Convert this classification into a scoped draft before implementation starts.",
    action: "Draft work order",
  }
}
