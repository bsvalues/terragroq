import { describe, expect, it, vi } from "vitest"

import { completeOutcome, OUTCOME_SELECTION_SQL, selectNextOutcome } from "@/scripts/hermes-bridge/outcome-source.mjs"

const row = { id: 4, ref: "GOAL-0004", command: "Build a WilliamOS status UI", lane: "ui", mode: "implement", risk: "low", authority: "A2_WRITE_OWN", verdict: "allow", requiresApproval: false, matchedRules: [], status: "classified" }

describe("Hermes bridge PostgreSQL outcome source", () => {
  it("uses one deterministic parameterized row selection", async () => {
    const query = vi.fn(async () => ({ rows: [row] }))
    await expect(selectNextOutcome({ query })).resolves.toEqual(row)
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0][0]).toBe(OUTCOME_SELECTION_SQL)
    expect(OUTCOME_SELECTION_SQL).toMatch(/ORDER BY "createdAt" ASC, id ASC\s+LIMIT 1/)
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(["classified", ["allow", "requires_approval"], "low"]))
  })

  it("returns null for no row or a policy-ineligible injected row", async () => {
    await expect(selectNextOutcome({ query: async () => ({ rows: [] }) })).resolves.toBeNull()
    await expect(selectNextOutcome({ query: async () => ({ rows: [{ ...row, command: "Retry issue #357" }] }) })).resolves.toBeNull()
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
})
