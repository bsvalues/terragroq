import { describe, expect, it } from "vitest"
import {
  getCouncilDecisionPacketSchema,
  isCouncilDecisionPacketReviewable,
} from "@/components/brain-council/council-decision-packet-schema"

describe("Council decision packet schema", () => {
  it("defines required review fields for Council recommendations", () => {
    const schema = getCouncilDecisionPacketSchema()

    expect(schema.statusFlow).toEqual([
      "draft",
      "blocked-for-evidence",
      "ready-for-review",
      "blocked-for-authority",
    ])
    expect(schema.requiredFields.map((field) => field.label)).toEqual([
      "Question",
      "Evidence",
      "Unknowns",
      "Recommendation",
      "Required verification",
      "Blocked actions",
    ])
  })

  it("requires Work Order, Primary approval, and evidence checks", () => {
    const schema = getCouncilDecisionPacketSchema()

    expect(schema.authorityChecks.map((check) => check.label)).toEqual([
      "Work Order boundary",
      "Primary approval",
      "Evidence rollup",
    ])
    expect(schema.blockedUntilApproved).toEqual(
      expect.arrayContaining([
        "execute recommendation",
        "activate Hermes",
        "activate MCP",
        "grant access",
        "change auth policy",
      ]),
    )
  })

  it("does not authorize work, policy changes, or production writes", () => {
    const schema = getCouncilDecisionPacketSchema()

    expect(schema.safety).toEqual({
      schemaOnly: true,
      authorizesWork: false,
      createsWorkOrder: false,
      executesRecommendation: false,
      changesPolicy: false,
      writesProduction: false,
    })
  })

  it("only marks packets reviewable when required fields are present", () => {
    expect(
      isCouncilDecisionPacketReviewable({
        Question: "Should the Council recommend the next Work Order?",
        Evidence: "Production health and tests passed.",
        Unknowns: "Review coverage may be incomplete.",
        Recommendation: "Prepare a bounded Work Order.",
        "Required verification": "Run tests and production checks.",
        "Blocked actions": "No execution without authority.",
      }),
    ).toBe(true)

    expect(
      isCouncilDecisionPacketReviewable({
        Question: "Can this execute?",
        Evidence: "No",
      }),
    ).toBe(false)
  })
})
