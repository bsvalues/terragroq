export type WorkOrderEmptyStateStep = {
  title: string
  description: string
}

export function getWorkOrderEmptyStateSteps(): WorkOrderEmptyStateStep[] {
  return [
    {
      title: "Draft the contract",
      description: "Define scope, forbidden files, validators, and stop conditions before work starts.",
    },
    {
      title: "Keep authority explicit",
      description: "New work orders start as drafts; approval and execution authority are separate gates.",
    },
    {
      title: "Record evidence",
      description: "Validation, review, and closure evidence should be attached before a work order closes.",
    },
  ]
}
