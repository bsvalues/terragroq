import { describe, expect, it } from "vitest"

import { LANE_SIGNALS, laneCapabilityRequest, providerFeedback } from "../scripts/execution-fabric/worker-lane-adapter.mjs"

const NOW = Date.parse("2026-09-10T13:00:00Z")
const roster = [
  { id: "codex", capabilities: ["implementation"], binary: "codex" },
  { id: "claude", capabilities: ["implementation"], binary: "claude" },
  { id: "hermes-local", capabilities: [], binary: "hermes" }, // declared, not yet measured-capable
]
const placement = { selected: { candidateId: "claude" }, fallbackCandidateIds: ["codex"] }
const opts = { requiredCapability: "implementation", nowMs: NOW }

describe("IF-07 lane capability request adapter", () => {
  it("assigned lane semantics are preserved where required", () => {
    const req = laneCapabilityRequest(placement, roster, { ...opts, assignedLaneId: "codex" })
    expect(req.signal).toBe(LANE_SIGNALS.SERVE)
    expect(req.laneId).toBe("codex") // assigned lane honored first
  })

  it("the fabric-selected lane serves when no assigned lane is set", () => {
    const req = laneCapabilityRequest(placement, roster, opts)
    expect(req.signal).toBe(LANE_SIGNALS.SERVE)
    expect(req.laneId).toBe("claude")
  })

  it("re-places to a fallback when the selected lane cannot serve", () => {
    const p = { selected: { candidateId: "hermes-local" }, fallbackCandidateIds: ["codex"] }
    const req = laneCapabilityRequest(p, roster, opts)
    expect(req.signal).toBe(LANE_SIGNALS.REPLACEMENT)
    expect(req.laneId).toBe("codex")
  })

  it("a lane with a future rate-limit timestamp is skipped (no hammering a known-empty meter)", () => {
    const limited = roster.map((l) => (l.id === "claude" ? { ...l, unavailableUntil: "2026-09-10T14:00:00Z" } : l))
    const p = { selected: { candidateId: "claude" }, fallbackCandidateIds: ["codex"] }
    const req = laneCapabilityRequest(p, limited, opts)
    expect(req.laneId).toBe("codex")
  })

  it("no Fabric action creates unauthorized repository effects or mutates authority", () => {
    for (const req of [
      laneCapabilityRequest(placement, roster, opts),
      laneCapabilityRequest({ selected: { candidateId: "hermes-local" }, fallbackCandidateIds: [] }, roster, opts),
    ]) {
      expect(req.authorityMutated).toBe(false)
      expect(req.repositoryEffect).toBe(false)
    }
  })
})

describe("IF-07 provider availability/failure feedback into re-placement", () => {
  it("a provider rate limit triggers a typed re-placement to another governed lane", () => {
    const result = providerFeedback({ laneId: "claude", kind: "rate-limit" }, roster, placement, opts)
    expect([LANE_SIGNALS.SERVE, LANE_SIGNALS.REPLACEMENT]).toContain(result.signal)
    expect(result.laneId).toBe("codex")
    expect(result.reason).toMatch(/rate-limited/)
  })

  it("a rate limit with no alternative lane produces a typed wait, never an unauthorized retry", () => {
    const solo = [{ id: "claude", capabilities: ["implementation"] }]
    const p = { selected: { candidateId: "claude" }, fallbackCandidateIds: [] }
    const result = providerFeedback({ laneId: "claude", kind: "rate-limit", retryAfterMs: 30000 }, solo, p, opts)
    expect(result.signal).toBe(LANE_SIGNALS.WAIT)
    expect(result.waitMs).toBe(30000)
    expect(result.authorityMutated).toBe(false)
  })

  it("a provider failure re-places to an alternative lane", () => {
    const result = providerFeedback({ laneId: "claude", kind: "failure" }, roster, placement, opts)
    expect(result.laneId).toBe("codex")
    expect(result.reason).toMatch(/failed/)
  })

  it("a worker never chooses its own next parent outcome — feedback returns a recommendation only", () => {
    const result = providerFeedback({ laneId: "claude", kind: "ok" }, roster, placement, opts)
    // the adapter returns a serve/wait recommendation; it carries no outcome-advancement field
    expect(Object.keys(result)).not.toContain("nextOutcomeId")
    expect(Object.keys(result)).not.toContain("advanceOutcome")
    expect(result.authorityMutated).toBe(false)
  })
})
