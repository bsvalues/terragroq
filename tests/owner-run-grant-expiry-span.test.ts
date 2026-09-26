import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The B2 span test. Every hop of the expiry thread has a test except ONE: the action forwards
 * grantExpiresAt to the transition. The admission suite mocks the action wholesale (it sees the
 * Date arrive AT the action, not leave it); the parity suite mocks the transition away. A
 * regression deleting `grantExpiresAt: opts?.grantExpiresAt` at app/actions/work-orders.ts:150 —
 * the exact defect class B2 named — would re-create a never-expiring grant with every other suite
 * still green. This test executes that hop: real action in, recorded transition call out.
 */

const transitionCalls: Record<string, unknown>[] = []

vi.mock("@/lib/session", () => ({
  getSession: async () => ({ user: { id: "owner-1" } }),
  getUserId: async () => "owner-1",
}))

// The action's db usage is one transaction wrapper; the subject here is argument threading, so the
// transaction body runs against a dummy handle.
vi.mock("@/lib/db", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}))

vi.mock("@/lib/work-orders/governed-transition", () => ({
  transitionWorkOrderInTransaction: async (input: Record<string, unknown>) => {
    transitionCalls.push(input)
    return { ok: true, status: "approved" }
  },
}))

vi.mock("@/lib/governance/authority-grant-write", () => ({
  writeAuthorityGrantArtifact: async () => {},
}))

vi.mock("@/lib/registers/events", () => ({ logEvent: async () => {} }))

describe("transitionWorkOrder forwards the grant expiry into the governed transition", () => {
  beforeEach(() => {
    transitionCalls.length = 0
  })

  it("the Date given to the action is the Date the transition receives (B2 forwarding hop)", async () => {
    const { transitionWorkOrder } = await import("@/app/actions/work-orders")
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const result = await transitionWorkOrder(7, "approved", { grantAuthority: true, grantExpiresAt: expiry })
    expect(result.ok).toBe(true)
    expect(transitionCalls).toHaveLength(1)
    const call = transitionCalls[0]
    expect(call.transaction).toEqual({ __tx: true })
    expect(call.grantAuthority).toBe(true)
    // The load-bearing assertion: identity, not shape — the exact Date survives the hop.
    expect(call.grantExpiresAt).toBe(expiry)
  }, 60_000)

  it("omitting the expiry forwards undefined (no accidental default to never-expiring)", async () => {
    const { transitionWorkOrder } = await import("@/app/actions/work-orders")
    const result = await transitionWorkOrder(8, "approved", { grantAuthority: true })
    expect(result.ok).toBe(true)
    expect(transitionCalls[0].grantExpiresAt).toBeUndefined()
  }, 60_000)
})
