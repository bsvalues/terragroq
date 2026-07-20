import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("active program queue header", () => {
  it("activates owner outcome delivery after WOE detail surfaces completion", () => {
    const queue = readFileSync("docs/governance/active-program-queue.md", "utf8")
    const goalRegistry = readFileSync("docs/governance/goal-registry.md", "utf8")
    const loopRegistry = readFileSync("docs/governance/loop-registry.md", "utf8")

    expect(queue).toContain("Active program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Risk ceiling: `R1`")
    expect(queue).toContain("WO-OWNER-OUTCOME-009")
    expect(goalRegistry).toContain("GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")
    expect(goalRegistry).toContain("PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")
    expect(goalRegistry).toContain("LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")
    expect(goalRegistry).toContain("### `GOAL-WOE-DETAIL-SURFACES-001 - Work Order Engine Detail Surfaces`")
    expect(goalRegistry).toContain("Status: `complete / closed evidence`")
    expect(loopRegistry).toContain("LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")
    expect(loopRegistry).toContain("GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001")
    expect(loopRegistry).toContain("WO-OWNER-OUTCOME-009")
    expect(loopRegistry).toContain("### `LOOP-WOE-DETAIL-SURFACES-001`")
    expect(loopRegistry).toContain("Status: `complete / closed evidence`")
    expect(queue).toContain("PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")
    expect(queue).toContain("WO-WILLIAMOS-WOE-DETAIL-SURFACES-003")
    expect(queue).toContain("Property Workbench, TerraPilot, and county runtime readiness are owner-gated and")
    expect(queue).toContain("nonselectable from the WilliamOS queue")
    expect(queue).not.toContain("Active program: `PROGRAM-PROPERTY-WORKBENCH-001")
    expect(queue).not.toContain("Active program: `PROGRAM-TERRAPILOT-LIVE-001")
    expect(queue).not.toContain("Active program: `PROGRAM-COUNTY-RUNTIME-READINESS-001")
    expect(queue).not.toContain("Active program: `NO_ACTIVE_PROGRAM`")
    expect(queue).not.toContain("Goal: `GOAL-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Loop: `LOOP-WOS-MULTI-AGENT-OPERATOR-001`")
    expect(queue).not.toContain("Risk ceiling: `R3` for control-plane implementation")
  })
})
