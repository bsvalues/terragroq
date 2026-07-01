import { describe, expect, it } from "vitest"
import { getCouncilSafetyBoundaryReport } from "@/components/brain-council/council-safety-boundary"

describe("Council safety boundary report", () => {
  it("passes every advisory-only boundary check", () => {
    const report = getCouncilSafetyBoundaryReport()

    expect(report.pass).toBe(true)
    expect(report.checks.map((check) => check.label)).toEqual([
      "Doctrine is advisory",
      "State machine is descriptive",
      "Decision packet is review-only",
      "Advisory overview has no powers",
      "Trace model does not write",
    ])
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  it("keeps every blocked capability explicit", () => {
    const report = getCouncilSafetyBoundaryReport()

    expect(report.blockedCapabilities).toEqual([
      "runtime orchestration",
      "autonomous execution",
      "MCP activation",
      "Hermes activation",
      "worker dispatch",
      "production write",
      "authority grant",
      "access grant activation",
      "auth policy change",
    ])
  })
})
