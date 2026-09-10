/**
 * IF-06 — Local placement V1: hard-gate evaluator.
 *
 * Turns an InferenceRequirement into a durable, deterministic PlacementDecision. The hard gate
 * ALWAYS beats score: a candidate that fails any hard gate is ineligible with a typed refusal, no
 * matter how high it scores. Data locality is a hard gate, not a preference: a sovereign-class
 * (S3/S4) requirement can never be placed on a compute resource outside the local trust boundary.
 *
 * Determinism: the same requirement + registry + policy always yields the same selected candidate,
 * the same fallback chain, and the same per-candidate evidence. Scoring has no randomness and no
 * wall-clock dependence.
 */

// Typed hard-gate refusals (IdentifierSchema-safe).
export const PLACEMENT_REFUSALS = Object.freeze({
  UNPROVEN_CAPABILITY: "unproven-capability",
  STALE_CAPACITY: "stale-capacity",
  CONTEXT_TOO_LARGE: "context-too-large",
  DATA_LOCALITY_VIOLATION: "data-locality-violation",
  CAPACITY_INSUFFICIENT: "capacity-insufficient",
  UNAPPROVED_NODE: "unapproved-node",
  UNHEALTHY_RUNTIME: "unhealthy-runtime",
})

const SOVEREIGN_CLASSES = new Set(["S3", "S4"])
const LOCAL_TRUST = new Set(["sovereign-local", "lab", "sovereign"])
const CAPACITY_TTL_MS = 300_000

/** Is a candidate's trust class inside the local boundary for sovereign data? */
function withinLocalBoundary(candidate) {
  return LOCAL_TRUST.has(String(candidate.compute?.trustClass ?? "").toLowerCase())
}

/**
 * Evaluate one candidate against the hard gates. Returns the typed refusals that apply; an empty
 * array means the candidate cleared every gate. Hard gates run before any scoring.
 *
 * candidate: { candidateId, model, runtime, compute, capabilityEvidence?, capacity?, runtimeState }
 * requirement: { capability, contextClass, estimatedTokens, contextMaxTokens?, requiredVramBytes? }
 *   contextMaxTokens (optional) tightens the effective context limit below the candidate's window.
 */
