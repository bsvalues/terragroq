import { describe, expect, it } from "vitest"

import {
  exactV12CampaignDecision,
  exactV12CampaignGrant,
  exactV12CampaignRevokedGrant,
  buildV12CampaignMaterializationProvenance,
  isCanonicalV12CampaignCandidate,
  isExactV12CampaignMaterialization,
  isV12CampaignAuthorityScope,
  v12CampaignAuthorityRefs,
  v12CampaignDecision,
  v12CampaignGrant,
  V1_2_CAMPAIGN_AUTHORITY_SCOPES,
  V1_2_CAMPAIGN_BLOCKED_ACTIONS,
  V1_2_CAMPAIGN_GRANT_DURATION_MS,
  V1_2_CAMPAIGN_PARENT_BODY_SHA256,
  V1_2_CAMPAIGN_PARENT_ISSUE_URL,
} from "@/lib/outcome-queue/v1-2-campaign-authority"
import { buildV12CampaignMaterializerProvenance } from "@/scripts/hermes-bridge/v1-2-continuous-campaign-materializer.mjs"

const firstScope = "campaign:v1-2:queue-evidence-drilldown"
const secondScope = "campaign:v1-2:runtime-continuity-status"

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    outcomeKey: firstScope,
    goalId: 20,
    goalRef: "GOAL-0008",
    title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
    objective: "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist.",
    queueOrder: 12,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "unapproved",
    approvedBy: null,
    approvedAt: null,
    approvalDecisionId: null,
    authorityState: "unverified",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: null,
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "suggested",
    lifecycleReason: "V1_2_CAMPAIGN_SUGGESTION_REQUIRES_OWNER_APPROVAL",
    activeWorkOrderId: null,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    version: 0,
    acquisitionKey: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    supersedesOutcomeKey: null,
    supersededByOutcomeKey: null,
    activatedAt: null,
    terminalAt: null,
    suggestedAt: new Date("2026-07-29T21:00:00.000Z"),
    createdAt: new Date("2026-07-29T21:00:00.000Z"),
    updatedAt: new Date("2026-07-29T21:00:00.000Z"),
    ...overrides,
  }
}

