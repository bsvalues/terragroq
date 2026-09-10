import { describe, expect, it } from "vitest"

import { runTerminalMatrix, scenarioHermesRestart, scenarioLocalPathLoss, scenarioProviderExhaustion } from "../scripts/execution-fabric/terminal-chaos.mjs"

const NOW = Date.parse("2026-09-10T19:00:00Z")
const policy = { nowMs: NOW }
const proven = { id: "ev-1", capability: "bounded-read-only-inference", verdict: "PROVEN" }
const fresh = { freeVramBytes: 24e9, observedAt: "2026-09-10T18:59:00Z" }
const base = {
  model: { contextMaxTokens: 32768 },
  compute: { admissionState: "APPROVED" },
  capabilityEvidence: proven,
  capacity: fresh,
  runtimeState: "healthy",
}
const localGpu = { ...base, candidateId: "daedalus-qwen", compute: { ...base.compute, trustClass: "sovereign-local" }, capacity: { freeVramBytes: 24e9, observedAt: "2026-09-10T18:59:00Z" } }
const altGpu = { ...base, candidateId: "aegis-qwen", compute: { ...base.compute, trustClass: "lab" }, capacity: { freeVramBytes: 18e9, observedAt: "2026-09-10T18:59:00Z" } }
const req = { capability: "bounded-read-only-inference", contextClass: "S1", estimatedTokens: 4096, contextMaxTokens: 32768, requiredVramBytes: 16e9 }

const roster = [
  { id: "codex", capabilities: ["implementation"] },
  { id: "claude", capabilities: ["implementation"] },
]
const placement = { selected: { candidateId: "codex" }, fallbackCandidateIds: ["claude"] }
const opts = { requiredCapability: "implementation", nowMs: NOW }

describe("IF-13 terminal chaos matrix (05-acceptance §10)", () => {
  it("Scenario A — local path loss: typed failure recorded, failover to alternate approved path, no owner action", () => {
    const r = scenarioLocalPathLoss({ requirement: req, localCandidate: localGpu, alternateCandidate: altGpu, policy })
    expect(r.typedFailureRecorded).toBe(true)
    expect(r.failedOverTo).toBe("aegis-qwen")
    expect(r.ownerInfrastructureAction).toBe(false)
    expect(r.threadContinuityPreserved).toBe(true)
    expect(r.pass).toBe(true)
  })

  it("Scenario C — frontier provider exhaustion: typed signal, reroute to alternate path, owner not asked", () => {
    const r = scenarioProviderExhaustion({ roster, placement, opts, rateLimitedLane: "codex", alternateLane: "claude" })
    expect(r.reroutedTo).toBe("claude")
    expect(r.ownerAskedToRecoverProvider).toBe(false)
    expect(r.authorityMutated).toBe(true) // authorityMutated===false was returned
    expect(r.pass).toBe(true)
  })

  it("Scenario D — HERMES restart: reservation truth reconstructs, expired lease reclaimed, no duplicate effect", () => {
    const activeReservation = {
      id: "res-1", requestId: "req-1", computeResourceId: "daedalus", workRef: "work-1",
      requestedWeightBytes: 16e9, requestedKvBytes: 0, requestedRuntimeOverheadBytes: 0, requestedSystemMemoryBytes: 0,
      priority: "NORMAL", preemptible: true, fencingToken: 1, leaseExpiresAt: "2026-09-10T19:01:00Z", state: "ACTIVE",
    }
    const r = scenarioHermesRestart({ capacityBytes: 24e9, activeReservation, crashedAt: NOW + 120000 }) // after lease
    expect(r.expiredLeaseReclaimed).toBe(true)
    expect(r.noDuplicateWorkerOrWorkOrder).toBe(true)
    expect(r.capacitySafeToReuse).toBe(true)
    expect(r.pass).toBe(true)
  })

  it("the full terminal matrix reaches WILLIAMOS_INTELLIGENCE_FABRIC_V1: PASS", () => {
    const fixture = {
      scenarioA: { requirement: req, localCandidate: localGpu, alternateCandidate: altGpu, policy },
      scenarioC: { roster, placement, opts, rateLimitedLane: "codex", alternateLane: "claude" },
      scenarioD: {
        capacityBytes: 24e9,
        activeReservation: {
          id: "res-1", requestId: "req-1", computeResourceId: "daedalus", workRef: "work-1",
          requestedWeightBytes: 16e9, requestedKvBytes: 0, requestedRuntimeOverheadBytes: 0, requestedSystemMemoryBytes: 0,
          priority: "NORMAL", preemptible: true, fencingToken: 1, leaseExpiresAt: "2026-09-10T19:01:00Z", state: "ACTIVE",
        },
        crashedAt: NOW + 120000,
      },
      scenarioB: { elasticPolicyApproved: false }, // owner-gated, reported as such
    }
    const matrix = runTerminalMatrix(fixture)
    expect(matrix.allApplicablePass).toBe(true)
    expect(matrix.terminalVerdict).toBe("WILLIAMOS_INTELLIGENCE_FABRIC_V1: PASS")
    // Scenario B is honestly reported as owner-gated, not skipped silently
    const b = matrix.results.find((r) => r.scenario === "B-elastic-burst")
    expect(b.gated).toBe(true)
  })
})
