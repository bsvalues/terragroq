import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const panelSource = readFileSync("components/projects/projects-workspace-panel.tsx", "utf8")
const pageSource = readFileSync("app/(shell)/projects/page.tsx", "utf8")

describe("Projects workspace", () => {
  it("renders durable project rows and explicit resource bindings", () => {
    expect(panelSource).toContain("projects.value.map")
    expect(panelSource).toContain("project.resources.map")
    expect(panelSource).toContain("resource.canonicalIdentity")
    expect(panelSource).toContain("resource.relationship")
    expect(panelSource).toContain("Source: {projects.source}")
    expect(panelSource).not.toContain("BS County Values")
    expect(panelSource).not.toContain("No current TerraFusion deployment status")
  })

  it("renders a truthful empty state without inventing project placeholders", () => {
    expect(panelSource).toContain("No durable projects are registered")
    expect(panelSource).toContain("Ambiguous records remain unassigned")
  })

  it("keeps contextual cockpit routes and the read-only authority boundary", () => {
    for (const href of ["/work-orders", "/audit", "/runtime", "/brain-council"]) {
      expect(panelSource).toContain(`href: "${href}"`)
    }
    expect(panelSource).toContain("Projects is read-only")
    expect(panelSource).toContain("does not infer project membership")
  })

  it("loads the authenticated operator read model instead of a static registry", () => {
    expect(pageSource).toContain("await getOperatorState()")
    expect(pageSource).toContain("projects={state.projects}")
    expect(pageSource).not.toContain("getProjectsWorkspace")
  })
})