describe("V1.2 campaign owner authority contract", () => {
  it("recognizes only the two fixed product proposal scopes", () => {
    expect(V1_2_CAMPAIGN_AUTHORITY_SCOPES).toEqual([firstScope, secondScope])
    expect(isV12CampaignAuthorityScope(firstScope)).toBe(true)
    expect(isV12CampaignAuthorityScope(secondScope)).toBe(true)
    expect(isV12CampaignAuthorityScope("campaign:v1-2:other")).toBe(false)
    expect(v12CampaignAuthorityRefs(firstScope)).toEqual({
      decisionRef: "ADR-V12-EVIDENCE-DRILLDOWN",
      grantRef: "GRANT-V12-EVIDENCE-DRILLDOWN",
    })
  })

  it("accepts only a pristine suggestion and exact dependency topology", () => {
    expect(isCanonicalV12CampaignCandidate(candidate() as never)).toBe(true)
    expect(isCanonicalV12CampaignCandidate(candidate({
      outcomeKey: secondScope,
      goalRef: "GOAL-0009",
      title: "Add a compact continuous outcome campaign status panel to the WilliamOS Runtime page.",
      objective: "Show the live campaign window, acquisition and settlement sequence, automatic successor handoff, and truthful evidence gaps.",
      queueOrder: 13,
      dependencyKeys: [firstScope],
    }) as never)).toBe(true)
    expect(isCanonicalV12CampaignCandidate(candidate({ approvalState: "approved" }) as never))
      .toBe(false)
    expect(isCanonicalV12CampaignCandidate(candidate({ fencingToken: 1 }) as never))
      .toBe(false)
    expect(isCanonicalV12CampaignCandidate(candidate({ queueOrder: 90 }) as never))
      .toBe(false)
  })

  it("pins the authenticated Primary decision and exact bounded grant", () => {
    const now = new Date("2026-07-29T22:00:00.000Z")
    const decision = v12CampaignDecision(firstScope)
    const grant = v12CampaignGrant(firstScope, "primary-1", now)
    const persistedGrant = {
      ...grant,
      createdAt: new Date(grant.createdAt),
      expiresAt: new Date(grant.expiresAt),
    }
    expect(exactV12CampaignDecision(decision, firstScope)).toBe(true)
    expect(decision.evidence).toContain(V1_2_CAMPAIGN_PARENT_ISSUE_URL)
    expect(decision.evidence).toContain(
      `issue-body-sha256:${V1_2_CAMPAIGN_PARENT_BODY_SHA256}`,
    )
    expect(exactV12CampaignDecision({ ...decision, owner: "Hermes" }, firstScope)).toBe(false)
    expect(persistedGrant.expiresAt.getTime() - persistedGrant.createdAt.getTime())
      .toBe(V1_2_CAMPAIGN_GRANT_DURATION_MS)
    expect(exactV12CampaignGrant(
      persistedGrant,
      firstScope,
      "primary-1",
      now,
    )).toBe(true)
    expect(exactV12CampaignGrant({
      ...persistedGrant,
      expiresAt: new Date(now.getTime() + V1_2_CAMPAIGN_GRANT_DURATION_MS + 1),
    }, firstScope, "primary-1", now)).toBe(false)
    const revokeReason =
      "Primary Operator revoked this exact V1.2 campaign outcome authority."
    expect(exactV12CampaignRevokedGrant({
      ...persistedGrant,
      status: "revoked",
      revokedAt: now,
      revokedBy: "primary-1",
      revokeReason,
    }, firstScope, "primary-1", now, revokeReason)).toBe(true)
    expect(exactV12CampaignGrant({
      ...persistedGrant,
      blockedActions: V1_2_CAMPAIGN_BLOCKED_ACTIONS.slice(1),
    }, firstScope, "primary-1", now)).toBe(false)
    const afterExpiry = new Date(persistedGrant.expiresAt.getTime() + 1)
    expect(exactV12CampaignGrant(
      persistedGrant,
      firstScope,
      "primary-1",
      afterExpiry,
    )).toBe(false)
    expect(exactV12CampaignGrant(
      persistedGrant,
      firstScope,
      "primary-1",
      afterExpiry,
      { allowExpired: true },
    )).toBe(true)
    expect(exactV12CampaignGrant(
      { ...persistedGrant, status: "expired" },
      firstScope,
      "primary-1",
      afterExpiry,
      { allowExpired: true },
    )).toBe(true)
    const futureGrant = v12CampaignGrant(
      firstScope,
      "primary-1",
      new Date(now.getTime() + 1),
    )
    expect(exactV12CampaignGrant({
      ...futureGrant,
      createdAt: new Date(futureGrant.createdAt),
      expiresAt: new Date(futureGrant.expiresAt),
    }, firstScope, "primary-1", now)).toBe(false)
    expect(exactV12CampaignGrant({
      ...persistedGrant,
      expiresAt: new Date("invalid"),
    }, firstScope, "primary-1", now)).toBe(false)
    expect(exactV12CampaignGrant(
      persistedGrant,
      firstScope,
      " ",
      now,
    )).toBe(false)
  })

  it("binds approval eligibility to the exact goal and Hermes audit provenance", () => {
    const item = candidate()
    const suggestedAt = item.suggestedAt as Date
    const provenance = buildV12CampaignMaterializationProvenance(
      "primary-1",
      item as never,
    )
    expect(provenance).toEqual(buildV12CampaignMaterializerProvenance({
      userId: "primary-1",
      goalId: 20,
      item: {
        outcomeKey: item.outcomeKey,
        goalRef: item.goalRef,
        title: item.title,
        objective: item.objective,
        queueOrder: item.queueOrder,
        dependencyKeys: item.dependencyKeys,
        suggestedAt,
      },
    }))
    const governance = {
      id: 41,
      userId: "primary-1",
      eventType: "V1_2_CHILD_OUTCOME_SUGGESTED",
      entityType: "outcome_queue_item",
      entityId: firstScope,
      actor: "hermes",
      reason: "Suggested from the exact owner-authored and still-open V1.2 parent #471 without approval or authority.",
      beforeHash: null,
      afterHash: provenance.contentHash,
      evidenceId: null,
      metadata: provenance,
      createdAt: suggestedAt,
    }
    const proof = {
      userId: "primary-1",
      item: item as never,
      goal: {
        id: 20,
        userId: "primary-1",
        ref: "GOAL-0008",
        command: item.title,
        lane: "ui",
        mode: "implement",
        risk: "low",
        authority: "A2_WRITE_OWN",
        verdict: "requires_approval",
        rationale: "Suggested as fixed WilliamOS-native R1 work from pinned live parent #471; this record conveys no approval or execution authority.",
        mistakePatterns: [],
        matchedRules: [],
        recommendedMove: "Await an explicit owner approval and independently verified authority match.",
        requiresApproval: true,
        linkedWorkOrderId: null,
        status: "classified",
        createdAt: suggestedAt,
        updatedAt: suggestedAt,
      },
      governance,
      audit: {
        userId: "primary-1",
        type: "outcome.suggested",
        summary: "GOAL-0008 suggested from pinned live V1.2 parent #471; owner approval remains required.",
        register: "outcome-queue",
        refId: 20,
      metadata: {
        governanceEventId: 41,
        outcomeKey: firstScope,
        parentIssue: V1_2_CAMPAIGN_PARENT_ISSUE_URL,
        provenanceContract: provenance.contract,
        provenanceHash: provenance.contentHash,
      },
        createdAt: suggestedAt,
      },
    }

    expect(isExactV12CampaignMaterialization(proof)).toBe(true)
    expect(isExactV12CampaignMaterialization({
      ...proof,
      goal: { ...proof.goal, command: "Forged product outcome" },
    })).toBe(false)
    expect(isExactV12CampaignMaterialization({
      ...proof,
      governance: {
        ...governance,
        metadata: { ...governance.metadata, parentIssue: "https://example.com/471" },
      },
    })).toBe(false)
    expect(isExactV12CampaignMaterialization({
      ...proof,
      audit: {
        ...proof.audit,
        metadata: { ...proof.audit.metadata, governanceEventId: 42 },
      },
    })).toBe(false)
    expect(isExactV12CampaignMaterialization({
      ...proof,
      userId: " ",
    })).toBe(false)
  })
})
