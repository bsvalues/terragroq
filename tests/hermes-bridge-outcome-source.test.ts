import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  completeOutcome,
  deferProviderOutcome,
  NATIVE_PROVIDER_RETRY_STATE,
  OUTCOME_SELECTION_SQL,
  projectOutcomeRuntimeCheckpoint,
  projectOutcomeRuntimeLease,
  readApprovedOwnerDecision,
  recordOwnerAuthorityDecision,
  recordValidationInfrastructureRecoveryProof,
  recoverNativeProviderOutcome,
  recoverReviewedOutcome,
  recoverValidationInfrastructureOutcome,
  selectNextOutcome,
  terminalizeOutcome,
} from "@/scripts/hermes-bridge/outcome-source.mjs"

const row = { id: 4, ref: "GOAL-0004", command: "Build a WilliamOS status UI", lane: "ui", mode: "implement", risk: "low", authority: "A2_WRITE_OWN", verdict: "allow", requiresApproval: false, matchedRules: [], status: "classified" }
const ownerDecisionPacket = {
  blockedAction: "Resume the exact blocked validation.",
  authorityBoundary: "Primary authority is required.",
  minimumChoice: "APPROVE_OR_DENY",
  approveConsequence: "Resume only the blocked validation.",
  denyConsequence: "Keep the Work Order blocked.",
}
const ownerDecisionPacketHash = createHash("sha256")
  .update(JSON.stringify(ownerDecisionPacket))
  .digest("hex")

function ownerDecisionReceipt(choice: "APPROVE" | "DENY", decisionId: number, evidenceId: number) {
  const requestKey = `hermes-owner-decision:4:42:88:owner:${choice}:EXACT_NEXT_STATE`
  const decisionRef = "OWNER-DECISION-4-88"
  const evidence = [
    "outcome:4",
    "work-order:42",
    "terminal-event:88",
    "next-state:EXACT_NEXT_STATE",
    `request:${requestKey}`,
    "terminal-binding:hermes-owner-decision-terminal:4:42:88",
    `choice:${choice}`,
    `decision-packet:${ownerDecisionPacketHash}`,
  ]
  const payload = {
    outcomeId: 4,
    workOrderId: 42,
    terminalEventId: 88,
    ownerUserId: "owner",
    choice,
    expectedNextState: "EXACT_NEXT_STATE",
    decisionId,
    decisionRef,
    requestKey,
    decisionPacket: ownerDecisionPacket,
    decisionPacketDigest: ownerDecisionPacketHash,
  }
  const notes = JSON.stringify(payload)
  const audit = {
    ...payload,
    status: choice === "APPROVE" ? "accepted" : "rejected",
    authority: "binding",
    evidenceId,
    recordedAt: "2026-07-26T12:00:00.000Z",
  }
  return {
    evidence,
    notes,
    contentHash: createHash("sha256").update(notes).digest("hex"),
    audit,
  }
}

