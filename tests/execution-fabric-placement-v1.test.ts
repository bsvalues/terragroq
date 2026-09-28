import { describe, expect, it } from "vitest"

import { PLACEMENT_REFUSALS, enforceHardGateOnRecommendation, evaluatePlacement, hardGate, scoreCandidate } from "../scripts/execution-fabric/placement-v1.mjs"

const NOW = Date.parse("2026-09-10T12:00:00Z")
const policy = { nowMs: NOW }
const fresh = (vram = 24e9) => ({ freeVramBytes: vram, observedAt: "2026-09-10T11:59:00Z" }) // 60s old, inside TTL
const proven = { id: "ev-1", capability: "bounded-read-only-inference", verdict: "PROVEN" }

const localGpu = {
  candidateId: "daedalus-qwen3-8b",
  model: { contextMaxTokens: 32768 },
  compute: { id: "daedalus", trustClass: "sovereign-local", admissionState: "APPROVED" },
  capabilityEvidence: proven,
  capacity: fresh(),
  runtimeState: "healthy",
}
const remoteGpu = {
  candidateId: "omen-qwen3-8b",
  model: { contextMaxTokens: 32768 },
  compute: { id: "omen", trustClass: "private-remote", admissionState: "APPROVED" },
  capabilityEvidence: proven,
  capacity: fresh(),
  runtimeState: "healthy",
}
const sovereignReq = { capability: "bounded-read-only-inference", contextClass: "S4", estimatedTokens: 4096, contextMaxTokens: 32768, requiredVramBytes: 16e9 }
const publicReq = { capability: "bounded-read-only-inference", contextClass: "S1", estimatedTokens: 4096, contextMaxTokens: 32768, requiredVramBytes: 16e9 }

