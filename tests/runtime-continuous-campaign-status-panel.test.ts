import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("continuous campaign status panel contract", () => {
  it("shows the campaign window, ordered lifecycle, handoff, and evidence gaps", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    for (const label of [
      "Continuous campaign status",
      "Campaign window",
      "Acquisition",
      "Settlement",
      "Automatic successor handoff",
      "Evidence gaps",
    ]) {
      expect(panel).toContain(label)
    }
  })

  it("states the unproven campaign identity and automation evidence explicitly", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(panel).toMatch(/campaign identity[^.]*missing/i)
    expect(panel).toMatch(/automatic-trigger[^.]*missing/i)
    expect(panel).toMatch(/zero-owner-contact[^.]*missing/i)
  })

  it("renders the lifecycle as a semantic ordered sequence", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(panel).toMatch(/<ol\b[\s\S]*status\.steps\.map/)
    expect(panel).toContain("<li key={step.id}")
  })

  it("defers automation evaluation until successor acquisition is recorded", () => {
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )
    const recordedGate = panel.indexOf(
      'status.handoff.acquisitionStatus === "RECORDED" &&',
    )
    const automaticProofAssertion = panel.indexOf(
      "Automatic-trigger proof is missing, and zero-owner-contact proof is missing",
    )

    expect(recordedGate).toBeGreaterThan(-1)
    expect(automaticProofAssertion).toBeGreaterThan(recordedGate)
    expect(panel).toMatch(
      /Successor handoff evidence remains[\s\S]*automation proof is not evaluated yet\./,
    )
  })

  it("wires persisted queue truth through the Runtime page projection", () => {
    const page = source("app/(shell)/runtime/page.tsx")

    expect(page).toContain("getOutcomeQueueSurface")
    expect(page).toContain("projectContinuousCampaignStatus")
    expect(page).toContain("ContinuousCampaignStatusPanel")
  })

  it("contains no campaign mutation or runtime-control affordance", () => {
    const page = source("app/(shell)/runtime/page.tsx")
    const panel = source(
      "components/runtime/continuous-campaign-status-panel.tsx",
    )

    expect(`${page}\n${panel}`).not.toMatch(
      /<button|<form|<input|<select|<textarea|onClick=|startWorker|runCommand|cancelExecution/,
    )
  })
})
