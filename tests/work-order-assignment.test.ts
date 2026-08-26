import { describe, it, expect } from "vitest"

import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  CLOSED_ASSIGNMENT_STATUSES,
  DECLINE_REASONS,
  LIVE_ASSIGNMENT_STATUSES,
  canTransitionAssignment,
  decideReroute,
  isDeclineReason,
  isLiveAssignment,
  isReclaimable,
  nextLeaseExpiry,
  resolveAccess,
  visibleWorkOrderIds,
  type AssignmentLike,
  type AssignmentStatus,
} from "@/lib/work-orders/assignment"

const OWNER = "owner-user-id"
const AGENT = "agent-principal-id"
const STRANGER = "unrelated-principal-id"

function assignment(over: Partial<AssignmentLike> = {}): AssignmentLike {
  return {
    workOrderId: 19,
    principal: AGENT,
    role: "implementer",
    status: "accepted",
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* P1 — the delegated-subject defect                                   */
/* ------------------------------------------------------------------ */

describe("WORK_ORDER_DELEGATED_SUBJECT_UNRESOLVED", () => {
  it("owner-owned work assigned to an agent is visible to that agent", () => {
    // The whole defect in one assertion. Before the repair the server filtered on userId, so this
    // returned nothing and the agent went looking for work somewhere ungoverned.
    const access = resolveAccess(OWNER, AGENT, [assignment()])
    expect(access.visible).toBe(true)
    expect(access.canExecute).toBe(true)
    expect(access.basis).toBe("assignment")
  })

  it("an agent with no assignment still sees nothing", () => {
    const access = resolveAccess(OWNER, STRANGER, [assignment()])
    expect(access).toMatchObject({ visible: false, canExecute: false, canGovern: false })
  })

  it("the owner keeps everything — the repair is strictly additive", () => {
    const access = resolveAccess(OWNER, OWNER, [])
    expect(access).toMatchObject({
      visible: true,
      canExecute: true,
      canGovern: true,
      basis: "owner",
    })
  })

  it("assignment carries execution but never governance", () => {
    // Handing someone the work is not handing them the authority to approve it, open release
    // gates, or delete the contract.
    const access = resolveAccess(OWNER, AGENT, [assignment({ status: "active" })])
    expect(access.canExecute).toBe(true)
    expect(access.canGovern).toBe(false)
  })

  it("an offer is visible but not yet executable", () => {
    // You cannot accept work you cannot see; you also cannot start it before accepting.
    const access = resolveAccess(OWNER, AGENT, [assignment({ status: "offered" })])
    expect(access.visible).toBe(true)
    expect(access.canExecute).toBe(false)
  })

  it.each(CLOSED_ASSIGNMENT_STATUSES)("a %s assignment grants nothing", (status) => {
    const access = resolveAccess(OWNER, AGENT, [assignment({ status })])
    expect(access.visible).toBe(false)
    expect(access.canExecute).toBe(false)
  })

  it("a reviewer sees the work but does not execute it", () => {
    const access = resolveAccess(OWNER, AGENT, [assignment({ role: "reviewer" })])
    expect(access.visible).toBe(true)
    expect(access.canExecute).toBe(false)
  })

  it("a subagent executes, because delegated implementation is still implementation", () => {
    const access = resolveAccess(OWNER, AGENT, [assignment({ role: "subagent" })])
    expect(access.canExecute).toBe(true)
  })

  it("one live executing assignment is enough among several closed ones", () => {
    const access = resolveAccess(OWNER, AGENT, [
      assignment({ status: "declined" }),
      assignment({ status: "released" }),
      assignment({ status: "active" }),
    ])
    expect(access.canExecute).toBe(true)
    expect(access.via?.status).toBe("active")
  })

  it("assignments belonging to other principals never leak access", () => {
    const access = resolveAccess(OWNER, AGENT, [assignment({ principal: STRANGER })])
    expect(access.visible).toBe(false)
  })

  it("an empty principal does not match an unowned work order", () => {
    // Guards against "" === "" letting an unauthenticated caller in through the owner branch.
    expect(resolveAccess("", "", []).visible).toBe(false)
  })

  it("visibleWorkOrderIds returns only live assignments for this principal", () => {
    const ids = visibleWorkOrderIds(AGENT, [
      assignment({ workOrderId: 1, status: "offered" }),
      assignment({ workOrderId: 2, status: "active" }),
      assignment({ workOrderId: 3, status: "declined" }),
      assignment({ workOrderId: 4, principal: STRANGER, status: "active" }),
    ])
    expect(ids.sort()).toEqual([1, 2])
  })
})

/* ------------------------------------------------------------------ */
/* P2 — assignment ≠ acceptance                                        */
/* ------------------------------------------------------------------ */

describe("assignment lifecycle", () => {
  it("every status has a transition entry", () => {
    for (const s of ASSIGNMENT_STATUSES) {
      expect(ASSIGNMENT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("an offer may be accepted, declined, or revoked", () => {
    expect(canTransitionAssignment("offered", "accepted")).toBe(true)
    expect(canTransitionAssignment("offered", "declined")).toBe(true)
    expect(canTransitionAssignment("offered", "revoked")).toBe(true)
  })

  it("work cannot be declined once it has been accepted", () => {
    // Handing back accepted work is a release, which is a different routing signal.
    expect(canTransitionAssignment("accepted", "declined")).toBe(false)
    expect(canTransitionAssignment("accepted", "released")).toBe(true)
  })

  it.each(CLOSED_ASSIGNMENT_STATUSES)("%s is terminal", (status) => {
    expect(ASSIGNMENT_TRANSITIONS[status]).toEqual([])
  })

  it("live and closed statuses partition the vocabulary", () => {
    const union = [...LIVE_ASSIGNMENT_STATUSES, ...CLOSED_ASSIGNMENT_STATUSES].sort()
    expect(union).toEqual([...ASSIGNMENT_STATUSES].sort())
    for (const s of LIVE_ASSIGNMENT_STATUSES) expect(isLiveAssignment(s)).toBe(true)
    for (const s of CLOSED_ASSIGNMENT_STATUSES) expect(isLiveAssignment(s)).toBe(false)
  })
})

describe("decline is routing information, not a failure", () => {
  it.each(DECLINE_REASONS)("%s is a recognised reason", (reason) => {
    expect(isDeclineReason(reason)).toBe(true)
  })

  it("rejects an untyped reason", () => {
    expect(isDeclineReason("because I do not feel like it")).toBe(false)
    expect(isDeclineReason(undefined)).toBe(false)
  })

  it("a conflict of interest reroutes without touching the contract", () => {
    // The bootstrap case: the executor that is the SUBJECT of a repair declines it, and the router
    // simply offers it to someone else. This is meant to cost zero conversation.
    expect(decideReroute("conflict_of_interest")).toEqual({
      reoffer: true,
      raiseDependency: false,
      contractFault: false,
    })
  })

  it("a missing capability reroutes AND raises a dependency", () => {
    // Otherwise the router happily routes around the same gap forever and nobody ever fixes it.
    expect(decideReroute("capability_unavailable")).toMatchObject({
      reoffer: true,
      raiseDependency: true,
    })
    expect(decideReroute("resource_unreachable")).toMatchObject({ raiseDependency: true })
  })

  it("a contract fault stops the re-offer, because re-offering it unchanged is futile", () => {
    for (const reason of ["authority_insufficient", "premise_invalid"] as const) {
      const d = decideReroute(reason)
      expect(d.contractFault).toBe(true)
      expect(d.reoffer).toBe(false)
    }
  })

  it("plain capacity just moves on", () => {
    expect(decideReroute("capacity")).toEqual({
      reoffer: true,
      raiseDependency: false,
      contractFault: false,
    })
  })
})

/* ------------------------------------------------------------------ */
/* Lease                                                               */
/* ------------------------------------------------------------------ */

describe("lease and reclaim", () => {
  const now = new Date("2026-08-26T12:00:00.000Z")

  it("an expired lease on accepted work is reclaimable", () => {
    const expired = new Date(now.getTime() - 1)
    expect(isReclaimable({ status: "accepted", leaseExpiresAt: expired }, now)).toBe(true)
    expect(isReclaimable({ status: "active", leaseExpiresAt: expired }, now)).toBe(true)
  })

  it("a live lease is not reclaimable", () => {
    const future = new Date(now.getTime() + 60_000)
    expect(isReclaimable({ status: "active", leaseExpiresAt: future }, now)).toBe(false)
  })

  it("an offer is not reclaimable — nobody accepted it, so nothing is parked", () => {
    const expired = new Date(now.getTime() - 1)
    expect(isReclaimable({ status: "offered", leaseExpiresAt: expired }, now)).toBe(false)
  })

  it.each(CLOSED_ASSIGNMENT_STATUSES)("a %s assignment is not reclaimable", (status) => {
    const expired = new Date(now.getTime() - 1)
    expect(isReclaimable({ status: status as AssignmentStatus, leaseExpiresAt: expired }, now)).toBe(
      false,
    )
  })

  it("work with no lease is never swept", () => {
    expect(isReclaimable({ status: "active", leaseExpiresAt: null }, now)).toBe(false)
  })

  it("a lease expiring exactly now is reclaimable, not left in limbo", () => {
    expect(isReclaimable({ status: "active", leaseExpiresAt: now }, now)).toBe(true)
  })

  it("nextLeaseExpiry moves strictly forward", () => {
    expect(nextLeaseExpiry(now).getTime()).toBeGreaterThan(now.getTime())
    expect(nextLeaseExpiry(now, 5_000).toISOString()).toBe("2026-08-26T12:00:05.000Z")
  })
})