describe("IF-06 hard gate always beats score", () => {
  it("a high-scoring candidate that violates data locality is still refused", () => {
    const refusals = hardGate(remoteGpu, sovereignReq, policy)
    expect(refusals).toContain(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
    // even though it would score high, the gate refuses it
    expect(refusals.length).toBeGreaterThan(0)
  })

  it("the data-locality invariant: sovereign data never leaves the local boundary", () => {
    expect(hardGate(localGpu, sovereignReq, policy)).not.toContain(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
    expect(hardGate(remoteGpu, sovereignReq, policy)).toContain(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
    // public (S1) data may go remote
    expect(hardGate(remoteGpu, publicReq, policy)).not.toContain(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
  })

  it("unproven capability is refused", () => {
    const c = { ...localGpu, capabilityEvidence: { id: "ev-x", capability: "bounded-read-only-inference", verdict: "UNKNOWN" } }
    expect(hardGate(c, publicReq, policy)).toContain(PLACEMENT_REFUSALS.UNPROVEN_CAPABILITY)
    expect(hardGate({ ...localGpu, capabilityEvidence: null }, publicReq, policy)).toContain(PLACEMENT_REFUSALS.UNPROVEN_CAPABILITY)
  })

  it("stale capacity is refused", () => {
    const stale = { ...localGpu, capacity: { freeVramBytes: 24e9, observedAt: "2026-09-10T11:00:00Z" } } // 60min old
    expect(hardGate(stale, publicReq, policy)).toContain(PLACEMENT_REFUSALS.STALE_CAPACITY)
  })

  it("context too large is refused/rerouted", () => {
    const big = { ...publicReq, estimatedTokens: 100000 }
    expect(hardGate(localGpu, big, policy)).toContain(PLACEMENT_REFUSALS.CONTEXT_TOO_LARGE)
  })

  it("the context gate is fail-closed when no window is provable", () => {
    const noWindow = { ...localGpu, model: {} }
    const refusals = hardGate(noWindow, publicReq, policy)
    // an unprovable context window is refused (by the context or a sibling fail-closed gate)
    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals.some((r) => r === PLACEMENT_REFUSALS.CONTEXT_TOO_LARGE || r === PLACEMENT_REFUSALS.CAPACITY_INSUFFICIENT || r === PLACEMENT_REFUSALS.STALE_CAPACITY)).toBe(true)
  })

  it("the capacity gate is fail-closed when free VRAM is not numeric", () => {
    const noVram = { ...localGpu, capacity: { freeVramBytes: "lots", observedAt: "2026-09-10T11:59:00Z" } }
    expect(hardGate(noVram, publicReq, policy)).toContain(PLACEMENT_REFUSALS.CAPACITY_INSUFFICIENT)
  })

  it("the freshness gate is fail-closed for a future-dated or unprovable clock", () => {
    const future = { ...localGpu, capacity: { freeVramBytes: 24e9, observedAt: "2026-09-10T13:00:00Z" } }
    expect(hardGate(future, publicReq, policy)).toContain(PLACEMENT_REFUSALS.STALE_CAPACITY)
    expect(hardGate(localGpu, publicReq, { nowMs: NaN })).toContain(PLACEMENT_REFUSALS.STALE_CAPACITY)
  })
})

describe("IF-06 hard gate is enforced over the recommendation-only path", () => {
  it("a recommendation whose selected node violates the data-locality gate is refused", () => {
    const recommendation = { recommendation: { nodeId: "omen-qwen3-8b" } }
    const result = enforceHardGateOnRecommendation(recommendation, { "daedalus-qwen3-8b": localGpu, "omen-qwen3-8b": remoteGpu }, sovereignReq, policy)
    expect(result.allowed).toBe(false)
    expect(result.refusal.refusals).toContain(PLACEMENT_REFUSALS.DATA_LOCALITY_VIOLATION)
    expect(result.eligibleAfterGate).toEqual(["daedalus-qwen3-8b"]) // the local node survives the gate
  })

  it("a recommendation whose selected node clears every hard gate is allowed", () => {
    const recommendation = { recommendation: { nodeId: "daedalus-qwen3-8b" } }
    const result = enforceHardGateOnRecommendation(recommendation, { "daedalus-qwen3-8b": localGpu, "omen-qwen3-8b": remoteGpu }, publicReq, policy)
    expect(result.allowed).toBe(true)
    expect(result.refusal).toBeNull()
  })
})

describe("IF-06 placement decision", () => {
  it("placement evidence explains every considered candidate", () => {
    const decision = evaluatePlacement(publicReq, [localGpu, remoteGpu], policy)
    expect(decision.considered).toHaveLength(2)
    for (const c of decision.considered) {
      expect(c.evidenceRefs.length).toBeGreaterThan(0)
      if (c.eligible) expect(c.refusals).toHaveLength(0)
      else expect(c.refusals.length).toBeGreaterThan(0)
    }
  })

  it("is deterministic: same requirement + candidates yields the same selection and fallback chain", () => {
    const a = evaluatePlacement(publicReq, [localGpu, remoteGpu], policy)
    const b = evaluatePlacement(publicReq, [remoteGpu, localGpu], policy) // different input order
    expect(a.selected.candidateId).toBe(b.selected.candidateId)
    expect(a.fallbackCandidateIds).toEqual(b.fallbackCandidateIds)
  })

  it("supports seamless fallback between two approved candidates", () => {
    const decision = evaluatePlacement(publicReq, [localGpu, remoteGpu], policy)
    expect(decision.selected.candidateId).toBe("daedalus-qwen3-8b") // local preferred
    expect(decision.fallbackCandidateIds).toContain("omen-qwen3-8b") // approved fallback exists
  })

  it("refuses placement when no candidate clears the hard gate, and explains why", () => {
    const allRefused = [{ ...localGpu, capabilityEvidence: null }]
    let err = null
    try { evaluatePlacement(publicReq, allRefused, policy) } catch (e) { err = e }
    expect(err).not.toBeNull()
    expect(err.message).toMatch(/PLACEMENT_NO_ELIGIBLE_CANDIDATE/)
    expect(err.considered[0].refusals).toContain(PLACEMENT_REFUSALS.UNPROVEN_CAPABILITY)
  })
})

describe("IF-06 scoring is deterministic and bounded", () => {
  it("scores eligible candidates deterministically", () => {
    expect(scoreCandidate(localGpu, publicReq)).toBe(scoreCandidate(localGpu, publicReq))
    expect(scoreCandidate(localGpu, publicReq)).toBeGreaterThan(scoreCandidate(remoteGpu, publicReq)) // local preferred
  })
})
