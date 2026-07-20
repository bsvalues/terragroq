import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("active program queue header", () => {
  it("keeps the queue inactive after MAO closure until a WilliamOS-native lane is activated", () => {
    const queue = readFileSync("docs/governance/active-program-queue.md", "utf8")

    expect(queue).toContain("Active program: `NO_ACTIVE_PROGRAM`")
    expect(queue).toContain("Goal: `NO_ACTIVE_GOAL`")
    expect(queue).toContain("Loop: `NO_ACTIVE_LOOP`")
    expect(queue).toContain("Risk ceiling: `NONE` until the next WilliamOS-native program is deliberately activated")
    expect(queue).toContain("PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")
    expect(queue).toContain("Property Workbench/TerraPilot/county placeholder programs are owner-gated and nonselectable")
    expect(queue).not.toContain("Active program: `PROGRAM-PROPERTY-WORKBENCH-001")
    expect(queue).not.toContain("Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Risk ceiling: `R3` for control-plane implementation")
  })
})
