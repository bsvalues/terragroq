import { describe, expect, it } from "vitest"
import { getBrainCouncilHermesActivationChecklistExport } from "@/components/brain-council/brain-council-hermes-activation-checklist-export"

describe("Brain Council Hermes activation checklist export", () => {
  it("generates preview checklist text", () => {
    const checklist = getBrainCouncilHermesActivationChecklistExport()

    expect(checklist.posture).toBe("HERMES_ACTIVATION_CHECKLIST_EXPORT_PREVIEW")
    expect(checklist.exportText).toContain("Hermes future activation checklist")
    expect(checklist.exportText).toContain("No runtime authority granted")
  })

  it("includes required activation review milestones", () => {
    const checklist = getBrainCouncilHermesActivationChecklistExport()
    const labels = checklist.items.map((item) => item.label)

    expect(labels).toContain("Inventory complete")
    expect(labels).toContain("Capability map complete")
    expect(labels).toContain("Experiment plan complete")
  })

  it("does not write files or activate Hermes", () => {
    const checklist = getBrainCouncilHermesActivationChecklistExport()

    expect(checklist.safety).toEqual({
      writesFile: false,
      activatesHermes: false,
      changesAuthority: false,
      dispatchesWorker: false,
    })
  })
})
