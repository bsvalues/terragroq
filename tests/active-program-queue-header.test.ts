import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("active program queue header", () => {
  it("keeps the queue inactive after WOE detail surfaces completion", () => {
    const queue = readFileSync("docs/governance/active-program-queue.md", "utf8")
    const goalRegistry = readFileSync("docs/governance/goal-registry.md", "utf8")
    const loopRegistry = readFileSync("docs/governance/loop-registry.md", "utf8")

    expect(queue).toContain("Active program: `NO_ACTIVE_PROGRAM`")
    expect(queue).toContain("Goal: `NO_ACTIVE_GOAL`")
    expect(queue).toContain("Loop: `NO_ACTIVE_LOOP`")
    expect(goalRegistry).toContain("### `NO_ACTIVE_PROGRAM - Awaiting WilliamOS-Native Selection`")
    expect(goalRegistry).toContain("Loop: `NO_ACTIVE_LOOP`")
    expect(goalRegistry).toContain("### `GOAL-WOE-DETAIL-SURFACES-001 - Work Order Engine Detail Surfaces`")
    expect(goalRegistry).toContain("Status: `complete / closed evidence`")
    expect(loopRegistry).toContain("### `NO_ACTIVE_LOOP`")
    expect(loopRegistry).toContain("Goal: `NO_ACTIVE_GOAL`")
    expect(loopRegistry).toContain("### `LOOP-WOE-DETAIL-SURFACES-001`")
    expect(loopRegistry).toContain("Status: `complete / closed evidence`")
    expect(queue).toContain("Risk ceiling: `NONE` after completion of the owner-activated WOE Detail Surfaces lane")
    expect(queue).toContain("PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")
    expect(queue).toContain("WO-WILLIAMOS-WOE-DETAIL-SURFACES-003")
    expect(queue).toContain("Property Workbench/TerraPilot/county placeholder programs are owner-gated and nonselectable")
    expect(queue).not.toContain("Active program: `PROGRAM-PROPERTY-WORKBENCH-001")
    expect(queue).not.toContain("Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Risk ceiling: `R3` for control-plane implementation")
  })
})
