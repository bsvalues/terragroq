import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"

const workbenchSource = readFileSync("components/workbench/workbench-shell.tsx", "utf8")
const pageSource = readFileSync("app/(shell)/projects/page.tsx", "utf8")

describe("Projects workspace", () => {
  it("renders durable project rows and explicit resource bindings", () => {
    expect(workbenchSource).toContain("projects.map")
    expect(workbenchSource).toContain("project.resources")
    expect(workbenchSource).toContain("resource.relationship")
    expect(workbenchSource).not.toContain("BS County Values")
  })

  it("renders a truthful empty state without inventing project placeholders", () => {
    expect(workbenchSource).toContain("No explicitly bound Threads")
    expect(workbenchSource).toContain("not used to invent membership")
  })

  it("keeps contextual cockpit routes and the read-only authority boundary", () => {
    expect(supportingCapabilities.map((capability) => capability.href)).toEqual(expect.arrayContaining([
      "/work-orders",
      "/audit",
      "/runtime?detail=technical",
      "/brain-council",
    ]))
    expect(workbenchSource).toContain("No generic shell authority")
  })

  it("loads the authenticated operator read model instead of a static registry", () => {
    expect(pageSource).toContain("return null")
    expect(workbenchSource).toContain("getWorkbenchThreads(selectedProject.id)")
    expect(workbenchSource).not.toContain("getProjectsWorkspace")
  })
})
