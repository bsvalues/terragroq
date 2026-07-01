import { describe, expect, it } from "vitest"
import { getHermesSafetyBoundaryReport } from "@/components/brain-council/hermes-safety-boundary"

describe("Hermes safety boundary report", () => {
  it("passes every required Hermes boundary check", () => {
    const report = getHermesSafetyBoundaryReport()

    expect(report.pass).toBe(true)
    expect(report.checks.map((check) => check.label)).toEqual([
      "Hermes remains non-executing",
      "No dispatch affordance exists",
      "Work Orders remain required",
      "Authority remains required",
      "Evidence remains required",
      "Brain Council remains advisory",
    ])
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  it("keeps activation prerequisites explicit", () => {
    const report = getHermesSafetyBoundaryReport()

    expect(report.requiredControls).toEqual([
      "Work Order",
      "Primary authority",
      "evidence required",
      "blocked actions",
      "rollback or stop condition",
      "execution not active",
    ])
  })
})
