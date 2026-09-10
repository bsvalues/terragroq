import { describe, expect, it } from "vitest"

import { PLACEMENT_REFUSALS, evaluatePlacement, hardGate, scoreCandidate } from "../scripts/execution-fabric/placement-v1.mjs"

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
const sovereignReq = { capability: "bounded-read-only-inference", contextClass: "S4", estimatedTokens: 4096, requiredVramBytes: 16e9 }
const publicReq = { capability: "bounded-read-only-inference", contextClass: "S1", estimatedTokens: 4096, requiredVramBytes: 16e9 }

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
