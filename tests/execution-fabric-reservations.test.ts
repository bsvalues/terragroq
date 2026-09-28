import { describe, expect, it } from "vitest"

import { AcceleratorReservationSchema } from "@/components/operator/intelligence-fabric-contracts"
import { createReservationManager } from "../scripts/execution-fabric/reservation-manager.mjs"

const NOW = Date.parse("2026-09-10T14:00:00Z")
const lease = (ms) => new Date(NOW + ms).toISOString()
const req = (id, bytes, opts = {}) => ({
  id,
  requestId: `req-${id}`,
  computeResourceId: "daedalus",
  workRef: `work-${id}`,
  requestedWeightBytes: bytes,
  requestedKvBytes: 0,
  requestedRuntimeOverheadBytes: 0,
  requestedSystemMemoryBytes: 0,
  priority: "NORMAL",
  preemptible: true,
  leaseExpiresAt: lease(3600_000),
  ...opts,
})

describe("IF-08 reservation manager", () => {
  it("an admitted reservation validates against the AcceleratorReservation contract", () => {
    const m = createReservationManager({ capacityBytes: 24e9, now: () => NOW })
    const r = m.admit(req("r1", 16e9))
    expect(AcceleratorReservationSchema.safeParse(r).success).toBe(true)
    expect(r.state).toBe("ACTIVE")
    expect(r.fencingToken).toBeGreaterThan(0)
  })

  it("concurrent reservations cannot exceed governed capacity", () => {
    const m = createReservationManager({ capacityBytes: 24e9, now: () => NOW })
    m.admit(req("r1", 16e9, { priority: "INTERACTIVE", preemptible: false }))
    // a second NORMAL request that would overflow, with nothing preemptible available, is refused
    expect(() => m.admit(req("r2", 16e9, { priority: "NORMAL" }))).toThrow(/RESERVATION_CAPACITY_EXHAUSTED/)
  })

  it("expired lease releases capacity deterministically", () => {
    let clock = NOW
    const m = createReservationManager({ capacityBytes: 24e9, now: () => clock })
    m.admit(req("r1", 16e9, { leaseExpiresAt: lease(1000) }))
    clock = NOW + 2000 // lease expired
    // the next admit sweeps the expired lease, freeing capacity
    const r2 = m.admit(req("r2", 16e9))
    expect(r2.state).toBe("ACTIVE")
    expect(m.get("r1").state).toBe("EXPIRED")
  })

  it("background job can be preempted by interactive work", () => {
    const m = createReservationManager({ capacityBytes: 24e9, now: () => NOW })
    m.admit(req("bg", 16e9, { priority: "BACKGROUND", preemptible: true }))
    const interactive = m.admit(req("ui", 16e9, { priority: "INTERACTIVE", preemptible: false }))
    expect(interactive.state).toBe("ACTIVE")
    expect(m.get("bg").state).toBe("RELEASED") // preempted background released
  })

  it("non-preemptible active work is not evicted silently", () => {
    const m = createReservationManager({ capacityBytes: 24e9, now: () => NOW })
    m.admit(req("critical", 16e9, { priority: "NORMAL", preemptible: false }))
    // even a REALTIME request cannot evict non-preemptible active work; admission is refused instead
    expect(() => m.admit(req("rt", 16e9, { priority: "REALTIME", preemptible: false }))).toThrow(/RESERVATION_CAPACITY_EXHAUSTED/)
    expect(m.get("critical").state).toBe("ACTIVE")
  })

  it("crash/restart reconstructs safe reservation truth (expired ACTIVE is not still-holding)", () => {
    let clock = NOW
    const m = createReservationManager({ capacityBytes: 24e9, now: () => clock })
    const crashed = [
      { ...req("held", 16e9), state: "ACTIVE", fencingToken: 3, leaseExpiresAt: lease(1000) },
    ]
    clock = NOW + 5000 // after the lease
    const reconstructed = m.reconstruct(crashed)
    expect(reconstructed.find((r) => r.id === "held").state).toBe("EXPIRED") // safe to reuse
    // a new admit fits because the crashed holder's capacity is reclaimed
    expect(m.capacityHeld()).toBe(0)
    expect(m.admit(req("new", 16e9)).state).toBe("ACTIVE")
  })

  it("illegal transitions are refused by the contract's own table", () => {
    const m = createReservationManager({ capacityBytes: 24e9, now: () => NOW })
    m.admit(req("r1", 8e9))
    m.release("r1")
    expect(() => m.transition("r1", "ACTIVE")).toThrow(/RESERVATION_ILLEGAL_TRANSITION/) // RELEASED -> ACTIVE is not allowed
  })
})
