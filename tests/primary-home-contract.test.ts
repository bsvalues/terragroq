import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function source(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

describe("Primary Home product contract", () => {
  it("uses one live read model instead of the retired dashboard composition", () => {
    const page = source("app/(shell)/page.tsx")
    const query = source("app/(shell)/primary-home-query.ts")

    expect(page).toContain("getPrimaryHomeReadModel")
    expect(page).toContain("<PrimaryHome")
    expect(page).not.toContain("getDashboardData")
    expect(page).not.toContain("HomeWorkRadarPanel")
    expect(page).not.toContain("WilliamOS Command Center")
    expect(query).toContain("getOutcomeQueueSurface")
    expect(query).toContain("getActiveGoalAuthorityRequestTimelines")
    expect(query).toContain("getRecentOutcomeCompletionTimeline")
    expect(query).toContain("getPersistedEvidenceTruth")
    expect(query).toContain("getEvidenceForWorkOrders")
    expect(query).toContain("relevantWorkOrderIds")
    expect(query).toContain("row.activeWorkOrderId")
    expect(query.indexOf("getOutcomeQueueSurface()"))
      .toBeLessThan(query.indexOf("getActiveGoalAuthorityRequestTimelines()"))
    expect(query.indexOf("getActiveGoalAuthorityRequestTimelines()"))
      .toBeLessThan(query.indexOf("getRecentOutcomeCompletionTimeline()"))
  })

  it("keeps project identity live and project-neutral", () => {
    const home = source("components/primary-home/primary-home.tsx")
    const technicalDetails = source("components/primary-home/primary-home-technical-details.tsx")
    const model = source("components/primary-home/primary-home-model.ts")

    expect(home).toContain("No project identity is proven")
    expect(home).toContain("Nothing needs you")
    expect(home).toContain("Next without William")
    expect(technicalDetails).toContain("Technical details")
    expect(technicalDetails).toContain("DialogContent")
    expect(technicalDetails).toContain("DialogTrigger")
    expect(technicalDetails).toContain("DialogClose")
    expect(home).not.toMatch(/TerraFusion|Property Workbench|TerraPilot|PACS/)
    expect(model).not.toMatch(/TerraFusion|Property Workbench|TerraPilot|PACS/)
  })

  it("does not present unavailable queue truth as healthy readiness", () => {
    const home = source("components/primary-home/primary-home.tsx")

    expect(home).toContain("No active outcome is proven")
    expect(home).toContain("Ready to begin")
    expect(home).not.toContain("WilliamOS is ready")
  })

  it("makes the active outcome the operating surface instead of a dashboard briefing", () => {
    const home = source("components/primary-home/primary-home.tsx")

    expect(home).toContain("Active outcome")
    expect(home).toContain("Work artifact")
    expect(home).toContain("Recent continuity")
    expect(home).toContain("Project horizon")
    expect(home).toContain("OutcomeFieldBackground")
    expect(home).not.toContain('<main className="relative min-h')
    expect(home).not.toContain("Primary briefing")
    expect(home).not.toContain("Recently completed")
    expect(home).not.toContain("grid max-w-5xl gap-8 lg:grid-cols")
  })

  it("records decisions only through the exact-bound authority action", () => {
    const decision = source("components/primary-home/primary-home-decision.tsx")

    expect(decision).toContain("recordGoalAuthorityDecision")
    expect(decision).toContain("Confirm this authority decision")
    expect(decision).toContain("Cancel")
    expect(decision).toContain("Technical evidence basis")
    expect(decision).not.toContain("Approve recommendation")
  })

  it("uses compact Home chrome without changing navigation destinations", () => {
    const shell = source("components/shell/app-shell.tsx")
    const frame = source("components/shell/app-shell-frame.tsx")

    expect(shell).toContain("AppShellFrame")
    expect(frame).toContain('const compactHome = pathname === "/"')
    expect(frame).toContain("HOME_RAIL_DESTINATIONS")
    expect(frame).toContain('"/work-orders"')
    expect(frame).toContain('"/projects"')
    expect(frame).toContain('"/audit"')
    expect(frame).toContain('"/runtime"')
    expect(frame).toContain("<SidebarNav />")
  })
})
