import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  pool: { connect: seams.connect, query: seams.poolQuery },
}))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: vi.fn() }))

import { commitLoomCodexSuccess, recordLoomCodexAssignment } from "@/lib/loom/receipts"

const successInput = {
  userId: "owner-1",
  threadId: "codex-thread-1",
  workspace: "C:/workspace",
  resumed: false,
  worldId: "world-1",
  outcomeKey: "OUTCOME-1",
  workOrderId: 41,
  grantId: 9,
  assignmentHash: "a".repeat(64),
  selectedPath: "src/selected.ts",
  promotionDigest: "b".repeat(64),
  baseSha: "c".repeat(40),
  taskDigest: "d".repeat(64),
  executionBindingHash: "e".repeat(64),
  promotionAudit: {
    userId: "owner-1",
    path: "src/selected.ts",
    bytes: 26,
    startedAuditId: 77,
    outcome: "SAVED" as const,
    modifiedAt: "2026-08-28T12:01:00.000Z",
  },
}

describe("strict Codex success receipts", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.connect.mockResolvedValue({ query: seams.query, release: seams.release })
    seams.query.mockResolvedValue({ rows: [] })
    seams.poolQuery.mockResolvedValue({ rows: [{ id: 123 }] })
  })

  it("durably records the exact server assignment, task, session, and disposable base before execution", async () => {
    await recordLoomCodexAssignment({
      userId: "owner-1",
      threadId: "codex-thread-1",
      workspace: "C:/workspace",
      worldId: "world-1",
      spaceRevision: 7,
      outcomeId: 5,
      outcomeKey: "OUTCOME-1",
      outcomeVersion: 3,
      workOrderId: 41,
      workOrderRef: "WO-0041",
      workOrderVersion: "2026-08-28T12:00:00.000Z",
      grantId: 9,
      grantRef: "GRANT-0009",
      grantVersion: "grant-hash",
      allowed: ["src/selected.ts"],
      forbidden: ["src/forbidden.ts"],
      contracts: [],
      environments: [],
      reservationVersion: "f".repeat(64),
      selectedPath: "src/selected.ts",
      assignmentHash: "a".repeat(64),
      taskDigest: "d".repeat(64),
      taskText: "Implement the selected change.",
      executionBindingHash: "e".repeat(64),
      isolatedBaseSha: "c".repeat(40),
      resumed: false,
    })

    expect(seams.poolQuery).toHaveBeenCalledWith(expect.stringContaining("loom_codex_assignment"), expect.any(Array))
    const metadata = JSON.parse(seams.poolQuery.mock.calls[0][1][2])
    expect(metadata).toMatchObject({
      owner: "owner-1",
      provider: "Codex",
      mode: "delegate",
      threadId: "codex-thread-1",
      worldId: "world-1",
      spaceRevision: 7,
      outcome: { id: 5, key: "OUTCOME-1", version: 3 },
      workOrder: { id: 41, ref: "WO-0041", version: "2026-08-28T12:00:00.000Z" },
      reservation: {
        allowed: ["src/selected.ts"],
        forbidden: ["src/forbidden.ts"],
        contracts: [],
        environments: [],
        version: "f".repeat(64),
      },
      promotionPath: "src/selected.ts",
      task: { digest: "d".repeat(64), text: "Implement the selected change." },
      isolatedBaseSha: "c".repeat(40),
    })
  })

  it("atomically writes promotion completion, attempt, outcome, and assignment-bound ready evidence", async () => {
    await commitLoomCodexSuccess(successInput)

    const sql = seams.query.mock.calls.map(([statement]) => String(statement))
    expect(sql[0]).toBe("BEGIN")
    expect(sql[1]).toContain("'loom_manual_file_write'")
    expect(sql[1]).toContain("'LOOP_STOPPED'")
    expect(sql[2]).toContain("'LOOP_STARTED'")
    expect(sql[3]).toContain("'LOOP_STOPPED'")
    expect(sql[4]).toContain("'loom_codex_ready'")
    expect(sql[5]).toBe("COMMIT")
    expect(sql).not.toContain("ROLLBACK")
    const readyMetadata = JSON.parse(seams.query.mock.calls[4][1][2])
    expect(readyMetadata).toMatchObject({
      committed: true,
      worldId: "world-1",
      outcomeKey: "OUTCOME-1",
      workOrderId: 41,
      grantId: 9,
      assignmentHash: "a".repeat(64),
      selectedPath: "src/selected.ts",
      promotionDigest: "b".repeat(64),
      baseSha: "c".repeat(40),
    })
    expect(seams.release).toHaveBeenCalledOnce()
  })

  it("rolls back and rejects when any durable write fails", async () => {
    seams.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce({ rows: [] })

    await expect(commitLoomCodexSuccess(successInput)).rejects.toThrow("write failed")

    expect(seams.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(seams.query.mock.calls.some(([statement]) => statement === "COMMIT")).toBe(false)
    expect(seams.release).toHaveBeenCalledOnce()
  })

  it("refuses a promotion audit that is not for the exact assignment path and owner", async () => {
    await expect(commitLoomCodexSuccess({
      ...successInput,
      promotionAudit: { ...successInput.promotionAudit, path: "src/other.ts" },
    })).rejects.toThrow("PROMOTION_AUDIT_MISMATCH")

    expect(seams.connect).not.toHaveBeenCalled()
  })
})
