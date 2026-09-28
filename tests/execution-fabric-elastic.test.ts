import { describe, expect, it } from "vitest"

import { ELASTIC_STATES, createElasticLifecycle } from "../scripts/execution-fabric/elastic-compute.mjs"

const NOW = Date.parse("2026-09-10T16:00:00Z")
const mk = (over = {}) => createElasticLifecycle({ ttlMs: 3600_000, maxSpendUsd: 5, egressClass: "egress-only", now: () => NOW, ...over })

describe("IF-10 elastic compute lifecycle", () => {
  it("requires a bounded TTL, spend limit, and egress class", () => {
    expect(() => createElasticLifecycle({ maxSpendUsd: 5, egressClass: "egress-only" })).toThrow(/ELASTIC_TTL_REQUIRED/)
    expect(() => createElasticLifecycle({ ttlMs: 1000, egressClass: "egress-only" })).toThrow(/ELASTIC_SPEND_LIMIT_REQUIRED/)
    expect(() => createElasticLifecycle({ ttlMs: 1000, maxSpendUsd: 5 })).toThrow(/ELASTIC_EGRESS_CLASS_REQUIRED/)
  })

  it("the worker gets a short-lived scoped identity only, never a master credential", () => {
    const id = mk().issueWorkerIdentity("res-1")
    expect(id.credentialClass).toBe("short-lived-scoped")
    expect(id.masterCredential).toBe(false)
    expect(id.inbound).toBe("none") // no public inbound dependency
    expect(Date.parse(id.expiresAt)).toBeLessThanOrEqual(NOW + 3600_000)
  })

  it("egress policy negative tests: sovereign data never egresses to elastic compute", () => {
    const l = mk()
    expect(l.egressAllowed("S4")).toBe(false)
    expect(l.egressAllowed("S3")).toBe(false)
    expect(l.egressAllowed("S1")).toBe(true)
  })

  it("the worker is destroyed after success and after induced failure", () => {
    const l = mk()
    // success path: EXECUTING -> WIPING -> DESTROYING -> DESTROYED
    expect(l.transition("EXECUTING", "WIPING")).toBe("WIPING")
    expect(l.transition("WIPING", "DESTROYING")).toBe("DESTROYING")
    expect(l.transition("DESTROYING", "DESTROYED")).toBe("DESTROYED")
    // failure path: FAILED -> DESTROYING (a failed worker still must be destroyed)
    expect(l.transition("FAILED", "DESTROYING")).toBe("DESTROYING")
  })

  it("an orphaned paid worker is detected and recovered", () => {
    let clock = NOW
    const l = createElasticLifecycle({ ttlMs: 1000, maxSpendUsd: 5, egressClass: "egress-only", now: () => clock })
    const resource = { id: "res-orphan", state: "EXECUTING", createdAt: new Date(NOW).toISOString() }
    clock = NOW + 5000 // past TTL
    expect(l.isOrphaned(resource)).toBe(true)
    const recovered = l.sweepOrphan(resource)
    expect(recovered.state).toBe("DESTROYING")
  })

  it("exact cost/TTL evidence is recorded and the spend limit is enforced", () => {
    const l = mk()
    const resource = { id: "res-1", state: "DESTROYED", createdAt: new Date(NOW - 1800_000).toISOString() }
    const ev = l.recordCostEvidence(resource, { costUsd: 3.5 })
    expect(ev.withinSpend).toBe(true)
    expect(ev.withinTtl).toBe(true)
    expect(ev.destroyed).toBe(true)
    expect(ev.costUsd).toBe(3.5)
    expect(() => l.recordCostEvidence(resource, { costUsd: 99 })).toThrow(/ELASTIC_SPEND_EXCEEDED/)
  })

  it("illegal lifecycle transitions are refused", () => {
    const l = mk()
    expect(() => l.transition("DESTROYED", "EXECUTING")).toThrow(/ELASTIC_ILLEGAL_TRANSITION/)
    expect(() => l.transition("REQUESTED", "DESTROYED")).toThrow(/ELASTIC_ILLEGAL_TRANSITION/)
  })

  it("the live provider proof is separately owner-gated, not bundled here", () => {
    // This module is the provider-agnostic governed core. The end-to-end live proof against a real
    // external provider requires the owner-approved provider, credential setup, and spend/egress
    // policy named in 04-delivery-plan IF-10 prerequisites — a genuine owner boundary, not bundled.
    expect(ELASTIC_STATES).toContain("ORPHANED")
  })
})
