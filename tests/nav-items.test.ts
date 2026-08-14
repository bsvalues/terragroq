import { describe, expect, it } from "vitest"
import { WORKBENCH_TOOLS } from "@/lib/workbench/workbench-model"

describe("workbench capability access", () => {
  it("does not mistake a shortened destination menu for product simplification", () => {
    const hrefs = WORKBENCH_TOOLS.map((tool) => tool.href)
    expect(hrefs).toContain("/work-orders")
    expect(hrefs).toContain("/audit")
    expect(hrefs).toContain("/brain-council")
    expect(hrefs).toContain("/goal-console")
    expect(hrefs).toContain("/chat")
  })

  it("translates capabilities into the five operator verbs plus system detail", () => {
    expect(new Set(WORKBENCH_TOOLS.map((tool) => tool.verb))).toEqual(new Set(["Ask", "Do", "Inspect", "Steer", "System"]))
  })
})
