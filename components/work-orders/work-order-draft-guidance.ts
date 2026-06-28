export type WorkOrderDraftChecklistItem = {
  title: string
  description: string
}

export function getWorkOrderDraftChecklist(): WorkOrderDraftChecklistItem[] {
  return [
    {
      title: "Outcome first",
      description: "Name the business result before choosing files or validators.",
    },
    {
      title: "Bound the lane",
      description: "List allowed files, forbidden files, and non-goals so scope drift is visible.",
    },
    {
      title: "Prove closure",
      description: "Add validators and acceptance criteria that can be checked before review.",
    },
    {
      title: "Keep authority separate",
      description: "Drafting records intent only; approval, execution, commit, push, and release remain gated.",
    },
  ]
}
