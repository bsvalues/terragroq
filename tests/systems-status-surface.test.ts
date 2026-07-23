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
      "Hermes Resident Worker",
      "Agent Forge / Skills",
      "Access Grants",
      "Memory / Knowledge",
      "Governance / Authority",
      "Deployment / Production Health",
      "TerraFusion OS Project",
    ])
  })

  it("summarizes ready, read-only, bounded-worker, and disabled posture", () => {
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
    expect(summary.get("Bounded worker")).toMatchObject({
      value: "1 proven",
      tone: "ready",
    })
    expect(summary.get("Disabled")).toMatchObject({
      value: "access grants",
      tone: "disabled",
    })
  })

  it("distinguishes advisory surfaces from the bounded resident Hermes worker", () => {
    const surface = getSystemsStatusSurface()
    const statuses = new Map(surface.categories.map((category) => [category.label, category.status]))

    expect(statuses.get("Brain Council")).toBe("Read-only")
    expect(statuses.get("Hermes Resident Worker")).toBe("Runtime-proven")
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
        state: "Runtime-proven",
      }),
      expect.objectContaining({
        label: "Production",
        state: "Observed only",
      }),
    ])
  })

  it("shows the Primary status sequence and blocked expansion posture", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.statusSequence.map((item) => item.value)).toEqual([
      "Pre-action",
      "Proven / liveness separate",
      "Read-only",
      "Observed",
      "Owner-gated",
    ])
    expect(surface.blockedExpansion.map((item) => item.label)).toEqual([
      "No background polling",
      "No repair controls",
      "No metadata expansion",
      "No unrestricted runtime",
    ])
  })

  it("recommends the next shell slice without granting authority", () => {
    const surface = getSystemsStatusSurface()

    expect(surface.nextRecommendedWo).toMatchObject({
      label: "WO-SHELL-008 - Authority / Governance Surface",
    })
    expect(surface.nextRecommendedWo.reason).toContain("Authority / Governance")
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
      surface.operatorPosture,
      ...surface.postureSummary.flatMap((item) => [
        item.label,
        item.value,
        item.description,
      ]),
      ...surface.statusSequence.flatMap((item) => [
        item.label,
        item.value,
        item.description,
      ]),
      ...surface.boundaryRail.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...surface.blockedExpansion.flatMap((item) => [
        item.label,
        item.state,
        item.description,
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
    expect(text).toContain("local runtime posture")
    expect(text).toContain("disabled-by-design")
    expect(text).toContain("No background polling")
    expect(text).toContain("No repair controls")
    expect(text).toContain("Codex App Server")
    expect(text).toContain("persisted execution projection")
    expect(text).toContain("production web app")
    expect(text).toContain("issue #357")
    expect(text).toMatch(/TerraFusion.*county.*PACS/i)
    expect(text).not.toMatch(
      /admin dashboard|ops dashboard|SaaS status page|team monitoring|observability marketing|always-on automation/i,
    )
  })
})
