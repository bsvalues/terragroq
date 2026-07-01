import { describe, expect, it } from "vitest"
import { getSystemsStatusSurface } from "@/components/systems/systems-status-surface"

describe("Systems status surface", () => {
  it("presents the unified WilliamOS system categories", () => {
    const surface = getSystemsStatusSurface()
    const labels = surface.categories.map((category) => category.label)

    expect(labels).toEqual([
      "WilliamOS Shell",
      "Auth / Readiness",
      "Work Orders",
      "Evidence",
      "Brain Council",
      "Hermes Preview / Worker Dock",
      "Agent Forge / Skills",
      "Access Grants",
      "Memory / Knowledge",
      "Governance / Authority",
      "Deployment / Production Health",
      "TerraFusion OS Project",
    ])
  })

  it("summarizes ready, read-only, preview-only, and disabled posture", () => {
    const surface = getSystemsStatusSurface()
    const summary = new Map(surface.postureSummary.map((item) => [item.label, item]))

    expect(summary.get("Ready")).toMatchObject({
      value: "3 systems",
      tone: "ready",
    })
    expect(summary.get("Read-only")).toMatchObject({
      value: "4 surfaces",
      tone: "read-only",
    })
    expect(summary.get("Preview-only")).toMatchObject({
      value: "1 dock",
      tone: "preview-only",
    })
    expect(summary.get("Disabled")).toMatchObject({
      value: "access grants",
      tone: "disabled",
    })
  })

  it("keeps Brain Council, Hermes, and Access Grants in non-runtime postures", () => {
    const surface = getSystemsStatusSurface()
    const statuses = new Map(surface.categories.map((category) => [category.label, category.status]))

    expect(statuses.get("Brain Council")).toBe("Read-only")
    expect(statuses.get("Hermes Preview / Worker Dock")).toBe("Preview-only")
    expect(statuses.get("Access Grants")).toBe("Disabled")
  })

  it("shows authority, execution, and production boundaries", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.boundaryRail).toEqual([
      expect.objectContaining({
        label: "Authority",
        state: "Owner-gated",
      }),
      expect.objectContaining({
        label: "Execution",
        state: "Not active",
      }),
      expect.objectContaining({
        label: "Production",
        state: "Observed only",
      }),
    ])
  })

  it("recommends the next shell slice without granting authority", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-019 - Access Grants Native Area Reframe",
    })
    expect(surface.nextRecommendedWo.reason).toContain("disabled authority gate")
  })

  it("does not change health endpoints, poll, monitor, execute, deploy, write production, or activate runtimes", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.safety).toEqual({
      readOnly: true,
      changesHealthEndpoints: false,
      startsBackgroundPolling: false,
      activatesExternalMonitoring: false,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      writesProduction: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    })
  })

  it("frames Systems as under command, not an ops dashboard or monitoring product", () => {
    const surface = getSystemsStatusSurface()
    const text = [
      surface.title,
      surface.eyebrow,
      surface.description,
      ...surface.postureSummary.flatMap((item) => [
        item.label,
        item.value,
        item.description,
      ]),
      ...surface.boundaryRail.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...surface.categories.flatMap((category) => [
        category.label,
        category.status,
        category.description,
      ]),
      surface.nextRecommendedWo.label,
      surface.nextRecommendedWo.reason,
    ].join(" ")

    expect(text).toContain("systems under command")
    expect(text).toContain("readiness")
    expect(text).toContain("production health")
    expect(text).toContain("disabled-by-design")
    expect(text).not.toMatch(
      /admin dashboard|ops dashboard|SaaS status page|team monitoring|observability marketing|always-on automation/i,
    )
  })
})
