import { describe, expect, it } from "vitest"
import { getHermesWorkerDockPreview } from "@/components/brain-council/hermes-worker-dock"

describe("Hermes Worker Dock preview", () => {
  it("frames Hermes as a governed worker dock preview", () => {
    const dock = getHermesWorkerDockPreview()

    expect(dock.title).toBe("Hermes Worker Dock")
    expect(dock.eyebrow).toBe("Governed Worker Preview")
    expect(dock.posture).toBe("PREVIEW_ONLY")
    expect(dock.description).toContain("governed worker dock preview")
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
  })

  it("does not make provider or runtime vendor claims", () => {
    const dock = getHermesWorkerDockPreview()
    const text = [
      dock.title,
      dock.eyebrow,
      dock.description,
      ...dock.capabilities,
      ...dock.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(/Groq|xAI|AI-powered/)
  })
})
