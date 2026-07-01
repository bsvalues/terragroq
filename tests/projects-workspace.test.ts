import { describe, expect, it } from "vitest"
import { getProjectsWorkspace } from "@/components/projects/projects-workspace"

describe("Projects workspace", () => {
  it("frames projects as systems inside WilliamOS", () => {
    const workspace = getProjectsWorkspace()

    expect(workspace.title).toBe("Projects")
    expect(workspace.description).toContain("governed systems under WilliamOS command")
    expect(workspace.description).toContain("without becoming task boards")
    expect(workspace.postureSummary).toEqual([
      expect.objectContaining({
        label: "Systems",
        value: "under command",
      }),
      expect.objectContaining({
        label: "Primary review",
        value: "required",
      }),
      expect.objectContaining({
        label: "Execution",
        value: "not available",
      }),
    ])
  })

  it("shows project context as organized, evidence-bound, and governed", () => {
    const workspace = getProjectsWorkspace()

    expect(workspace.commandStates).toEqual([
      expect.objectContaining({
        label: "Context",
        state: "Organized",
      }),
      expect.objectContaining({
        label: "Evidence",
        state: "Required",
      }),
      expect.objectContaining({
        label: "Next Move",
        state: "Governed",
      }),
    ])
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
    expect(workspace.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Project execution",
        state: "Disabled",
      }),
      expect.objectContaining({
        label: "Data",
        state: "No mutation",
      }),
      expect.objectContaining({
        label: "Authority",
        state: "Primary gated",
      }),
    ])
  })

  it("avoids project-management, collaboration, and automation language", () => {
    const workspace = getProjectsWorkspace()
    const text = [
      workspace.title,
      workspace.eyebrow,
      workspace.description,
      ...workspace.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...workspace.commandStates.flatMap((item) => [item.label, item.state, item.description]),
      ...workspace.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...workspace.projects.flatMap((project) => [
        project.name,
        project.currentFocus,
        project.latestWorkOrder,
        project.latestEvidence,
        project.deploymentPosture,
        project.blockedDecision,
        project.nextRecommendedWork,
      ]),
      ...workspace.links.flatMap((link) => [link.label, link.description]),
    ].join(" ")

    expect(text).not.toMatch(/team workspace|project management|assign tasks|collaborate with your team|launch automation|AI-powered planning|boost productivity/i)
  })
})
