import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkAgentPermission } from "@/lib/goal/agent-matrix"

/**
 * The admission half of the owner-run seam, exercised against the REAL agent matrix.
 *
 * Why this file exists: the route suite mocks `owner-run-dispatch` wholesale, so it happily
 * passed while every real POST was refused — the contract named an agent the matrix has never
 * heard of ("gpu-tabular-dispatch"), and `transitionWorkOrder(…,"approved")` therefore returned
 * `Unknown agent … no permission profile` before the seam was ever reached. These tests bind the
 * contract to the matrix and the grant to a real expiry, so that class of defect fails here
 * instead of in front of the owner.
 */

const actions = {
  createWorkOrder: vi.fn(async () => ({ id: 41, ref: "WO-41" })),
  updateWorkOrderContract: vi.fn(async () => undefined),
  transitionWorkOrder: vi.fn(async () => ({ ok: true, status: "approved" })),
}
const authority = { revokeAuthorityGrant: vi.fn(async () => undefined) }
const poolQuery = vi.fn(async () => ({ rows: [{ authorityGrantId: 9 }] }))

vi.mock("@/app/actions/work-orders", () => actions)
vi.mock("@/app/actions/authority", () => authority)
vi.mock("@/lib/db", () => ({ pool: { query: poolQuery } }))

const {
  OWNER_RUN_AGENT,
  OWNER_RUN_AUTHORITY_LEVEL,
  OWNER_RUN_GRANT_TTL_MS,
  admitOwnerRunWorkOrder,
  settleOwnerRunGrant,
} = await import("@/lib/environment/owner-run-dispatch")

describe("owner-run admission binds to the real governed matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.createWorkOrder.mockResolvedValue({ id: 41, ref: "WO-41" })
    actions.updateWorkOrderContract.mockResolvedValue(undefined)
    actions.transitionWorkOrder.mockResolvedValue({ ok: true, status: "approved" })
    authority.revokeAuthorityGrant.mockResolvedValue(undefined)
    poolQuery.mockResolvedValue({ rows: [{ authorityGrantId: 9 }] })
  })

  it("names an agent the matrix actually admits at the lane's authority level", () => {
    // The exact regression the first review round found: a plausible-but-unregistered agent id
    // made approval impossible, so the capability was dead on the write side while its tests
    // stayed green.
    const verdict = checkAgentPermission(OWNER_RUN_AGENT, OWNER_RUN_AUTHORITY_LEVEL)
    expect(verdict, `agent "${OWNER_RUN_AGENT}" must be registered and capped at ${OWNER_RUN_AUTHORITY_LEVEL}`).toEqual({
      allowed: true,
      reason: expect.any(String),
    })
  })

  it("contracts the work order to that same agent and authority level", async () => {
    const admission = await admitOwnerRunWorkOrder("regression", 60_000)
    expect(admission.ok).toBe(true)
    expect(actions.updateWorkOrderContract).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ agent: OWNER_RUN_AGENT, authorityLevel: OWNER_RUN_AUTHORITY_LEVEL }),
    )
  })

  it("mints the grant through the governed transition WITH a bounded expiry", async () => {
    const before = Date.now()
    const admission = await admitOwnerRunWorkOrder("regression", 60_000)
    expect(admission.ok).toBe(true)

    expect(actions.transitionWorkOrder).toHaveBeenCalledWith(41, "approved", expect.objectContaining({
      grantAuthority: true,
      grantExpiresAt: expect.any(Date),
    }))
    const approveCall = actions.transitionWorkOrder.mock.calls.find((call) => call[1] === "approved")
    const expiry = approveCall?.[2]?.grantExpiresAt as Date
    // A grant minted with expiresAt = null never expires (isGrantActive reads null as active
    // forever), so the crash-before-settle backstop the module documents only exists when this
    // date is really threaded through.
    expect(expiry.getTime()).toBeGreaterThan(before + OWNER_RUN_GRANT_TTL_MS - 60_000)
    expect(expiry.getTime()).toBeLessThan(before + OWNER_RUN_GRANT_TTL_MS + 60_000)
  })

  it("aborts before approving when the propose step is refused", async () => {
    actions.transitionWorkOrder.mockResolvedValueOnce({ ok: false, reason: "Illegal transition: approved → proposed" })
    const admission = await admitOwnerRunWorkOrder("regression", 60_000)
    expect(admission).toMatchObject({ ok: false, error: "OWNER_RUN_WO_PROPOSE_REFUSED" })
    expect(actions.transitionWorkOrder).not.toHaveBeenCalledWith(41, "approved", expect.anything())
  })

  it("reports the approve refusal with its missing requirements", async () => {
    actions.transitionWorkOrder
      .mockResolvedValueOnce({ ok: true, status: "proposed" })
      .mockResolvedValueOnce({ ok: false, reason: "Not ready for authorization", missing: ["Set scope"] })
    const admission = await admitOwnerRunWorkOrder("regression", 60_000)
    expect(admission).toMatchObject({ ok: false, error: "OWNER_RUN_WO_APPROVE_REFUSED", missing: ["Set scope"] })
  })
})

describe("owner-run settle completes the record even when the revoke is refused", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [{ authorityGrantId: 9 }] })
    actions.transitionWorkOrder.mockResolvedValue({ ok: true, status: "aborted" })
  })

  it("still aborts the work order when the grant revoke throws (already-inactive race)", async () => {
    authority.revokeAuthorityGrant.mockRejectedValue(new Error("Cannot revoke: grant is not active"))
    const settle = await settleOwnerRunGrant(1, "test settle")
    // The WO must be closed regardless: an open record nothing will ever close was the measured
    // defect of the first settle implementation.
    expect(actions.transitionWorkOrder).toHaveBeenCalledWith(1, "aborted")
    expect(settle.ok).toBe(false)
    expect(settle.ok === false && settle.error).toBe("OWNER_RUN_SETTLE_INCOMPLETE")
    expect(settle.ok === false && settle.detail).toContain("grant revoke")
  })

  it("reports a clean settle when both steps land", async () => {
    authority.revokeAuthorityGrant.mockResolvedValue(undefined)
    const settle = await settleOwnerRunGrant(1, "test settle")
    expect(settle.ok).toBe(true)
    expect(authority.revokeAuthorityGrant).toHaveBeenCalledWith(9, "test settle")
    expect(actions.transitionWorkOrder).toHaveBeenCalledWith(1, "aborted")
  })
})