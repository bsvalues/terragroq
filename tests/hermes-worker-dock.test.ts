import { describe, expect, it } from "vitest"
import { getHermesWorkerDockPreview } from "@/components/brain-council/hermes-worker-dock"

describe("Hermes Worker Dock preview", () => {
  it("frames Hermes as a governed worker dock preview", () => {
    const dock = getHermesWorkerDockPreview()

    expect(dock.title).toBe("Hermes Worker Dock")
    expect(dock.eyebrow).toBe("WilliamOS Worker Dock")
    expect(dock.posture).toBe("PREVIEW_ONLY")
    expect(dock.description).toContain("prepared work packets")
    expect(dock.description).toContain("not active for execution")
    expect(dock.postureSummary).toEqual([
      expect.objectContaining({
        label: "Prepared",
        value: "not active",
      }),
      expect.objectContaining({
        label: "Authority",
        value: "Primary required",
      }),
      expect.objectContaining({
        label: "Evidence",
        value: "required",
      }),
    ])
  })

  it("shows candidate work packets as held until authority is granted", () => {
    const dock = getHermesWorkerDockPreview()

    expect(dock.workPacketStates).toEqual([
      expect.objectContaining({
        label: "Candidate",
        state: "Inspectable",
      }),
      expect.objectContaining({
        label: "Scoped",
        state: "Work Order required",
      }),
      expect.objectContaining({
        label: "Held",
        state: "Awaiting Primary authority",
      }),
    ])
  })

  it("connects Hermes posture to Work Orders, Evidence, Systems, and Brain Council", () => {
    const dock = getHermesWorkerDockPreview()
    const links = new Map(dock.links.map((link) => [link.label, link.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Systems")).toBe("/runtime")
    expect(links.get("Brain Council")).toBe("/brain-council")
  })

  it("keeps Hermes non-executable and inactive", () => {
    const dock = getHermesWorkerDockPreview()

    expect(dock.safety).toEqual({
      readOnly: true,
      executesCommands: false,
      startsWorkers: false,
      dispatchesJobs: false,
      deploys: false,
      grantsAuthority: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(dock.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Runtime",
        state: "Disabled",
      }),
      expect.objectContaining({
        label: "MCP",
        state: "Disabled",
      }),
      expect.objectContaining({
        label: "Production",
        state: "No write",
      }),
    ])
  })

  it("does not make provider or runtime vendor claims", () => {
    const dock = getHermesWorkerDockPreview()
    const text = [
      dock.title,
      dock.eyebrow,
      dock.description,
      ...dock.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...dock.workPacketStates.flatMap((item) => [item.label, item.state, item.description]),
      ...dock.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...dock.capabilities,
      ...dock.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(/Groq|xAI|AI-powered|auto-run|always-on|AI employee/)
  })
})
