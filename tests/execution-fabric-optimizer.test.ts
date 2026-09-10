import { describe, expect, it } from "vitest"

import { measuredDataFresh, normalizeCost, optimize } from "../scripts/execution-fabric/optimizer.mjs"

const NOW = Date.parse("2026-09-10T17:00:00Z")
const policy = { nowMs: NOW, localPreference: true, burstThreshold: 0.2 }
const proven = { id: "ev-1", capability: "bounded-read-only-inference", verdict: "PROVEN" }
const freshMeasured = (over = {}) => ({ qualityScore: 0.9, costPerCallUsd: 0, queueDelayMs: 0, measuredAt: "2026-09-10T16:59:00Z", ...over })
const base = {
  model: { contextMaxTokens: 32768 },
  compute: { admissionState: "APPROVED" },
  capabilityEvidence: proven,
  capacity: { freeVramBytes: 24e9, observedAt: "2026-09-10T16:59:00Z" },
  runtimeState: "healthy",
}
const local = { ...base, candidateId: "daedalus-qwen", compute: { ...base.compute, trustClass: "sovereign-local" }, measured: freshMeasured({ qualityScore: 0.85 }) }
const remote = { ...base, candidateId: "omen-qwen", compute: { ...base.compute, trustClass: "private-remote" }, measured: freshMeasured({ qualityScore: 0.9, costPerCallUsd: 0.001 }) }
const req = { capability: "bounded-read-only-inference", contextClass: "S1", estimatedTokens: 4096, contextMaxTokens: 32768, requiredVramBytes: 16e9 }
const sovereignReq = { ...req, contextClass: "S4" }

describe("IF-11 optimizer cannot override hard gates", () => {
  it("a candidate that violates data locality is excluded no matter how good its measurements", () => {
    const greatRemote = { ...remote, measured: freshMeasured({ qualityScore: 1.0 }) }
    const result = optimize(sovereignReq, [local, greatRemote], policy)
    expect(result.selected.candidateId).toBe("daedalus-qwen") // local, not the "better" remote
    expect(result.refusedByGate.some((r) => r.candidateId === "omen-qwen")).toBe(true)
  })

  it("refused candidates are reported with their gate refusals", () => {
    const result = optimize(sovereignReq, [local, remote], policy)
    const refused = result.refusedByGate.find((r) => r.candidateId === "omen-qwen")
    expect(refused.refusals).toContain("data-locality-violation")
  })
})

describe("IF-11 measured data freshness/scoping enforced", () => {
  it("stale measured data zeroes the quality term", () => {
    const stale = { ...remote, measured: freshMeasured({ qualityScore: 1.0, measuredAt: "2026-09-10T16:00:00Z" }) } // 60min old
    expect(measuredDataFresh(stale, { nowMs: NOW })).toBe(false)
    const result = optimize(req, [local, stale], policy)
    const staleConsidered = result.considered.find((c) => c.candidateId === "omen-qwen")
    expect(staleConsidered.fresh).toBe(false)
    expect(staleConsidered.inputs.quality).toBe(0) // stale quality not trusted
  })

  it("unprovable measured clock is not fresh", () => {
    expect(measuredDataFresh(remote, { nowMs: NaN })).toBe(false)
  })
})

describe("IF-11 local preferred when equivalent; remote burst when value clears threshold", () => {
  it("local is preferred when a remote option is only marginally better", () => {
    const slightlyBetter = { ...remote, measured: freshMeasured({ qualityScore: 0.9 }) }
    const result = optimize(req, [local, slightlyBetter], { ...policy, burstThreshold: 0.2 })
    expect(result.selected.candidateId).toBe("daedalus-qwen")
    expect(result.rationale).toMatch(/Local preferred/)
  })

  it("remote burst is selected when its measured value clears the policy threshold", () => {
    const muchBetter = { ...remote, measured: freshMeasured({ qualityScore: 1.0, costPerCallUsd: 0 }) }
    const weakLocal = { ...local, measured: freshMeasured({ qualityScore: 0.3 }) }
    const result = optimize(req, [weakLocal, muchBetter], { ...policy, burstThreshold: 0.2 })
    expect(result.selected.candidateId).toBe("omen-qwen")
    expect(result.rationale).toMatch(/Remote burst selected/)
  })

  it("policy can disable local preference", () => {
    const slightlyBetter = { ...remote, measured: freshMeasured({ qualityScore: 0.95 }) }
    const result = optimize(req, [local, slightlyBetter], { ...policy, localPreference: false })
    expect(result.selected.candidateId).toBe("omen-qwen")
  })
})

