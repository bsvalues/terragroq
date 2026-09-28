/**
 * IF-08 — Accelerator reservations and model residency.
 *
 * Prevents over-admission and manages warm models intentionally. A reservation holds capacity with
 * lease + fencing semantics; concurrent reservations can never exceed governed capacity; an expired
 * lease releases deterministically; interactive work can preempt background work; non-preemptible
 * active work is never silently evicted; and a crash/restart reconstructs safe reservation truth
 * from the durable log (an ACTIVE reservation with an expired lease is treated as EXPIRED, never as
 * still-holding).
 */

import { isValidReservationTransition } from "../../components/operator/intelligence-fabric-contracts.ts"

const PRIORITY_RANK = { REALTIME: 5, INTERACTIVE: 4, NORMAL: 3, BACKGROUND: 2, MAINTENANCE: 1 }

export function createReservationManager({ capacityBytes, now = () => Date.now() } = {}) {
  if (typeof capacityBytes !== "number" || capacityBytes <= 0) throw new Error("RESERVATION_CAPACITY_INVALID")
  let fencingCounter = 0
  const reservations = new Map()

  const totalRequested = (r) => r.requestedWeightBytes + r.requestedKvBytes + r.requestedRuntimeOverheadBytes + r.requestedSystemMemoryBytes
  const liveHolding = (r) => r.state === "ACTIVE" || r.state === "PREEMPTING"

  function capacityHeld() {
    let held = 0
    for (const r of reservations.values()) if (liveHolding(r)) held += totalRequested(r)
    return held
  }

  function sweepExpired() {
    const nowMs = now()
    for (const r of reservations.values()) {
      if (liveHolding(r) && Date.parse(r.leaseExpiresAt) <= nowMs) r.state = "EXPIRED"
    }
  }

  function admit(request) {
    sweepExpired()
    const need = totalRequested(request)
    if (need > capacityBytes) throw new Error("RESERVATION_EXCEEDS_TOTAL_CAPACITY")

    if (capacityHeld() + need > capacityBytes) {
      // Preempt lower-priority preemptible ACTIVE work to make room for a higher-priority request.
      const preemptible = [...reservations.values()]
        .filter((r) => r.state === "ACTIVE" && r.preemptible && PRIORITY_RANK[r.priority] < PRIORITY_RANK[request.priority])
        .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      for (const victim of preemptible) {
        if (capacityHeld() + need <= capacityBytes) break
        victim.state = "PREEMPTING"
        victim.state = "RELEASED"
      }
    }

    // Concurrent reservations can never exceed governed capacity: if it still doesn't fit (the only
    // holders are non-preemptible or equal/higher priority), admission is refused. Non-preemptible
    // active work is never evicted.
    if (capacityHeld() + need > capacityBytes) throw new Error("RESERVATION_CAPACITY_EXHAUSTED")

    fencingCounter += 1
    const reservation = { ...request, fencingToken: fencingCounter, state: "ACTIVE" }
    reservations.set(reservation.id, reservation)
    return reservation
  }

  function transition(id, to) {
    const r = reservations.get(id)
    if (!r) throw new Error("RESERVATION_NOT_FOUND")
    if (!isValidReservationTransition(r.state, to)) throw new Error(`RESERVATION_ILLEGAL_TRANSITION:${r.state}->${to}`)
    r.state = to
    return r
  }

  function release(id) { return transition(id, "RELEASED") }

  function reconstruct(durableLog) {
    reservations.clear()
    fencingCounter = 0
    const nowMs = now()
    for (const entry of durableLog ?? []) {
      const r = { ...entry }
      if (liveHolding(r) && Date.parse(r.leaseExpiresAt) <= nowMs) r.state = "EXPIRED"
      reservations.set(r.id, r)
      if (typeof r.fencingToken === "number" && r.fencingToken > fencingCounter) fencingCounter = r.fencingToken
    }
    return [...reservations.values()]
  }

  return { admit, release, transition, reconstruct, capacityHeld, sweepExpired, get: (id) => reservations.get(id), all: () => [...reservations.values()] }
}
