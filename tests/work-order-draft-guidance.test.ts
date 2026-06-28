import { describe, expect, it } from "vitest"
import { getWorkOrderDraftChecklist } from "@/components/work-orders/work-order-draft-guidance"

describe("work order draft guidance", () => {
  it("guides draft creation without implying execution authority", () => {
    const checklist = getWorkOrderDraftChecklist()
    const text = checklist.map((item) => `${item.title} ${item.description}`).join(" ")

    expect(checklist.map((item) => item.title)).toEqual([
      "Outcome first",
      "Bound the lane",
      "Prove closure",
      "Keep authority separate",
    ])
    expect(text).toContain("validators")
    expect(text).toContain("acceptance criteria")
    expect(text).toContain("approval")
    expect(text).toContain("execution")
  })

  it("keeps every checklist item operator-readable", () => {
    const checklist = getWorkOrderDraftChecklist()

    expect(checklist).toHaveLength(4)
    expect(checklist.every((item) => item.title.trim().length > 0)).toBe(true)
    expect(checklist.every((item) => item.description.trim().length > 20)).toBe(true)
  })
})
