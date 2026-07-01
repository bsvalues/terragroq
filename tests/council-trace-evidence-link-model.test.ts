import { describe, expect, it } from "vitest"
import {
  getCouncilTraceEvidenceModel,
  getCouncilTraceLinksByType,
} from "@/components/brain-council/council-trace-evidence-link-model"

describe("Council trace and evidence link model", () => {
  it("requires Work Order, test, build, production, and safety evidence links", () => {
    const model = getCouncilTraceEvidenceModel()

    expect(model.requiredLinkTypes).toEqual([
      "work-order",
      "test",
      "build",
      "production-check",
      "safety-boundary",
    ])
    expect(model.requiredLinkTypes.every((type) => getCouncilTraceLinksByType(type).length > 0)).toBe(true)
  })

  it("keeps Council claims attached to evidence sources", () => {
    const model = getCouncilTraceEvidenceModel()

    expect(model.links.every((link) => link.claim.length > 0)).toBe(true)
    expect(model.links.every((link) => link.evidence.length > 0)).toBe(true)
    expect(model.links.every((link) => link.source.length > 0)).toBe(true)
    expect(model.links.map((link) => link.posture)).toEqual(
      expect.arrayContaining(["verified"]),
    )
  })

  it("does not write traces, mutate evidence, start checks, grant authority, or write production", () => {
    const model = getCouncilTraceEvidenceModel()

    expect(model.safety).toEqual({
      modelOnly: true,
      writesTraceLedger: false,
      mutatesEvidence: false,
      startsVerification: false,
      grantsAuthority: false,
      writesProduction: false,
    })
  })
})
