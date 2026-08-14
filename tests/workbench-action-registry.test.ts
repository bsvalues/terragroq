import { describe, expect, it } from "vitest"

import {
  findWorkbenchActions,
  workbenchActionRegistry,
} from "@/lib/intent/workbench-action-registry"

describe("Workbench shared action registry", () => {
  it("keeps the four primary modes and every contextual capability discoverable", () => {
    expect(workbenchActionRegistry.filter((action) => action.kind === "mode").map((action) => action.label)).toEqual([
      "Home", "Projects", "Activity", "System",
    ])
    expect(workbenchActionRegistry.filter((action) => action.kind === "capability").map((action) => action.label)).toEqual([
      "Work Orders", "Council", "Knowledge", "Evidence", "Authority", "Trace",
      "Hermes", "Forge", "Goal Console", "Raw Runtime",
    ])
  })

  it("uses the same bounded lookup for primary and contextual actions", () => {
    expect(findWorkbenchActions("project").map((action) => action.id)).toContain("mode.projects")
    expect(findWorkbenchActions("proof").map((action) => action.id)).toContain("capability.evidence")
    expect(findWorkbenchActions("technical runtime").map((action) => action.id)).toContain("capability.raw-runtime")
    expect(findWorkbenchActions("x".repeat(201))).toEqual([])
  })
})
