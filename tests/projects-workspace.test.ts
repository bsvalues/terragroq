import { describe, expect, it } from "vitest"
import { getProjectsWorkspace } from "@/components/projects/projects-workspace"

describe("Projects workspace", () => {
  it("frames projects as systems inside WilliamOS", () => {
    const workspace = getProjectsWorkspace()

    expect(workspace.title).toBe("Projects")
    expect(workspace.description).toContain("inside WilliamOS")
    expect(workspace.description).toContain("without becoming separate command environments")
  })

  it("includes TerraFusion OS and future project placeholders", () => {
    const workspace = getProjectsWorkspace()
    const names = workspace.projects.map((project) => project.name)

    expect(names).toEqual([
      "TerraFusion OS",
      "BS County Values",
      "CIAPS / Permit Import",
      "RAG Drive",
      "DataSourceBridge",
      "CountyAppraisalHub",
    ])
    expect(workspace.projects[0]).toMatchObject({
      name: "TerraFusion OS",
      posture: "active",
    })
  })

  it("connects project posture to Work Orders, Evidence, Systems, and Brain Council", () => {
    const workspace = getProjectsWorkspace()
    const links = new Map(workspace.links.map((link) => [link.label, link.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Systems")).toBe("/runtime")
    expect(links.get("Brain Council")).toBe("/brain-council")
  })

  it("does not move repos, deploy, write production, mutate data, or activate runtimes", () => {
    const workspace = getProjectsWorkspace()

    expect(workspace.safety).toEqual({
      readOnly: true,
      movesRepos: false,
      deploys: false,
      writesProduction: false,
      mutatesData: false,
      grantsAuthority: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    })
  })
})
