import { describe, expect, it } from "vitest"
import { getWorkOrderEmptyStateSteps } from "@/components/work-orders/work-order-empty-state"

describe("work order empty state", () => {
  it("explains draft contract, authority, and evidence expectations", () => {
    const steps = getWorkOrderEmptyStateSteps()

    expect(steps.map((step) => step.title)).toEqual([
      "Draft the contract",
      "Keep authority explicit",
      "Record evidence",
    ])
    expect(steps.some((step) => step.description.includes("authority"))).toBe(true)
    expect(steps.every((step) => step.description.length > 0)).toBe(true)
  })
})
