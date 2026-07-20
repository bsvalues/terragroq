import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("active program queue header", () => {
  it("activates owner outcome delivery after WOE detail surfaces completion", () => {
    const queue = readFileSync("docs/governance/active-program-queue.md", "utf8")
    const program = readFileSync("docs/governance/owner-outcome-delivery-program.md", "utf8")

    expect(queue).toContain("Active program: `PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Goal: `GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Loop: `LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001`")
    expect(queue).toContain("Risk ceiling: `R1`")
    expect(queue).toContain("WO-OWNER-OUTCOME-001 - Current Continuation Dead-End Reconciliation")
    expect(queue).toContain("DO_NOT_RETURN_TO_NO_ACTIVE_PROGRAM_WHILE_APPROVED_USEFUL_WILLIAMOS_R0_R1_WORK_REMAINS")
    expect(queue).toContain("PROGRAM-WILLIAMOS-WOE-DETAIL-SURFACES-001")
    expect(queue).toContain("Property Workbench/TerraPilot/county placeholders remain owner-gated and nonselectable")
    expect(queue).not.toContain("Active program: `PROGRAM-PROPERTY-WORKBENCH-001")
    expect(queue).not.toContain("Active program: `NO_ACTIVE_PROGRAM`")
    expect(program).toContain("Status: `SELECTED / ACTIVE CANDIDATE`")
    expect(program).toContain("governance-only completion is insufficient")
    expect(program).toContain("must not return to `NO_ACTIVE_PROGRAM`")
  })
})
