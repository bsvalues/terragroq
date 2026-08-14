import { describe, expect, it } from "vitest"
import { projectRowsToViews } from "@/lib/projects/project-read-model"
import { readFileSync } from "node:fs"

describe("durable project read model", () => {
  it("projects explicit resources in stable project and resource order", () => {
    const views = projectRowsToViews(
      [
        { id: 2, userId: "primary", key: "williamos", name: "WilliamOS", lifecycle: "active" },
        { id: 1, userId: "primary", key: "terrafusion", name: "TerraFusion OS", lifecycle: "standby" },
      ],
      [
        {
          userId: "primary",
          projectId: 2,
          type: "node",
          canonicalIdentity: "HERMES",
          label: "coordinator",
          relationship: "coordinator",
        },
        {
          userId: "primary",
          projectId: 2,
          type: "repo",
          canonicalIdentity: "bsvalues/terragroq",
          label: "WilliamOS repo",
          relationship: "primary-repo",
        },
      ],
      "primary",
    )

    expect(views).toEqual([
      {
        key: "terrafusion",
        name: "TerraFusion OS",
        lifecycle: "standby",
        resources: [],
      },
      {
        key: "williamos",
        name: "WilliamOS",
        lifecycle: "active",
        resources: [
          {
            type: "node",
            canonicalIdentity: "HERMES",
            label: "coordinator",
            relationship: "coordinator",
          },
          {
            type: "repo",
            canonicalIdentity: "bsvalues/terragroq",
            label: "WilliamOS repo",
            relationship: "primary-repo",
          },
        ],
      },
    ])
  })

  it("fails closed across tenant and orphan project boundaries", () => {
    const views = projectRowsToViews(
      [
        { id: 1, userId: "primary", key: "williamos", name: "WilliamOS", lifecycle: "active" },
        { id: 2, userId: "other", key: "other", name: "Other", lifecycle: "active" },
      ],
      [
        {
          userId: "other",
          projectId: 1,
          type: "database",
          canonicalIdentity: "foreign-db",
          label: "Foreign",
          relationship: "state",
        },
        {
          userId: "primary",
          projectId: 999,
          type: "service",
          canonicalIdentity: "orphan",
          label: "Orphan",
          relationship: "runtime",
        },
      ],
      "primary",
    )

    expect(views).toEqual([
      { key: "williamos", name: "WilliamOS", lifecycle: "active", resources: [] },
    ])
  })

  it("scopes both durable table queries to the authenticated user", () => {
    const source = readFileSync("lib/projects/load-projects.ts", "utf8")

    expect(source).toContain("eq(project.userId, userId)")
    expect(source).toContain("eq(projectResource.userId, userId)")
  })

  it("feeds the operator envelope from the durable register", () => {
    const source = readFileSync("lib/operator/operator-state.ts", "utf8")

    expect(source).toContain("await loadProjects(userId)")
    expect(source).toContain('"project + project_resource"')
    expect(source).not.toContain("const PROJECTS")
    expect(source).not.toContain("modelled registry (project_resource tables pending, P1)")
  })

  it("keeps Home resource reconciliation compatible with valid duplicate identities", () => {
    const source = readFileSync("components/home/operator-home.tsx", "utf8")

    expect(source).toContain("key={`${r.type}:${r.canonicalIdentity}:${r.relationship}`}")
    expect(source).not.toContain("key={r.canonicalIdentity}")
  })
})
