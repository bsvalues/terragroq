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
      "Packet ID",
      "Goal ID",
      "Work Order ID",
      "Problem statement",
      "Context used",
      "Evidence used",
      "Assumptions",
      "Options considered",
      "Recommendation",
      "Confidence",
      "Risk rating",
      "Safety flags",
      "Blocked actions",
      "Authority required",
      "Validation required",
      "Evidence required",
      "Recommended Work Order",
      "Next safe gate",
    ])
    expect(schema.criticalRule).toBe("Decision packets recommend. They do not execute.")
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
        "Packet ID": "COUNCIL-PACKET-001",
        "Goal ID": "GOAL-WOS-003",
        "Problem statement": "Should the Council recommend the next Work Order?",
        "Context used": "Current origin/main and reports.",
        "Evidence used": "Production health and tests passed.",
        Assumptions: "Review coverage may be incomplete.",
        "Options considered": "No action, docs-only, static advisory update.",
        Recommendation: "Prepare a bounded Work Order.",
        Confidence: "medium",
        "Risk rating": "low",
        "Safety flags": "no runtime",
        "Blocked actions": "No execution without authority.",
        "Authority required": "Primary approval",
        "Validation required": "Run tests and production checks.",
        "Evidence required": "PR checks",
        "Recommended Work Order": "WO-COUNCIL-011",
        "Next safe gate": "Trace Ledger",
      }),
    ).toBe(true)

    expect(
      isCouncilDecisionPacketReviewable({
        "Problem statement": "Can this execute?",
        "Evidence used": "No",
      }),
    ).toBe(false)
  })
})
