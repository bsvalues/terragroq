import { describe, expect, it } from "vitest"
import { getBrainCouncilManifestSummary } from "@/components/brain-council/brain-council-manifest"

describe("Brain Council manifest summary", () => {
  it("summarizes roles, skills, workflows, and required files", () => {
    const summary = getBrainCouncilManifestSummary()

    expect(summary.roleCount).toBeGreaterThanOrEqual(6)
    expect(summary.skillCount).toBeGreaterThanOrEqual(5)
    expect(summary.workflowCount).toBeGreaterThanOrEqual(7)
    expect(summary.requiredFileCount).toBeGreaterThan(0)
    expect(summary.roles.map((role) => role.id)).toContain("owner")
  })

  it("keeps manifest data definition-only", () => {
    const summary = getBrainCouncilManifestSummary()

    expect(summary.definitionOnly).toBe(true)
    expect(summary.roles.every((role) => role.authority.length > 0)).toBe(true)
  })
})
