import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("active program queue header", () => {
  it("aligns selected program metadata across program, goal, loop, and risk", () => {
    const queue = readFileSync("docs/governance/active-program-queue.md", "utf8")

    expect(queue).toContain("Active program: `PROGRAM-PROPERTY-WORKBENCH-001 - Property Workbench`")
    expect(queue).toContain("Goal: `GOAL-PROPERTY-WORKBENCH-001`")
    expect(queue).toContain("Loop: `LOOP-PROPERTY-WORKBENCH-001`")
    expect(queue).toContain("Risk ceiling: `R1` for static/read-only Property Workbench foundation")
    expect(queue).not.toContain("Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Risk ceiling: `R3` for control-plane implementation")
  })
})