describe("Hermes bridge PostgreSQL outcome source", () => {
  it("uses one deterministic parameterized row selection", async () => {
    const query = vi.fn(async () => ({ rows: [row] }))
    await expect(selectNextOutcome({ query })).resolves.toEqual(row)
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0][0]).toBe(OUTCOME_SELECTION_SQL)
    expect(OUTCOME_SELECTION_SQL).toMatch(/ORDER BY "createdAt" ASC, id ASC/)
    expect(OUTCOME_SELECTION_SQL).toMatch(/provider_defer\."entityId"::text = goal\.id::text/)
    expect(OUTCOME_SELECTION_SQL).not.toMatch(/LIMIT\s+1/i)
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([
      "classified", ["allow", "requires_approval"], ["low", "R0", "R1"],
    ]))
    expect(String(query.mock.calls[0][1][5])).toMatch(/release.*tag/i)
  })

  it("returns null for no row or a policy-ineligible injected row", async () => {
    await expect(selectNextOutcome({ query: async () => ({ rows: [] }) })).resolves.toBeNull()
    await expect(selectNextOutcome({ query: async () => ({ rows: [{ ...row, command: "Retry issue #357" }] }) })).resolves.toBeNull()
  })

  it("scans past an older policy-rejected row to the next eligible outcome", async () => {
    const rejected = { ...row, id: 3, command: "Delete the WilliamOS status UI" }
    await expect(selectNextOutcome({ query: async () => ({ rows: [rejected, row] }) })).resolves.toEqual(row)
  })

  it("fails closed on a malformed authority timestamp", async () => {
    await expect(selectNextOutcome({ query: async () => ({ rows: [row] }), notBefore: "not-a-date" }))
      .rejects.toMatchObject({ code: "NOT_BEFORE_INVALID" })
  })

  it("does not require or expose DATABASE_URL when query is injected", async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      await expect(selectNextOutcome({ query: async () => ({ rows: [row] }) })).resolves.toEqual(row)
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = original
    }
  })

  it("closes the selected goal and appends sanitized completion evidence", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, userId: "owner", ref: "GOAL-0004" }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(completeOutcome({
      query, outcomeId: 4, evidence: { prNumber: 500, mergeSha: "a".repeat(40), ownerTouchCount: 0 },
    })).resolves.toBe(true)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toMatch(/UPDATE goal SET status = 'converted'/)
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO governance_event/)
    expect(query.mock.calls[1][1][3]).toContain('"prNumber":500')
  })

  it("treats an already recorded Hermes completion as idempotent success", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ completed: true }] })
    await expect(completeOutcome({ query, outcomeId: 4, evidence: {} })).resolves.toBe(true)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_COMPLETED/)
    expect(query.mock.calls[1][0]).toMatch(/e\."entityId"::text = g\.id::text/)
  })

  it("removes terminal outcomes from selection while retaining a governance event", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, userId: "owner", ref: "GOAL-0004" }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(terminalizeOutcome({
      query, outcomeId: 4, result: "OWNER_DECISION_REQUIRED", nextState: "AUTHORITY_WALL",
      metadata: ownerDecisionPacket,
    })).resolves.toBe(true)
    expect(query.mock.calls[0][0]).toMatch(/status = 'dismissed'/)
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_TERMINAL/)
  })

  it("records bounded provider exhaustion as a resumable classified deferral", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, userId: "owner", ref: "GOAL-0004" }] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 })
    await expect(deferProviderOutcome({
      query, outcomeId: 4, retryAfter: "2026-07-21T01:15:00.000Z",
    })).resolves.toBe(true)
    expect(query.mock.calls[0][0]).toMatch(/status = 'classified'/)
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_PROVIDER_DEFERRED/)
    expect(query.mock.calls[1][0]).toMatch(/"entityId"::text = \$6::text/)
    expect(query.mock.calls[1][1][1]).toBe("4")
    expect(query.mock.calls[1][1][5]).toBe("4")
    expect(query.mock.calls[1][1][3]).toContain('"result":"PROVIDER_UNAVAILABLE"')
    expect(OUTCOME_SELECTION_SQL).toMatch(/HERMES_OUTCOME_PROVIDER_DEFERRED/)
  })

  it("treats an exactly recorded terminal outcome as idempotent success", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ terminalized: true }] })
    await expect(terminalizeOutcome({
      query, outcomeId: 4, result: "FAILED_TERMINAL", nextState: "POLICY_WALL",
    })).resolves.toBe(true)
    expect(query.mock.calls[1][1]).toEqual([
      4, "FAILED_TERMINAL", "POLICY_WALL",
      JSON.stringify({ result: "FAILED_TERMINAL", nextState: "POLICY_WALL" }),
    ])
    expect(query.mock.calls[1][0]).toMatch(/terminal\."entityId"::text = g\.id::text/)
  })

  const ownerDecisionBinding = {
    goalId: 4,
    goalUserId: "owner",
    goalStatus: "dismissed",
    workOrderId: 42,
    workOrderUserId: "owner",
    latestTerminalId: 88,
    latestTerminalMetadata: {
      result: "OWNER_DECISION_REQUIRED",
      nextState: "EXACT_NEXT_STATE",
      ...ownerDecisionPacket,
    },
    requestedTerminalId: 88,
    requestedTerminalUserId: "owner",
    requestedTerminalMetadata: {
      result: "OWNER_DECISION_REQUIRED",
      nextState: "EXACT_NEXT_STATE",
      ...ownerDecisionPacket,
    },
    terminalUserId: "owner",
    latestLeaseMetadata: { leaseStatus: "RELEASED", leaseExpiresAt: "2026-07-21T00:00:00.000Z" },
  }

  it("records an approving owner decision and releases only its exact resume scope", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ownerDecisionBinding] })
      .mockResolvedValueOnce({ rows: [{ id: 19, ref: "OWNER-DECISION-4-88", status: "accepted", decision: "APPROVE", decidedAt: "2026-07-26T12:00:00.000Z" }] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 90 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", choice: "APPROVE", expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toEqual(expect.objectContaining({
      status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-4-88", resumeReleased: true,
    }))
    expect(query.mock.calls[1][0]).toMatch(/pg_advisory_xact_lock/)
    expect(query.mock.calls[2][0]).toMatch(/ORDER BY id DESC\s+LIMIT 1/)
    expect(query.mock.calls[2][0]).toMatch(/"linkedDecisionId" AS "workOrderLinkedDecisionId"/)
    expect(query.mock.calls[2][0]).toMatch(/FROM goal WHERE id = \$1::integer\s+FOR UPDATE/)
    expect(query.mock.calls[2][0]).toMatch(/FROM work_order[\s\S]+FOR UPDATE/)
    expect(query.mock.calls[2][0].match(/AND "userId" = \$4/g)).toHaveLength(3)
    expect(query.mock.calls.some(([sql]) =>
      /INSERT INTO decision[\s\S]+tags, "decidedAt"\)/.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /UPDATE goal SET status = 'classified'/.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /INSERT INTO evidence_record/.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /INSERT INTO governance_event/.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) => /INSERT INTO event_log/.test(sql))).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      /"linkedDecisionId" IS NOT DISTINCT FROM \$4::integer/.test(sql))).toBe(true)
  })

  it("rebinds the Work Order when a later terminal wall receives its own decision", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        ...ownerDecisionBinding,
        workOrderLinkedDecisionId: 11,
        linkedDecisionUserId: "owner",
        linkedDecisionEvidence: [
          "work-order:42",
          "terminal-binding:hermes-owner-decision-terminal:4:42:77",
        ],
      }] })
      .mockResolvedValueOnce({ rows: [{
        id: 19,
        ref: "OWNER-DECISION-4-88",
        status: "accepted",
        decision: "APPROVE",
        decidedAt: "2026-07-26T12:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 90 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: 4,
      workOrderId: 42,
      terminalEventId: 88,
      ownerUserId: "owner",
      choice: "APPROVE",
      expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toMatchObject({
      status: "accepted",
      decisionId: 19,
      resumeReleased: true,
    })

    const linkCall = query.mock.calls.find(([sql]) =>
      /UPDATE work_order[\s\S]+linkedDecisionId/.test(sql))
    expect(linkCall?.[1]).toEqual([42, 19, "owner", 11])
  })

  it("records denial without reclassifying the goal and replays an identical request", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [ownerDecisionBinding] })
      .mockResolvedValueOnce({ rows: [{ id: 20, ref: "OWNER-DECISION-4-88", status: "rejected", decision: "DENY" }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", choice: "DENY", expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toMatchObject({ status: "rejected", choice: "DENY", resumeReleased: false })
    expect(query.mock.calls.some(([sql]) => /UPDATE goal SET status = 'classified'/.test(sql))).toBe(false)

    const denialReceipt = ownerDecisionReceipt("DENY", 20, 91)
    const replay = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        ...ownerDecisionBinding,
        decisionId: 20,
        decisionRef: "OWNER-DECISION-4-88",
        priorStatus: "rejected",
        priorChoice: "DENY",
        priorAuthority: "binding",
        priorScope: "goal:4|work-order:42|terminal:88|next-state:EXACT_NEXT_STATE",
        priorEvidence: denialReceipt.evidence,
        priorDecidedAt: "2026-07-26T12:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rows: [{
        evidenceId: 91,
        notes: denialReceipt.notes,
        contentHash: denialReceipt.contentHash,
        receiptMetadata: denialReceipt.audit,
        auditMetadata: denialReceipt.audit,
      }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(recordOwnerAuthorityDecision({
      query: replay, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", choice: "DENY", expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toMatchObject({
      status: "rejected", choice: "DENY", decisionId: 20, resumeReleased: false,
      replayed: true,
    })
    expect(replay.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it("replays an approved receipt after classification and lease reclaim", async () => {
    const approvalReceipt = ownerDecisionReceipt("APPROVE", 19, 90)
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        ...ownerDecisionBinding,
        goalStatus: "classified",
        latestLeaseMetadata: { leaseStatus: "ACTIVE" },
        workOrderLinkedDecisionId: 19,
        decisionId: 19,
        decisionRef: "OWNER-DECISION-4-88",
        priorStatus: "accepted",
        priorChoice: "APPROVE",
        priorAuthority: "binding",
        priorScope: "goal:4|work-order:42|terminal:88|next-state:EXACT_NEXT_STATE",
        priorEvidence: approvalReceipt.evidence,
        priorDecidedAt: "2026-07-26T12:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rows: [{
        evidenceId: 90,
        notes: approvalReceipt.notes,
        contentHash: approvalReceipt.contentHash,
        receiptMetadata: approvalReceipt.audit,
        auditMetadata: approvalReceipt.audit,
      }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: 4,
      workOrderId: 42,
      terminalEventId: 88,
      ownerUserId: "owner",
      choice: "APPROVE",
      expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toMatchObject({
      status: "accepted",
      choice: "APPROVE",
      decisionId: 19,
      replayed: true,
      resumeReleased: true,
    })
    expect(query.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it.each([
    ["unauthorized", { goalUserId: "other" }, "OWNER_DECISION_UNAUTHORIZED"],
    ["stale terminal", { latestTerminalId: 87 }, "OWNER_DECISION_STALE"],
    ["active lease", { latestLeaseMetadata: { leaseStatus: "ACTIVE", leaseExpiresAt: "2099-01-01T00:00:00.000Z" } }, "OWNER_DECISION_ACTIVE_LEASE"],
    ["expired active lease", { latestLeaseMetadata: { leaseStatus: "ACTIVE", leaseExpiresAt: "2020-01-01T00:00:00.000Z" } }, "OWNER_DECISION_ACTIVE_LEASE"],
    ["conflicting terminal", { consumedDecisionId: 21 }, "OWNER_DECISION_CONFLICT"],
    ["opposite decision after approval", {
      consumedDecisionId: 21,
      consumedChoice: "APPROVE",
      goalStatus: "classified",
    }, "OWNER_DECISION_CONFLICT"],
    ["conflicting Work Order link", { workOrderLinkedDecisionId: 21 }, "OWNER_DECISION_CONFLICT"],
    ["consumed request", { consumedRequestId: 21 }, "OWNER_DECISION_CONSUMED"],
  ])("rejects %s owner decisions", async (_label, overrides, code) => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...ownerDecisionBinding, ...overrides }] })
    await expect(recordOwnerAuthorityDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", choice: "APPROVE", expectedNextState: "EXACT_NEXT_STATE",
    })).rejects.toMatchObject({ code })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("returns only an exact approved database proof", async () => {
    const approvalReceipt = ownerDecisionReceipt("APPROVE", 19, 90)
    const query = vi.fn(async () => ({ rows: [{
      decisionId: 19, decisionRef: "OWNER-DECISION-4-88", status: "accepted",
      choice: "APPROVE", authority: "binding", outcomeId: 4, workOrderId: 42,
      terminalEventId: 88, decidedAt: "2026-07-26T12:00:00.000Z",
      receiptEventId: 92, evidenceRecordId: 90, auditEventId: 93,
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: "EXACT_NEXT_STATE",
        ...ownerDecisionPacket,
      },
      evidence: approvalReceipt.evidence,
      evidenceNotes: approvalReceipt.notes,
      evidenceContentHash: approvalReceipt.contentHash,
      receiptMetadata: approvalReceipt.audit,
      auditMetadata: approvalReceipt.audit,
    }] }))
    await expect(readApprovedOwnerDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toMatchObject({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-4-88", workOrderId: 42, terminalEventId: 88,
    })
    expect(query.mock.calls[0][0]).toMatch(/status = 'accepted'/)
    expect(query.mock.calls[0][0]).toMatch(/OWNER_DECISION_REQUIRED/)
    expect(query.mock.calls[0][0]).toMatch(/"linkedDecisionId" = d\.id/)
    expect(query.mock.calls[0][0]).toMatch(/HERMES_OWNER_AUTHORITY_DECISION/)
    expect(query.mock.calls[0][0]).toMatch(/owner\.decision\.recorded/)
    expect(query.mock.calls[0][0]).toMatch(
      /latest_terminal[\s\S]+AND "userId" = \$4[\s\S]+HERMES_OUTCOME_TERMINAL/,
    )
  })

  it("rejects an approval without its complete evidence, trace, and audit receipt", async () => {
    const query = vi.fn(async () => ({ rows: [{
      decisionId: 19, decisionRef: "OWNER-DECISION-4-88", status: "accepted",
      choice: "APPROVE", authority: "binding", outcomeId: 4, workOrderId: 42,
      terminalEventId: 88,
      evidence: ["request:hermes-owner-decision:4:42:88:owner:APPROVE:EXACT_NEXT_STATE"],
    }] }))
    await expect(readApprovedOwnerDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", expectedNextState: "EXACT_NEXT_STATE",
    })).resolves.toBeNull()
  })

  it("rejects a noncanonical approved next state before reading authority evidence", async () => {
    const query = vi.fn()
    await expect(readApprovedOwnerDecision({
      query, outcomeId: 4, workOrderId: 42, terminalEventId: 88,
      ownerUserId: "owner", expectedNextState: "invalid next state",
    })).resolves.toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("recovers only the exact persisted transient native provider wall", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, userId: "owner", ref: "GOAL-0004" }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recoverNativeProviderOutcome({ query, outcomeId: 4 })).resolves.toBe(true)
    expect(query.mock.calls[0][0]).toMatch(/HERMES_OUTCOME_TERMINAL/)
    expect(query.mock.calls[0][0]).toMatch(/status = 'dismissed'/)
    expect(query.mock.calls[0][0]).toMatch(/"entityId"::text = \(\$1::integer\)::text/)
    expect(query.mock.calls[0][0]).toMatch(/g\.id = \$1::integer/)
    expect(query.mock.calls[0][1]).toEqual([4, NATIVE_PROVIDER_RETRY_STATE])
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_PROVIDER_RECOVERED/)
  })

  it("refuses recovery when persisted terminal evidence does not match", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recovered: false }] })
    await expect(recoverNativeProviderOutcome({ query, outcomeId: 4 })).resolves.toBe(false)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("treats a fully recorded provider recovery as idempotent success", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recovered: true }] })
    await expect(recoverNativeProviderOutcome({ query, outcomeId: 4 })).resolves.toBe(true)
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_PROVIDER_RECOVERED/)
  })

  it("recovers only the exact validation infrastructure terminal", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, userId: "owner", ref: "GOAL-0004" }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(recoverValidationInfrastructureOutcome({
      query, outcomeId: 4, expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED", proofDigest: "b".repeat(64),
    })).resolves.toBe(true)
    expect(query.mock.calls[0][0]).toMatch(/eligible_terminal/)
    expect(query.mock.calls[0][0]).toMatch(/status = 'dismissed'/)
    expect(query.mock.calls[0][0]).toMatch(/NOT EXISTS/)
    expect(query.mock.calls[0][0]).toMatch(/eligible_proof/)
    expect(query.mock.calls[0][0]).not.toMatch(/\)\s*\),\s*eligible_proof/)
    expect(query.mock.calls[0][1]).toEqual([4, "VALIDATION_REMEDIATION_EXHAUSTED", "b".repeat(64)])
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED/)
  })

  it("refuses a mismatched validation infrastructure terminal", async () => {
    await expect(recoverValidationInfrastructureOutcome({
      query: vi.fn(), outcomeId: 4, expectedNextState: "OTHER_STATE",
    })).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_STATE_INVALID" })
  })

  it("treats an exactly recorded validation infrastructure recovery as idempotent", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recovered: true }] })
    await expect(recoverValidationInfrastructureOutcome({
      query, outcomeId: 4, proofDigest: "b".repeat(64),
    })).resolves.toBe(true)
    expect(query.mock.calls[1][0]).toMatch(/HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED/)
  })

  it("persists exact infrastructure proof before outcome recovery", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 99 }] })
    await expect(recordValidationInfrastructureRecoveryProof({
      query, outcomeId: 4, proofDigest: "b".repeat(64), fencingToken: 14,
    })).resolves.toBe(true)
    expect(query.mock.calls[0][0]).toMatch(/HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED/)
    expect(query.mock.calls[0][1][2]).toContain('"fencingToken":14')
  })

  it("creates one deterministic Work Order and appends an idempotent runtime checkpoint", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // insert Work Order
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner", ref: "WO-HERMES-OUTCOME-4" }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] }) // append event
      .mockResolvedValueOnce({ rows: [] }) // update projection
      .mockResolvedValueOnce({ rows: [] }) // COMMIT

    await expect(projectOutcomeRuntimeCheckpoint({
      query,
      outcomeId: 4,
      attempt: 2,
      checkpoint: {
        sequence: 7,
        state: "COMMIT_CREATED",
        detail: "bounded commit",
        metadata: { commit: "a".repeat(40), prNumber: 448 },
      },
    })).resolves.toEqual({
      workOrderId: 42,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      idempotencyKey: "hermes-outcome:4:attempt:2:checkpoint:7",
      status: "active",
      result: null,
      commitRef: "a".repeat(40),
    })

    expect(query.mock.calls[2][0]).toMatch(/INSERT INTO work_order/)
    expect(query.mock.calls[2][0]).toMatch(/NOT EXISTS/)
    expect(query.mock.calls[4][0]).toMatch(/INSERT INTO governance_event/)
    expect(query.mock.calls[4][0]).toMatch(/metadata->>'idempotencyKey'/)
    expect(query.mock.calls[4][1][3]).toContain('"attempt":2')
    expect(query.mock.calls[4][1][3]).toContain('"checkpointSequence":7')
    expect(query.mock.calls[5][1]).toEqual([
      42, "active", null, "a".repeat(40), ["pull-request:#448", `commit:${"a".repeat(40)}`], 2, 7,
    ])
  })

  it.each([
    ["PR_MERGED", "review", null],
    ["OWNER_DECISION_REQUIRED", "blocked", "PARTIAL"],
    ["FAILED_TERMINAL", "blocked", "FAIL"],
    ["COMPLETE", "closed", "PASS"],
  ])("projects %s to truthful Work Order status/result", async (state, status, result) => {
    const eventMetadata = {
      idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:3",
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: 1,
      checkpointSequence: 3,
      checkpointState: state,
      checkpointDetail: null,
    }
    const contentHash = createHash("sha256").update(JSON.stringify(eventMetadata)).digest("hex")
    const persistedEvidence = {
      result,
      repo: "bsvalues/terragroq",
      head: null,
      notes: "Persisted Hermes runtime evidence for hermes-outcome:4:attempt:1:checkpoint:3.",
      contentHash,
    }
    const query = vi.fn(async (sql) => (
      /SELECT result, repo, head, notes/.test(sql)
        ? { rows: [persistedEvidence] }
        : { rows: [] }
    ))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(projectOutcomeRuntimeCheckpoint({
      query, outcomeId: 4, attempt: 1, checkpoint: { sequence: 3, state },
    })).resolves.toMatchObject({ status, result })
    expect(query.mock.calls[5][1].slice(0, 3)).toEqual([42, status, result])
    if (state === "FAILED_TERMINAL") {
      expect(query.mock.calls.some(([sql]) => /HERMES_RUNTIME_FAILURE_EVAL/.test(sql))).toBe(true)
      const evalCall = query.mock.calls.find(([sql]) => /HERMES_RUNTIME_FAILURE_EVAL/.test(sql))
      expect(evalCall?.[1]?.[3]).toContain('"failureClass":"TERMINAL_RUNTIME_FAILURE"')
    }
    if (["FAILED_TERMINAL", "COMPLETE"].includes(state)) {
      const evidenceCall = query.mock.calls.find(([sql]) => /INSERT INTO evidence_record/.test(sql))
      expect(evidenceCall?.[1]).toEqual([
        "owner",
        "EV-HERMES-4-1-3",
        42,
        result,
        null,
        "Persisted Hermes runtime evidence for hermes-outcome:4:attempt:1:checkpoint:3.",
        expect.stringMatching(/^[0-9a-f]{64}$/),
      ])
    } else {
      expect(query.mock.calls.some(([sql]) => /INSERT INTO evidence_record/.test(sql))).toBe(false)
    }
  })

  it("backfills one deterministic evidence record when a terminal checkpoint is replayed", async () => {
    const eventMetadata = {
      idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:3",
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: 1,
      checkpointSequence: 3,
      checkpointState: "COMPLETE",
      checkpointDetail: null,
      mergeSha: "c".repeat(40),
    }
    const payloadDigest = createHash("sha256").update(JSON.stringify(eventMetadata)).digest("hex")
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payloadDigest }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          result: "PASS",
          repo: "bsvalues/terragroq",
          head: "c".repeat(40),
          notes: "Persisted Hermes runtime evidence for hermes-outcome:4:attempt:1:checkpoint:3.",
          contentHash: payloadDigest,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })

    await expect(projectOutcomeRuntimeCheckpoint({
      query,
      outcomeId: 4,
      attempt: 1,
      checkpoint: {
        sequence: 3,
        state: "COMPLETE",
        metadata: { mergeSha: "c".repeat(40) },
      },
    })).resolves.toMatchObject({ status: "closed", result: "PASS" })

    expect(query.mock.calls.some(([sql]) => /UPDATE work_order/.test(sql))).toBe(false)
    const evidenceCall = query.mock.calls.find(([sql]) => /INSERT INTO evidence_record/.test(sql))
    expect(evidenceCall?.[1]).toEqual([
      "owner",
      "EV-HERMES-4-1-3",
      42,
      "PASS",
      "c".repeat(40),
      "Persisted Hermes runtime evidence for hermes-outcome:4:attempt:1:checkpoint:3.",
      payloadDigest,
    ])
  })

  it("rejects a terminal evidence replay that conflicts with the persisted row", async () => {
    const eventMetadata = {
      idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:3",
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: 1,
      checkpointSequence: 3,
      checkpointState: "COMPLETE",
      checkpointDetail: null,
    }
    const payloadDigest = createHash("sha256").update(JSON.stringify(eventMetadata)).digest("hex")
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payloadDigest }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          result: "FAIL",
          repo: "bsvalues/terragroq",
          head: null,
          notes: "conflicting evidence",
          contentHash: "f".repeat(64),
        }],
      })
      .mockResolvedValueOnce({ rows: [] })

    await expect(projectOutcomeRuntimeCheckpoint({
      query,
      outcomeId: 4,
      attempt: 1,
      checkpoint: { sequence: 3, state: "COMPLETE" },
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_EVIDENCE_CONFLICT" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("appends a secret-free idempotent runtime lease event", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [{ id: 92 }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(projectOutcomeRuntimeLease({
      query,
      outcomeId: 4,
      attempt: 3,
      checkpointSequence: 9,
      lease: { status: "RELEASED", expiresAt: "2026-07-23T10:00:00.000Z" },
    })).resolves.toEqual({
      workOrderId: 42,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      idempotencyKey: "hermes-outcome:4:attempt:3:lease:RELEASED:checkpoint:9:expires:1784800800000",
      leaseStatus: "RELEASED",
      checkpointSequence: 9,
    })
    expect(query.mock.calls[3][0]).toMatch(/HERMES_RUNTIME_LEASE/)
    expect(query.mock.calls[3][1][3]).toContain('"leaseStatus":"RELEASED"')
    expect(query.mock.calls[3][1][3]).not.toMatch(/holder|token|secret/i)
  })

  it("rejects malformed runtime lease evidence before persistence", async () => {
    const query = vi.fn()
    await expect(projectOutcomeRuntimeLease({
      query,
      outcomeId: 4,
      attempt: 1,
      checkpointSequence: 0,
      lease: { status: "OWNED", expiresAt: "not-a-date" },
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_LEASE_INVALID" })
    expect(query).not.toHaveBeenCalled()
  })

  it("does not regress the Work Order when an exact checkpoint is replayed", async () => {
    const payloadDigest = createHash("sha256").update(JSON.stringify({
      idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:3",
      outcomeId: 4,
      workOrderRef: "WO-HERMES-OUTCOME-4",
      attempt: 1,
      checkpointSequence: 3,
      checkpointState: "LEASED",
      checkpointDetail: null,
    })).digest("hex")
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payloadDigest }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(projectOutcomeRuntimeCheckpoint({
      query, outcomeId: 4, attempt: 1, checkpoint: { sequence: 3, state: "LEASED" },
    })).resolves.toMatchObject({
      idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:3",
    })
    expect(query.mock.calls.some(([sql]) => /UPDATE work_order/.test(sql))).toBe(false)
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  })

  it("rejects an idempotency-key replay with different checkpoint evidence", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, userId: "owner" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ payloadDigest: "f".repeat(64) }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(projectOutcomeRuntimeCheckpoint({
      query, outcomeId: 4, attempt: 1,
      checkpoint: { sequence: 3, state: "FAILED_TERMINAL", detail: "conflicting replay" },
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("fails closed when a deterministic outcome Work Order is duplicated", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 41 }, { id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(projectOutcomeRuntimeCheckpoint({
      query, outcomeId: 4, attempt: 1, checkpoint: { sequence: 0, state: "LEASED" },
    })).rejects.toMatchObject({ code: "OUTCOME_WORK_ORDER_CARDINALITY_WALL" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("rejects malformed checkpoint commit evidence before persistence", async () => {
    const query = vi.fn()
    await expect(projectOutcomeRuntimeCheckpoint({
      query,
      outcomeId: 4,
      attempt: 1,
      checkpoint: { sequence: 1, state: "COMMIT_CREATED", metadata: { commit: "not-a-sha" } },
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_EVIDENCE_INVALID" })
    expect(query).not.toHaveBeenCalled()
  })

  it("rejects secret-bearing checkpoint detail before persistence", async () => {
    const query = vi.fn()
    await expect(projectOutcomeRuntimeCheckpoint({
      query,
      outcomeId: 4,
      attempt: 1,
      checkpoint: { sequence: 1, state: "RETRYABLE_WALL", detail: "token=opaque-value" },
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_CHECKPOINT_INVALID" })
    expect(query).not.toHaveBeenCalled()
  })

  it("recovers review exhaustion only from exact post-terminal PR/head/merge evidence", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 4, userId: "owner", workOrderId: 42, mergeEventId: 99,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const head = "b".repeat(40)
    const merge = "c".repeat(40)

    await expect(recoverReviewedOutcome({
      query, outcomeId: 4, prNumber: 448, reviewedHeadSha: head, mergeSha: merge,
    })).resolves.toBe(true)
    expect(query.mock.calls[2][0]).toMatch(/merged\.id > candidate\."terminalId"/)
    expect(query.mock.calls[2][1]).toEqual([
      4, "WO-HERMES-OUTCOME-4", "REVIEW_REMEDIATION_EXHAUSTED", 448, head, merge,
    ])
    expect(query.mock.calls[2][0]).toMatch(/status = 'classified'/)
    expect(query.mock.calls[3][0]).toMatch(/HERMES_OUTCOME_REVIEW_RECOVERED/)
  })

  it("refuses review exhaustion recovery without matching persisted evidence", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ recovered: false }] })
      .mockResolvedValueOnce({ rows: [] })
    await expect(recoverReviewedOutcome({
      query,
      outcomeId: 4,
      prNumber: 448,
      reviewedHeadSha: "b".repeat(40),
      mergeSha: "c".repeat(40),
    })).resolves.toBe(false)
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })
})
