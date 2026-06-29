import { describe, expect, it } from "vitest"
import {
  getHermesSkillQuarantinePreview,
  getHermesSkillQuarantineSafetySummary,
} from "@/components/brain-council/brain-council-hermes-skill-quarantine"

describe("Hermes skill quarantine preview", () => {
  it("keeps skill-like outputs quarantined", () => {
    const preview = getHermesSkillQuarantinePreview()

    expect(preview.posture).toBe("SKILL_QUARANTINE_PREVIEW_ONLY")
    expect(preview.skills.map((skill) => skill.status)).toContain("quarantined")
  })

  it("marks carried-forward skills as provenance-only", () => {
    const preview = getHermesSkillQuarantinePreview()
    const carriedForward = preview.skills.find((skill) => skill.id === "carried-forward-skills")

    expect(carriedForward?.status).toBe("provenance-only")
    expect(carriedForward?.quarantineReason).toContain("not invokable")
  })

  it("does not invoke, canonize, import, or grant runtime", () => {
    const preview = getHermesSkillQuarantinePreview()

    expect(preview.safety).toEqual({
      invokesSkill: false,
      canonizesSkill: false,
      promotesMemory: false,
      importsSandboxOutput: false,
      grantsRuntime: false,
    })
  })

  it("derives the panel safety summary from the safety contract", () => {
    const preview = getHermesSkillQuarantinePreview()
    const summary = getHermesSkillQuarantineSafetySummary(preview.safety)

    expect(summary).toContain("invokes skill")
    expect(summary).toContain("grants runtime")
  })
})
