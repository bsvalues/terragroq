/**
 * IF-11 — Cost/quality optimization.
 *
 * Uses measurements to choose among eligible local / private-remote / API options. The optimizer
 * sits STRICTLY BELOW the hard gates (IF-06): it only ever ranks candidates that already cleared
 * the hard gate, and it can never override privacy, authority, or spend limits. A candidate that
 * fails a hard gate is invisible to the optimizer.
 *
 * Provenance, not recommendation: every choice carries an explainable rationale naming the measured
 * inputs (cost, quality, freshness, queue delay, locality) that produced it.
 */

import { hardGate } from "./placement-v1.mjs"

const EVIDENCE_TTL_MS = 300_000

/**
 * Normalize a cost estimate to a comparable 0..1 scale across options. Local compute is treated as
 * near-zero marginal cost; remote/API options carry their measured per-call or per-token cost.
 */
export function normalizeCost(candidate) {
  const cost = candidate.measured?.costPerCallUsd
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return 1 // unknown cost = worst
  // normalize against a $0.10 ceiling; local (≈0) scores ~1 (cheapest -> highest value)
  return Math.max(0, 1 - Math.min(1, cost / 0.10))
}

/** Is the candidate's measured data fresh and in-scope? Stale/unscoped measurements are not trusted. */
export function measuredDataFresh(candidate, policy) {
  const measuredAt = candidate.measured?.measuredAt ? Date.parse(candidate.measured.measuredAt) : NaN
  const nowMs = typeof policy.nowMs === "number" && Number.isFinite(policy.nowMs) ? policy.nowMs : NaN
  if (Number.isNaN(measuredAt) || Number.isNaN(nowMs)) return false
  const age = nowMs - measuredAt
  return age >= 0 && age <= EVIDENCE_TTL_MS
}

/**
 * Optimize among candidates for a requirement. First the hard gate runs — any candidate that fails
 * is excluded with its refusals recorded (the optimizer cannot override privacy/authority/spend).
 * Among the survivors, a value score combines measured quality, normalized cost, queue delay, and
 * locality. Local is preferred when equivalent unless policy.localPreference is false; remote burst
 * is selected only when its measured value clears policy.burstThreshold.
 */
export function optimize(requirement, candidates, policy) {
  const nowMs = policy.nowMs
  const gated = candidates.map((candidate) => {
    const refusals = hardGate(candidate, requirement, policy)
    return { candidate, refusals, eligible: refusals.length === 0 }
  })
  const eligible = gated.filter((g) => g.eligible)
  if (eligible.length === 0) {
    const err = new Error("OPTIMIZER_NO_ELIGIBLE_CANDIDATE")
    err.gated = gated
    throw err
  }

  const localPref = policy.localPreference !== false
  const burstThreshold = typeof policy.burstThreshold === "number" ? policy.burstThreshold : 0.2

  const scored = eligible.map(({ candidate }) => {
    const fresh = measuredDataFresh(candidate, { nowMs })
    const quality = typeof candidate.measured?.qualityScore === "number" ? candidate.measured.qualityScore : 0
    const costValue = normalizeCost(candidate)
    const queueDelay = typeof candidate.measured?.queueDelayMs === "number" ? candidate.measured.queueDelayMs : 0
    const queuePenalty = Math.min(0.3, queueDelay / 100000) // longer queue -> lower value
    const isLocal = ["sovereign-local", "lab", "sovereign"].includes(String(candidate.compute?.trustClass ?? "").toLowerCase())
    const localityBonus = localPref && isLocal ? 0.1 : 0
    // value = quality (0..1) weighted with cost value, minus queue penalty, plus locality bonus.
    // Stale/unscoped measured data zeroes the quality term (freshness/scoping enforced).
    const value = (fresh ? quality : 0) * 0.5 + costValue * 0.4 - queuePenalty + localityBonus
    return {
      candidate,
      value: Math.round(value * 1000) / 1000,
      isLocal,
      fresh,
      inputs: { quality: fresh ? quality : 0, costValue, queuePenalty, localityBonus },
    }
  })

  // Deterministic order: value desc, then candidateId asc (locale-independent).
  const cmp = (a, b) => (String(a.candidate.candidateId) < String(b.candidate.candidateId) ? -1 : 1)
  scored.sort((a, b) => (b.value - a.value) || cmp(a, b))

  const best = scored[0]
  const bestLocal = scored.find((s) => s.isLocal)
  // Local preferred when equivalent: if a local option is within `equivalenceEpsilon` of the best,
  // prefer it unless policy says otherwise. Remote burst only when its value clears the threshold
  // over the best local option.
  const equivalenceEpsilon = 0.05
  let selected = best
  let rationale
  if (localPref && bestLocal && !best.isLocal && best.value - bestLocal.value < burstThreshold) {
    selected = bestLocal
    rationale = `Local preferred: local value ${bestLocal.value} is within burst threshold (${burstThreshold}) of remote best ${best.value}; remote burst does not clear policy.`
  } else if (!best.isLocal && bestLocal && best.value - bestLocal.value >= burstThreshold) {
    selected = best
    rationale = `Remote burst selected: remote value ${best.value} clears policy threshold (${burstThreshold}) over best local ${bestLocal.value} on measured quality/cost.`
  } else if (best.isLocal && localPref) {
    rationale = `Local preferred: ${best.candidate.candidateId} is the highest-value eligible option (value ${best.value}) and local.`
  } else {
    rationale = `Selected highest-value eligible option ${best.candidate.candidateId} (value ${best.value}).`
  }

  return {
    selected: selected.candidate,
    value: selected.value,
    rationale,
    considered: scored.map((s) => ({ candidateId: s.candidate.candidateId, value: s.value, isLocal: s.isLocal, fresh: s.fresh, inputs: s.inputs })),
    refusedByGate: gated.filter((g) => !g.eligible).map((g) => ({ candidateId: g.candidate.candidateId, refusals: g.refusals })),
  }
}