export function hardGate(candidate, requirement, policy) {
  const refusals = []

  // Data locality — sovereign data never leaves the local boundary, regardless of score.
  if (SOVEREIGN_CLASSES.has(requirement.contextClass) && !withinLocalBoundary(candidate)) {
    refusals.push(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
  }

  // Unproven capability — a candidate without in-scope MEASURED/PROVEN evidence is refused.
  const ev = candidate.capabilityEvidence
  if (!ev || !["MEASURED", "PROVEN"].includes(ev.verdict) || ev.capability !== requirement.capability) {
    refusals.push(PLACEMENT_REFUSALS.UNPROVEN_CAPABILITY)
  }

  // Unapproved node — placement is decided by the system against approved capacity, not self-declared.
  if (!candidate.compute || candidate.compute.admissionState !== "APPROVED") {
    refusals.push(PLACEMENT_REFUSALS.UNAPPROVED_NODE)
  }

  // Unhealthy runtime.
  if (!["healthy", "running"].includes(String(candidate.runtimeState ?? "").toLowerCase())) {
    refusals.push(PLACEMENT_REFUSALS.UNHEALTHY_RUNTIME)
  }

  // Stale capacity — a capacity observation that is missing, non-numeric, older than the TTL, or
  // future-dated (negative age) is refused. The gate is fail-closed: an unprovable clock never
  // reads as "fresh".
  const observedAt = candidate.capacity?.observedAt ? Date.parse(candidate.capacity.observedAt) : NaN
  const nowMs = typeof policy.nowMs === "number" && Number.isFinite(policy.nowMs) ? policy.nowMs : NaN
  const ageMs = Number.isNaN(observedAt) || Number.isNaN(nowMs) ? NaN : nowMs - observedAt
  if (!candidate.capacity || Number.isNaN(ageMs) || ageMs < 0 || ageMs > CAPACITY_TTL_MS) {
    refusals.push(PLACEMENT_REFUSALS.STALE_CAPACITY)
  } else {
    // Capacity sufficiency is fail-closed: a requirement that names a VRAM need can only be met by
    // a candidate that PROVES a numeric free-VRAM figure meeting it. Absent or non-numeric = refused.
    if (typeof requirement.requiredVramBytes === "number") {
      if (typeof candidate.capacity.freeVramBytes !== "number" || !Number.isFinite(candidate.capacity.freeVramBytes) || candidate.capacity.freeVramBytes < requirement.requiredVramBytes) {
        refusals.push(PLACEMENT_REFUSALS.CAPACITY_INSUFFICIENT)
      }
    }
  }

  // Context too large — fail-closed: when the requirement names an estimated token count, the
  // candidate must PROVE its own context window fits it. The requirement's contextMaxTokens is a
  // contractual budget that can only TIGHTEN the limit below the candidate's proven window — it
  // never substitutes for the candidate's own window (an unprovable candidate window is refused).
  if (typeof requirement.estimatedTokens === "number") {
    const candidateLimit = typeof candidate.model?.contextMaxTokens === "number" && Number.isFinite(candidate.model.contextMaxTokens) ? candidate.model.contextMaxTokens : NaN
    const requirementLimit = typeof requirement.contextMaxTokens === "number" && Number.isFinite(requirement.contextMaxTokens) ? requirement.contextMaxTokens : NaN
    if (Number.isNaN(candidateLimit)) {
      refusals.push(PLACEMENT_REFUSALS.CONTEXT_TOO_LARGE)
    } else {
      const effectiveLimit = Number.isNaN(requirementLimit) ? candidateLimit : Math.min(candidateLimit, requirementLimit)
      if (requirement.estimatedTokens > effectiveLimit) refusals.push(PLACEMENT_REFUSALS.CONTEXT_TOO_LARGE)
    }
  }

  return refusals
}

/** Deterministic score for an eligible candidate. Higher is better; no randomness, no wall clock. */
export function scoreCandidate(candidate, requirement) {
  let score = 0
  if (withinLocalBoundary(candidate)) score += 100 // prefer the local boundary when lawful
  if (candidate.capabilityEvidence?.verdict === "PROVEN") score += 50
  else if (candidate.capabilityEvidence?.verdict === "MEASURED") score += 30
  if (typeof candidate.capacity?.freeVramBytes === "number") score += Math.min(50, Math.floor(candidate.capacity.freeVramBytes / 1e9))
  // Stable tiebreak: lower candidateId wins, so equal scores resolve deterministically.
  return score
}

/**
 * Evaluate a requirement into a PlacementDecision. Hard gate beats score: every candidate is gated
 * first; only eligible candidates are scored; the selection is the highest-scoring eligible
 * candidate with a stable tiebreak; the fallback chain is the remaining eligible candidates in
 * score order. Evidence explains every considered candidate.
 */
export function evaluatePlacement(requirement, candidates, policy) {
  const considered = candidates.map((candidate) => {
    const refusals = hardGate(candidate, requirement, policy)
    const eligible = refusals.length === 0
    return {
      candidateId: candidate.candidateId,
      eligible,
      refusals,
      ...(eligible ? { score: scoreCandidate(candidate, requirement) } : {}),
      evidenceRefs: [
        candidate.capabilityEvidence ? `evidence://${candidate.capabilityEvidence.id}` : "evidence://none",
        candidate.compute ? `compute://${candidate.compute.id}` : "compute://none",
      ],
    }
  })

  const eligible = considered.filter((c) => c.eligible)
  if (eligible.length === 0) {
    const err = new Error("PLACEMENT_NO_ELIGIBLE_CANDIDATE")
    err.considered = considered
    throw err
  }

  // Deterministic ordering: score desc, then candidateId asc using a locale-independent
  // code-unit comparison so equal scores resolve identically under any ICU/locale config.
  const cmpId = (a, b) => (String(a.candidateId) < String(b.candidateId) ? -1 : String(a.candidateId) > String(b.candidateId) ? 1 : 0)
  const ranked = [...eligible].sort((a, b) => (b.score - a.score) || cmpId(a, b))
  const winner = ranked[0]
  const winnerCandidate = candidates.find((c) => c.candidateId === winner.candidateId)

  return {
    considered,
    selected: winnerCandidate,
    fallbackCandidateIds: ranked.slice(1).map((c) => c.candidateId),
    reason: `Selected ${winner.candidateId}: highest score (${winner.score}) among ${eligible.length} hard-gate-eligible candidate(s); ${considered.length - eligible.length} refused by hard gate.`,
  }
}

/**
 * Enforce the IF-06 hard gates over a recommendation produced by the existing recommendation-only
 * engine. This is the production wiring: the recommendation-only path still proposes candidates,
 * but this gate REFUSES the recommendation whenever the selected candidate (or any candidate the
 * caller marks as eligible) fails a hard gate. The hard gate always beats the recommendation's
 * own ranking.
 *
 * recommendation: output of recommend-placement.evaluatePlacement (recommendation-only substrate)
 * candidatesByNodeId: map of nodeId -> IF-06 candidate descriptor for hard-gate evaluation
 * requirement: the IF-06 InferenceRequirement
 */
export function enforceHardGateOnRecommendation(recommendation, candidatesByNodeId, requirement, policy) {
  if (!recommendation || typeof recommendation !== "object") throw new Error("PLACEMENT_RECOMMENDATION_INVALID")
  const recommendedNodeId = recommendation?.recommendation?.nodeId ?? recommendation?.recommendation?.node_id ?? null
  const violations = []

  for (const [nodeId, candidate] of Object.entries(candidatesByNodeId ?? {})) {
    const refusals = hardGate(candidate, requirement, policy)
    if (refusals.length > 0) {
      // A candidate the recommendation path treated as eligible but the hard gate refuses.
      const wasRecommended = recommendedNodeId === nodeId
      violations.push({ nodeId, refusals, wasRecommended })
    }
  }

  const recommendedRefusal = violations.find((v) => v.wasRecommended)
  return {
    allowed: !recommendedRefusal,
    recommendedNodeId,
    violations,
    refusal: recommendedRefusal ?? null,
    // Any hard-gate-refused candidate is removed from eligibility regardless of the recommendation.
    eligibleAfterGate: Object.keys(candidatesByNodeId ?? {}).filter((nodeId) => !violations.some((v) => v.nodeId === nodeId)),
  }
}
