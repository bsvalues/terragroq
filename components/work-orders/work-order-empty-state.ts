export type WorkOrderEmptyStateStep = {
  title: string
  description: string
}

export function getWorkOrderEmptyStateSteps(): WorkOrderEmptyStateStep[] {
  return [
    {
      title: "Draft the contract",
      description:
        "Define scope, forbidden files, validators, evidence requirements, and stop conditions before governed work starts.",
    },
    {
      title: "Keep authority explicit",
      description:
        "New Work Orders start as drafts; owner approval and execution authority stay separate gates.",
    },
    {
      title: "Record evidence",
      description:
        "Validation, review, and closure evidence should be attached before a Work Order closes.",
    },
  ]
}
