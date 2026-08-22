import { describe, expect, it } from "vitest"

import {
  findWorkbenchActions,
  workbenchActionRegistry,
} from "@/lib/intent/workbench-action-registry"

describe("Workbench shared action registry", () => {
  it("keeps the four primary modes and every contextual capability discoverable", () => {
    expect(workbenchActionRegistry.filter((action) => action.kind === "mode").map((action) => action.label)).toEqual([
      "Home", "Activity", "System",
    ])
    expect(workbenchActionRegistry.filter((action) => action.kind === "capability").map((action) => action.label)).toEqual([
      "Work Orders", "Council", "Knowledge", "Evidence", "Authority", "Trace",
      "Hermes", "Forge", "Goal Console", "Workroom", "Lab", "Raw Runtime",
    ])
  })

  it("gives every capability a real id, so a new surface cannot become capability.undefined", () => {
    // Ids come from an explicit label lookup, so adding a capability without adding its id yields
    // "capability.undefined" -- discoverable in the registry but broken everywhere it is keyed.
    for (const action of workbenchActionRegistry) {
      expect(action.id).not.toContain("undefined")
    }
  })

  it("uses the same bounded lookup for primary and contextual actions", () => {
    // Projects is no longer a mode: project selection lives in the Environment's project surface.
    expect(findWorkbenchActions("project").map((action) => action.id)).not.toContain("mode.projects")
    expect(findWorkbenchActions("proof").map((action) => action.id)).toContain("capability.evidence")
    expect(findWorkbenchActions("technical runtime").map((action) => action.id)).toContain("capability.raw-runtime")
    expect(findWorkbenchActions("x".repeat(201))).toEqual([])
  })
})
