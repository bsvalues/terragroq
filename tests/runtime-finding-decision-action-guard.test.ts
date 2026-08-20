import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(),
  getUserId: vi.fn(async () => "owner-1"), logEvent: vi.fn(), revalidatePath: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: { select: boundary.select, update: boundary.update, insert: boundary.insert, delete: boundary.delete },
}))
vi.mock("@/lib/session", () => ({ getUserId: boundary.getUserId }))
vi.mock("@/lib/registers/events", () => ({ logEvent: boundary.logEvent }))
vi.mock("next/cache", () => ({ revalidatePath: boundary.revalidatePath }))

import {
  deleteDecision,
  linkEvidence,
  setDecisionAuthority,
  supersedeDecision,
  updateDecisionStatus,
} from "@/app/actions/decisions"

function query(rows: unknown[]) {
  const value: Record<string, unknown> = {}
  value.from = vi.fn(() => value)
  value.where = vi.fn(() => value)
  value.limit = vi.fn(() => Promise.resolve(rows))
  value.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject)
  return value
}

const protectedReceipt = {
  id: 71,
  userId: "owner-1",
  ref: "RUNTIME-FINDING-DECISION-501",
  decision: "APPROVE",
  scope: "runtime-finding:501",
  tags: ["RUNTIME_FINDING_OWNER_DECISION", "APPROVE"],
  locked: true,
  evidence: [],
  authority: "binding",
  owner: "owner-1",
}

describe("generic decision action runtime-finding guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    boundary.select.mockImplementation(() => query([protectedReceipt]))
  })

  it("walls status, authority, evidence, supersession, and deletion before any write", async () => {
    const attempts = [
      () => updateDecisionStatus(71, "rejected"),
      () => setDecisionAuthority(71, "advisory"),
      () => linkEvidence(71, "EV-OTHER"),
      () => supersedeDecision(71, { title: "Replacement", decision: "Replace" }),
      () => deleteDecision(71),
    ]

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow("RUNTIME_FINDING_DECISION_GENERIC_MUTATION_WALL")
    }
    expect(boundary.update).not.toHaveBeenCalled()
    expect(boundary.insert).not.toHaveBeenCalled()
    expect(boundary.delete).not.toHaveBeenCalled()
    expect(boundary.logEvent).not.toHaveBeenCalled()
    expect(boundary.revalidatePath).not.toHaveBeenCalled()
  })
})
