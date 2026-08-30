import { beforeEach, describe, expect, it, vi } from "vitest"

import { evaluateDoctrine } from "@/lib/governance/doctrine-evaluator"

const seams = vi.hoisted(() => ({ getUserId: vi.fn(), transition: vi.fn(), transaction: vi.fn() }))

vi.mock("@/lib/session", () => ({ getUserId: seams.getUserId }))
vi.mock("@/lib/db", () => ({ db: { transaction: seams.transaction } }))
vi.mock("@/lib/work-orders/governed-transition", () => ({
  transitionWorkOrderInTransaction: seams.transition,
}))

import { transitionWorkOrder } from "@/app/actions/work-orders"

// Both callers must retain identical transition and Doctrine semantics.
describe("canonical Work Order action parity", () => {
  beforeEach(() => {
    seams.getUserId.mockReset().mockResolvedValue("owner-1")
    seams.transition.mockReset().mockResolvedValue({ ok: true, status: "active", workOrder: {} })
    seams.transaction.mockReset().mockImplementation(async (operation) => operation("transaction"))
  })

  it("keeps the server action contract while delegating all gates to the transactional seam", async () => {
    await expect(transitionWorkOrder(41, "active", {
      approveDoctrine: true, grantAuthority: true,
    })).resolves.toEqual({ ok: true, status: "active" })
    expect(seams.transition).toHaveBeenCalledWith(expect.objectContaining({
      transaction: "transaction", userId: "owner-1", workOrderId: 41, to: "active",
      approveDoctrine: true, grantAuthority: true,
    }))
  })

  it("preserves a typed refusal without performing a second write path", async () => {
    const refusal = { ok: false, reason: "Activation blocked by doctrine", verdict: {
      verdict: "forbidden", matches: [{ ref: "RULE-1", title: "No delete", reason: "delete" }],
    } }
    seams.transition.mockResolvedValueOnce(refusal)
    await expect(transitionWorkOrder(41, "active", { approveDoctrine: true })).resolves.toEqual(refusal)
    expect(seams.transaction).toHaveBeenCalledOnce()
  })
})

describe("canonical Doctrine evaluation parity", () => {
  const rules = [{
    ref: "RULE-1", title: "Bound writes", allowed: ["read"],
    forbidden: ["delete"], requiresApproval: ["write"],
  }]

  it("preserves forbidden > requires approval > allowed precedence", () => {
    expect(evaluateDoctrine("read then write then delete", rules).verdict).toBe("forbidden")
    expect(evaluateDoctrine("read then write", rules).verdict).toBe("requires_approval")
    expect(evaluateDoctrine("read only", rules).verdict).toBe("allowed")
    expect(evaluateDoctrine("inspect", rules)).toEqual({ verdict: "unspecified", matches: [] })
  })
})
