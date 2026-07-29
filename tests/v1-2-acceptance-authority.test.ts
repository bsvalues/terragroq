import { describe, expect, it } from "vitest"

import {
  isCanonicalV12AcceptanceCandidate,
  isExactV12AcceptanceDecision,
  isExactV12AcceptanceGrant,
  isV12AcceptanceAuthorityScope,
  V1_2_ACCEPTANCE_BLOCKED_ACTIONS,
} from "@/lib/outcome-queue/v1-2-acceptance-authority"
import { hashRecord } from "@/lib/governance/hash"

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    outcomeKey: "acceptance:v1-2:dependency-blocked",
    title: "V1.2 dependency and pause/resume proof",
    objective: "Exercise pause/resume exactly once while an unfinished dependency prevents selection.",
    queueOrder: 101,
    dependencyKeys: ["acceptance:v1-2:safety-blocker"],
    riskClass: "R0",
    approvalState: "unapproved",
    authorityState: "unverified",
    authorityLevel: "A0_READ_ONLY",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "suggested",
    activeWorkOrderId: null,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    acquisitionKey: null,
    activatedAt: null,
    approvalDecisionId: null,
    authorityGrantRef: null,
    terminalAt: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    supersedesOutcomeKey: null,
    supersededByOutcomeKey: null,
    version: 3,
    ...overrides,
  }
}

function grant(overrides: Record<string, unknown> = {}) {
  const draft = {
    userId: "primary-1",
    ref: "GRANT-V12-DEPENDENCY-BLOCKED",
    workOrderId: null,
    grantedBy: "primary-1",
    grantedTo: "operator",
    authorityLevel: "A0_READ_ONLY",
    scope: "acceptance:v1-2:dependency-blocked",
    allowedActions: ["outcome:execute"],
    blockedActions: [...V1_2_ACCEPTANCE_BLOCKED_ACTIONS],
    status: "active",
    expiresAt: null,
    reason: "ADR-V12-DEPENDENCY-BLOCKED authorizes only acceptance:v1-2:dependency-blocked.",
    contentHash: null,
    revokedAt: null,
  }
  return {
    ...draft,
    contentHash: hashRecord({
      userId: draft.userId,
      ref: draft.ref,
      workOrderId: draft.workOrderId,
      grantedBy: draft.grantedBy,
      grantedTo: draft.grantedTo,
      authorityLevel: draft.authorityLevel,
      scope: draft.scope,
      allowedActions: draft.allowedActions,
      blockedActions: draft.blockedActions,
      reason: draft.reason,
      status: draft.status,
      expiresAt: draft.expiresAt,
    }),
    ...overrides,
  }
}

describe("V1.2 acceptance owner authority contract", () => {
  it("recognizes only the two fixed acceptance scopes", () => {
    expect(isV12AcceptanceAuthorityScope(
      "acceptance:v1-2:dependency-blocked",
    )).toBe(true)
    expect(isV12AcceptanceAuthorityScope(
      "acceptance:v1-2:authority-blocked",
    )).toBe(true)
    expect(isV12AcceptanceAuthorityScope(
      "acceptance:v1-2:risk-blocked",
    )).toBe(false)
  })

  it("accepts only the pristine canonical dependency candidate", () => {
    expect(isCanonicalV12AcceptanceCandidate(candidate(), 3)).toBe(true)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ approvalDecisionId: 99 }),
      3,
    )).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ dependencyKeys: [] }),
      3,
    )).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ title: "Altered proof" }),
      3,
    )).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(candidate(), 4)).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ executionBinding: "stale-binding" }),
      3,
    )).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ fencingToken: 9 }),
      3,
    )).toBe(false)
    expect(isCanonicalV12AcceptanceCandidate(
      candidate({ leaseHolder: "stale-holder" }),
      3,
    )).toBe(false)
  })

  it("pins the deterministic accepted decision identity and proof metadata", () => {
    const approval = {
      ref: "ADR-V12-DEPENDENCY-BLOCKED",
      title: "Approve V1.2 dependency and pause/resume proof",
      status: "accepted",
      authority: "binding",
      decision: "APPROVE",
      scope: "acceptance:v1-2:dependency-blocked",
      context: "WO #480 requires a bounded live authority and revocation proof.",
      rationale: "The authenticated Primary explicitly approved this exact A0 acceptance scope.",
      consequences: "The grant permits only the bounded pause/resume acceptance exercise.",
      owner: "Bill",
      evidence: ["WO #480", "PR #494"],
      tags: ["v1.2", "acceptance", "owner-approved"],
    }
    expect(isExactV12AcceptanceDecision(
      approval,
      "acceptance:v1-2:dependency-blocked",
    )).toBe(true)
    expect(isExactV12AcceptanceDecision(
      { ...approval, ref: "ADR-0012" },
      "acceptance:v1-2:dependency-blocked",
    )).toBe(false)
    expect(isExactV12AcceptanceDecision(
      { ...approval, evidence: ["WO #480"] },
      "acceptance:v1-2:dependency-blocked",
    )).toBe(false)
  })

  it("rejects grants that expand or mismatch the exact proof contract", () => {
    expect(isExactV12AcceptanceGrant(
      grant(),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(true)
    expect(isExactV12AcceptanceGrant(
      grant({ ref: "GRANT-0012" }),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(false)
    expect(isExactV12AcceptanceGrant(
      grant({ scope: "goal:unrelated" }),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(false)
    expect(isExactV12AcceptanceGrant(
      grant({ allowedActions: [] }),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(false)
    expect(isExactV12AcceptanceGrant(
      grant({ blockedActions: [] }),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(false)
    expect(isExactV12AcceptanceGrant(
      grant({ expiresAt: new Date("2026-07-30T00:00:00.000Z") }),
      "acceptance:v1-2:dependency-blocked",
      "active",
      "primary-1",
    )).toBe(false)
    expect(isExactV12AcceptanceGrant(
      grant({ status: "revoked", revokedAt: new Date() }),
      "acceptance:v1-2:dependency-blocked",
      "revoked",
      "primary-1",
    )).toBe(true)
  })
})
