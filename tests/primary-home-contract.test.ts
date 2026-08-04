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
  })

  it("keeps project identity live and project-neutral", () => {
    const home = source("components/primary-home/primary-home.tsx")
    const model = source("components/primary-home/primary-home-model.ts")

    expect(home).toContain("Project not recorded")
    expect(home).toContain("Nothing needs William")
    expect(home).toContain("Next without William")
    expect(home).toContain("Technical details")
    expect(home).not.toMatch(/TerraFusion|Property Workbench|TerraPilot|PACS/)
    expect(model).not.toMatch(/TerraFusion|Property Workbench|TerraPilot|PACS/)
  })

  it("records decisions only through the exact-bound authority action", () => {
    const decision = source("components/primary-home/primary-home-decision.tsx")

    expect(decision).toContain("recordGoalAuthorityDecision")
    expect(decision).toContain("Confirm this authority decision")
    expect(decision).toContain("Cancel")
    expect(decision).toContain("Technical evidence basis")
    expect(decision).not.toContain("Approve recommendation")
  })
})
