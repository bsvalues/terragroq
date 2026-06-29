import { describe, expect, it } from "vitest"
import { getHermesSandboxRequirementChecklist } from "@/components/brain-council/brain-council-hermes-sandbox-checklist"

describe("Hermes sandbox requirement checklist", () => {
  it("presents sandbox requirements as preview only", () => {
    const checklist = getHermesSandboxRequirementChecklist()

    expect(checklist.posture).toBe("SANDBOX_REQUIREMENTS_PREVIEW_ONLY")
    expect(checklist.requirements.map((item) => item.id)).toContain("egress-review")
  })

  it("keeps direct import, mutation, secrets, workers, and MCP non-negotiable", () => {
    const checklist = getHermesSandboxRequirementChecklist()

    expect(checklist.nonNegotiables).toContain("No direct import from sandbox to production context")
    expect(checklist.nonNegotiables).toContain("No MCP bridge")
  })

  it("does not create or run a sandbox", () => {
    const checklist = getHermesSandboxRequirementChecklist()

    expect(checklist.safety).toEqual({
      createsSandbox: false,
      runsCode: false,
      importsOutput: false,
      exposesSecrets: false,
      mutatesRepo: false,
      writesProductionData: false,
    })
  })
})
