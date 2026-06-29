import { describe, expect, it } from "vitest"
import { getBrainCouncilHermesResearchLinkage } from "@/components/brain-council/brain-council-hermes-research-linkage"

describe("Brain Council Hermes research linkage", () => {
  it("links Hermes candidates to research evidence", () => {
    const linkage = getBrainCouncilHermesResearchLinkage()

    expect(linkage.posture).toBe("HERMES_RESEARCH_LINKAGE_PREVIEW_ONLY")
    expect(linkage.links[0]).toMatchObject({
      linkedExperiment: expect.stringContaining("EXP-"),
      activationStatus: "not-active",
    })
  })

  it("requires risk and sandbox linkage for every candidate", () => {
    const linkage = getBrainCouncilHermesResearchLinkage()

    expect(linkage.links.every((link) => link.linkedRisk.length > 0)).toBe(true)
    expect(linkage.links.every((link) => link.linkedSandboxRequirement.length > 0)).toBe(true)
  })

  it("does not install, activate, or dispatch Hermes", () => {
    const linkage = getBrainCouncilHermesResearchLinkage()

    expect(linkage.safety).toEqual({
      installsHermes: false,
      activatesHermes: false,
      dispatchesWorker: false,
      writesData: false,
    })
  })
})
