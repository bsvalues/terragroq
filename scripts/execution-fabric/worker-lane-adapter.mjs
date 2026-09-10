/**
 * IF-07 — Worker/provider integration: lane capability request adapter.
 *
 * Connects Fabric placement (IF-06) to the existing governed worker lanes (Codex, Claude, Hermes
 * local). The adapter translates a PlacementDecision's selected candidate into a lane capability
 * request WITHOUT changing Work Order / AEGIS / Git lifecycle authority:
 *
 *  - assigned lane semantics are preserved (the lane the kernel assigned is honored first);
 *  - a provider rate limit produces a TYPED re-placement/wait, never an unauthorized retry or a
 *    silent lane swap the owner can't see;
 *  - no worker ever chooses its own next parent outcome — the adapter returns a recommendation the
 *    KERNEL acts on; it never mutates authority, advances an outcome, or touches Git;
 *  - no Fabric action creates unauthorized repository effects (read-only translation only).
 */

// Typed re-placement / wait signals (IdentifierSchema-safe).
export const LANE_SIGNALS = Object.freeze({
  SERVE: "serve",
  REPLACEMENT: "re-placement",
  WAIT: "wait",
})

/**
 * Translate a Fabric placement selection into a lane capability request. Read-only: returns the
 * request the kernel should issue, honoring the assigned lane first.
 *
 * placement: { selected: { candidateId }, fallbackCandidateIds: [] }
 * roster: the governed laneRoster() entries [{ id, capabilities, binary? , unavailableUntil? }]
 * opts: { assignedLaneId?, requiredCapability, nowMs }
 */
export function laneCapabilityRequest(placement, roster, opts) {
  const { assignedLaneId = null, requiredCapability, nowMs = 0 } = opts
  if (!requiredCapability) throw new Error("LANE_CAPABILITY_REQUIRED")

  // The selected Fabric candidate maps to a lane by candidateId == lane id. The assigned lane is
  // honored first when it can serve (assigned-lane semantics preserved where required).
  const byId = new Map(roster.map((lane) => [lane.id, lane]))
  const canServe = (laneId) => {
    const lane = byId.get(laneId)
    if (!lane) return false
    if (!lane.capabilities.includes(requiredCapability)) return false
    const unavailableUntil = lane.unavailableUntil ? Date.parse(lane.unavailableUntil) : NaN
    if (!Number.isNaN(unavailableUntil) && unavailableUntil > nowMs) return false // known-empty meter
    return true
  }

  if (assignedLaneId && canServe(assignedLaneId)) {
    return { signal: LANE_SIGNALS.SERVE, laneId: assignedLaneId, reason: "assigned lane can serve", authorityMutated: false, repositoryEffect: false }
  }
  const selectedId = placement?.selected?.candidateId
  if (selectedId && canServe(selectedId)) {
    return { signal: LANE_SIGNALS.SERVE, laneId: selectedId, reason: `fabric-selected lane ${selectedId} can serve`, authorityMutated: false, repositoryEffect: false }
  }
  for (const fallbackId of placement?.fallbackCandidateIds ?? []) {
    if (canServe(fallbackId)) {
      return { signal: LANE_SIGNALS.REPLACEMENT, laneId: fallbackId, reason: `re-placed to fallback lane ${fallbackId}`, authorityMutated: false, repositoryEffect: false }
    }
  }
  return { signal: LANE_SIGNALS.WAIT, laneId: null, reason: "no governed lane can serve the required capability now", authorityMutated: false, repositoryEffect: false }
}

/**
 * Fold provider availability/failure feedback into a re-placement decision. A provider rate limit
 * on the serving lane produces a TYPED wait or re-placement — never an unauthorized retry against
 * a known-empty meter, and never a lane choosing its own next parent outcome.
 *
 * providerStatus: { laneId, kind: "rate-limit" | "failure" | "ok", retryAfterMs? }
 */
export function providerFeedback(providerStatus, roster, placement, opts) {
  if (providerStatus.kind === "ok") {
    return { signal: LANE_SIGNALS.SERVE, laneId: providerStatus.laneId, reason: "provider healthy", authorityMutated: false, repositoryEffect: false }
  }
  if (providerStatus.kind === "rate-limit") {
    // Try another governed lane before parking as a typed timed wait.
    const alt = laneCapabilityRequest(placement, roster.filter((l) => l.id !== providerStatus.laneId), opts)
    if (alt.signal === LANE_SIGNALS.SERVE || alt.signal === LANE_SIGNALS.REPLACEMENT) {
      return { ...alt, reason: `provider ${providerStatus.laneId} rate-limited; re-placed to ${alt.laneId}` }
    }
    return { signal: LANE_SIGNALS.WAIT, laneId: null, waitMs: providerStatus.retryAfterMs ?? 60_000, reason: `provider ${providerStatus.laneId} rate-limited; no alternative lane`, authorityMutated: false, repositoryEffect: false }
  }
  // failure: re-place if possible, else wait
  const alt = laneCapabilityRequest(placement, roster.filter((l) => l.id !== providerStatus.laneId), opts)
  return alt.signal === LANE_SIGNALS.WAIT
    ? { ...alt, reason: `provider ${providerStatus.laneId} failed; no alternative lane` }
    : { ...alt, reason: `provider ${providerStatus.laneId} failed; re-placed to ${alt.laneId}` }
}
