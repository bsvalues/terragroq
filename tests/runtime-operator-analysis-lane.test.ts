import { describe, expect, it } from "vitest"

import { ANALYSIS, IMPLEMENTATION, laneRoster, selectLane } from "../scripts/runtime-operator/worker-lanes.mjs"

const NOW = Date.parse("2026-09-10T00:00:00Z")

describe("daedalus analysis lane", () => {
  it("is declared as a read-only analysis lane and never claims implementation", () => {
    const roster = laneRoster()
    const daedalus = roster.find((lane) => lane.id === "daedalus-model")
    expect(daedalus).toBeDefined()
    // The lane is honest about containment: it can analyze, it can never be selected to edit.
    expect(daedalus.capabilities).not.toContain(IMPLEMENTATION)
    expect(daedalus.readOnly).toBe(true)
  })

  it("carries no analysis capability until a measurement proves it", () => {
    const daedalus = laneRoster().find((lane) => lane.id === "daedalus-model")
    expect(daedalus.capabilities).toEqual([])
  })

  it("gains analysis capability only from a recorded measurement that cites its evidence", () => {
    const measured = { "daedalus-model": { analysis: "PROVEN", evidence: "daedalus-qwen3-8b-promotion-20260910" } }
    const daedalus = laneRoster({ measured }).find((lane) => lane.id === "daedalus-model")
    expect(daedalus.capabilities).toEqual([ANALYSIS])
    const choice = selectLane({ assigned: "daedalus-model", roster: laneRoster({ measured }), status: {}, capability: ANALYSIS, now: NOW })
    expect(choice.wait).toBe(false)
    expect(choice.lane?.id).toBe("daedalus-model")
  })

  it("refuses analysis promotion that cites nothing or is measured incapable", () => {
    for (const record of [{ analysis: "PROVEN" }, { analysis: "PROVEN", evidence: " " }, { analysis: "MEASURED_INCAPABLE", evidence: "x" }]) {
      const daedalus = laneRoster({ measured: { "daedalus-model": record } }).find((lane) => lane.id === "daedalus-model")
      expect(daedalus.capabilities).toEqual([])
    }
  })

  it("is never selected for an implementation work order even when it is the only lane free", () => {
    const measured = { "daedalus-model": { analysis: "PROVEN", evidence: "e" } }
    const status = { codex: { unavailableUntil: "2099-01-01T00:00:00Z" }, claude: { unavailableUntil: "2099-01-01T00:00:00Z" } }
    const choice = selectLane({ assigned: "codex", roster: laneRoster({ measured }), status, capability: IMPLEMENTATION, now: NOW })
    // Implementation still has no capable lane here; the read-only model must not be picked to write code.
    expect(choice.wait).toBe(true)
    expect(choice.reason).toBe("ALL_CAPABLE_LANES_EXHAUSTED")
  })
})
