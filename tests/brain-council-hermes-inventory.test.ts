import { describe, expect, it } from "vitest"
import { getHermesFilesInventory } from "@/components/brain-council/brain-council-hermes-inventory"

describe("Hermes files inventory", () => {
  it("presents Hermes files as reference-only input", () => {
    const inventory = getHermesFilesInventory()

    expect(inventory.posture).toBe("REFERENCE_ONLY_NOT_INSTALLED")
    expect(inventory.sourceRoots).toContain("C:/Users/bsval/williamos-agent-forge-v1.5-readiness-evaluator")
    expect(inventory.items.length).toBeGreaterThanOrEqual(6)
  })

  it("keeps Hermes non-executable and inactive", () => {
    const inventory = getHermesFilesInventory()

    expect(inventory.safety).toEqual({
      readOnly: true,
      installedHermes: false,
      executedHermes: false,
      activatedMcp: false,
      enabledAutonomy: false,
      productionWrite: false,
    })
  })

  it("records boundary language for every inventory item", () => {
    const inventory = getHermesFilesInventory()

    expect(inventory.items.every((item) => item.boundary.length > 20)).toBe(true)
    expect(inventory.items.map((item) => item.id)).toContain("activation-ledger")
  })
})
