export type BrainCouncilHermesActivationChecklistItem = {
  label: string
  complete: boolean
}

export type BrainCouncilHermesActivationChecklistExport = {
  posture: "HERMES_ACTIVATION_CHECKLIST_EXPORT_PREVIEW"
  items: BrainCouncilHermesActivationChecklistItem[]
  exportText: string
  safety: {
    writesFile: false
    activatesHermes: false
    changesAuthority: false
    dispatchesWorker: false
  }
}

export function getBrainCouncilHermesActivationChecklistExport(): BrainCouncilHermesActivationChecklistExport {
  const items: BrainCouncilHermesActivationChecklistItem[] = [
    { label: "Inventory complete", complete: true },
    { label: "Capability map complete", complete: true },
    { label: "Risk register complete", complete: true },
    { label: "Sandbox requirements complete", complete: true },
    { label: "Skill quarantine complete", complete: true },
    { label: "Experiment plan complete", complete: true },
    { label: "No runtime authority granted", complete: true },
  ]

  const exportText = [
    "Hermes future activation checklist",
    "",
    ...items.map((item) => `- [${item.complete ? "x" : " "}] ${item.label}`),
    "",
    "Current decision: preview only. This checklist does not install, activate, dispatch, or grant authority.",
  ].join("\n")

  return {
    posture: "HERMES_ACTIVATION_CHECKLIST_EXPORT_PREVIEW",
    items,
    exportText,
    safety: {
      writesFile: false,
      activatesHermes: false,
      changesAuthority: false,
      dispatchesWorker: false,
    },
  }
}