describe("IF-11 cost normalization + explainable output", () => {
  it("normalizes cost so local (near-zero) scores best and high cost scores low", () => {
    expect(normalizeCost({ measured: { costPerCallUsd: 0 } })).toBe(1)
    expect(normalizeCost({ measured: { costPerCallUsd: 0.05 } })).toBeCloseTo(0.5)
    expect(normalizeCost({ measured: { costPerCallUsd: 0.20 } })).toBe(0) // above ceiling -> 0 value
  })

  it("the choice output is explainable: it names the measured inputs", () => {
    const result = optimize(req, [local, remote], policy)
    expect(result.rationale).toBeTruthy()
    for (const c of result.considered) {
      expect(c.inputs).toHaveProperty("quality")
      expect(c.inputs).toHaveProperty("costValue")
      expect(c.inputs).toHaveProperty("queuePenalty")
      expect(c.inputs).toHaveProperty("localityBonus")
    }
  })
})

describe("IF-11 remediation: cost/score input hardening (CodeRabbit findings)", () => {
  it("an unknown or non-finite cost gets the WORST score, never the best", () => {
    expect(normalizeCost({ measured: {} })).toBe(0) // missing cost
    expect(normalizeCost({ measured: { costPerCallUsd: NaN } })).toBe(0)
    expect(normalizeCost({ measured: { costPerCallUsd: -1 } })).toBe(0)
    expect(normalizeCost({ measured: { costPerCallUsd: Infinity } })).toBe(0)
    // a candidate with unknown cost can never outrank one with proven low cost
    const unknownCost = { ...remote, measured: freshMeasured({ qualityScore: 1.0, costPerCallUsd: undefined }) }
    const result = optimize(req, [local, unknownCost], policy)
    expect(result.selected.candidateId).toBe("daedalus-qwen")
  })

  it("stale measured data zeroes ALL measured inputs, not just quality", () => {
    const stale = { ...remote, measured: freshMeasured({ qualityScore: 1.0, costPerCallUsd: 0.001, measuredAt: "2026-09-10T16:00:00Z" }) }
    const result = optimize(req, [local, stale], policy)
    const c = result.considered.find((x) => x.candidateId === "omen-qwen")
    expect(c.fresh).toBe(false)
    expect(c.inputs.quality).toBe(0)
    expect(c.inputs.costValue).toBe(0)
    expect(c.inputs.queuePenalty).toBe(0)
  })

  it("the IF-06 spend limit excludes an over-limit candidate from ranking", () => {
    const pricey = { ...remote, measured: freshMeasured({ costPerCallUsd: 0.50 }) }
    const result = optimize({ ...req, maxCostPerCallUsd: 0.10 }, [local, pricey], policy)
    expect(result.selected.candidateId).toBe("daedalus-qwen")
    expect(result.overSpendLimit.some((o) => o.candidateId === "omen-qwen")).toBe(true)
  })

  it("NaN / Infinity / negative score inputs are not trusted", () => {
    const nanQuality = { ...remote, measured: freshMeasured({ qualityScore: NaN }) }
    const negQueue = { ...remote, measured: freshMeasured({ qualityScore: 0.5, queueDelayMs: -500 }) }
    const result = optimize(req, [local, nanQuality, negQueue], policy)
    // neither bad-input candidate beats the clean local one
    expect(result.selected.candidateId).toBe("daedalus-qwen")
  })
})
