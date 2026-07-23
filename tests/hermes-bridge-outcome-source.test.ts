import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  completeOutcome,
  deferProviderOutcome,
  NATIVE_PROVIDER_RETRY_STATE,
  OUTCOME_SELECTION_SQL,
  projectOutcomeRuntimeCheckpoint,
  recordValidationInfrastructureRecoveryProof,
  recoverNativeProviderOutcome,
  recoverReviewedOutcome,
  recoverValidationInfrastructureOutcome,
  selectNextOutcome,
  terminalizeOutcome,
} from "@/scripts/hermes-bridge/outcome-source.mjs"

const row = { id: 4, ref: "GOAL-0004", command: "Build a WilliamOS status UI", lane: "ui", mode: "implement", risk: "low", authority: "A2_WRITE_OWN", verdict: "allow", requiresApproval: false, matchedRules: [], status: "classified" }

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
    expect(query.mock.calls[1][1]).toEqual([4, "FAILED_TERMINAL", "POLICY_WALL"])
    expect(query.mock.calls[1][0]).toMatch(/terminal\."entityId"::text = g\.id::text/)
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
    ["FAILED_TERMINAL", "blocked", "FAIL"],
    ["COMPLETE", "closed", "PASS"],
  ])("projects %s to truthful Work Order status/result", async (state, status, result) => {
    const query = vi.fn()
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
