import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  pool: { connect: seams.connect },
}))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: vi.fn() }))

import { commitLoomCodexSuccess } from "@/lib/loom/receipts"

describe("strict Codex success receipts", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.connect.mockResolvedValue({ query: seams.query, release: seams.release })
    seams.query.mockResolvedValue({ rows: [] })
  })

  it("atomically writes attempt, outcome, and committed-ready evidence", async () => {
    await commitLoomCodexSuccess({
      userId: "owner-1",
      threadId: "codex-thread-1",
      workspace: "C:/workspace",
      resumed: false,
    })

    const sql = seams.query.mock.calls.map(([statement]) => String(statement))
    expect(sql[0]).toBe("BEGIN")
    expect(sql[1]).toContain("'LOOP_STARTED'")
    expect(sql[2]).toContain("'LOOP_STOPPED'")
    expect(sql[3]).toContain("'loom_codex_ready'")
    expect(sql[4]).toBe("COMMIT")
    expect(sql).not.toContain("ROLLBACK")
    expect(seams.release).toHaveBeenCalledOnce()
  })

  it("rolls back and rejects when any durable write fails", async () => {
    seams.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce({ rows: [] })

    await expect(commitLoomCodexSuccess({
      userId: "owner-1",
      threadId: "codex-thread-1",
      workspace: "C:/workspace",
      resumed: false,
    })).rejects.toThrow("write failed")

    expect(seams.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(seams.query.mock.calls.some(([statement]) => statement === "COMMIT")).toBe(false)
    expect(seams.release).toHaveBeenCalledOnce()
  })
})
