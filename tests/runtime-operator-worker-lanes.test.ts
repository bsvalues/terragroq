import { describe, expect, it } from "vitest"

import { IMPLEMENTATION, buildWorkerPrompt, laneRoster, selectLane } from "../scripts/runtime-operator/worker-lanes.mjs"

const NOW = Date.parse("2026-08-19T00:00:00Z")
const FUTURE = "2026-08-19T20:33:00-07:00"
const PAST = "2026-08-18T00:00:00Z"

describe("the roster tells the truth", () => {
  it("has three declared lanes, one honestly not yet capable of implementation", () => {
    const roster = laneRoster()
    expect(roster.map((lane) => lane.id)).toEqual(["codex", "claude", "hermes-local"])
    const implementers = roster.filter((lane) => lane.capabilities.includes(IMPLEMENTATION))
    expect(implementers.map((lane) => lane.id)).toEqual(["codex", "claude"])
  })

  it("keeps saying so after WO-0030 wired the local lane end to end", () => {
    // Reachable is not capable. The lane now has an entrypoint, a packet and a worktree; whether
    // williamos-qwen3-4b:64k clears this kernel's bar is a measurement, and until one is recorded the
    // truthful answer is the one the roster has always given.
    const hermes = laneRoster().find((lane) => lane.id === "hermes-local")
    expect(hermes?.binary).toBe("pwsh")
    expect(hermes?.capabilities).toEqual([])
  })

  it("grants the capability only to a measurement that says what proved it", () => {
    const measured = {
      "hermes-local": { implementation: "PROVEN", evidence: "wo-0030-lane-probe" },
    }
    const hermes = laneRoster({ measured }).find((lane) => lane.id === "hermes-local")
    expect(hermes?.capabilities).toEqual([IMPLEMENTATION])
    const choice = selectLane({ assigned: "hermes-local", roster: laneRoster({ measured }), status: {}, now: NOW })
    expect(choice.lane?.id).toBe("hermes-local")
  })

  it("refuses a verdict that cites nothing, so promotion costs more than one edited word", () => {
    for (const record of [
      { implementation: "PROVEN" },
      { implementation: "PROVEN", evidence: "  " },
      { implementation: "MEASURED_INCAPABLE", evidence: "wo-0030-lane-probe" },
    ]) {
      const hermes = laneRoster({ measured: { "hermes-local": record } }).find((lane) => lane.id === "hermes-local")
      expect(hermes?.capabilities).toEqual([])
    }
  })
})

describe("selection policy", () => {
  const roster = laneRoster()

  it("uses the assigned lane when it is available", () => {
    const choice = selectLane({ assigned: "codex", roster, status: {}, now: NOW })
    expect(choice).toMatchObject({ wait: false, rerouted: false, reason: "ASSIGNED_LANE_AVAILABLE" })
    expect(choice.lane.id).toBe("codex")
  })

  it("reroutes when the assigned lane is exhausted, and says why", () => {
    // The exact situation of tonight: the Codex meter is empty until 20:33, and development must not
    // stop because one provider's meter did.
    const status = { codex: { unavailableUntil: FUTURE, reason: "RATE_LIMITED" } }
    const choice = selectLane({ assigned: "codex", roster, status, now: NOW })
    expect(choice.wait).toBe(false)
    expect(choice.lane.id).toBe("claude")
    expect(choice.rerouted).toBe(true)
    expect(choice.reason).toBe("ASSIGNED_LANE_UNAVAILABLE:codex")
  })

  it("treats an expired unavailability as available again", () => {
    const status = { codex: { unavailableUntil: PAST, reason: "RATE_LIMITED" } }
    const choice = selectLane({ assigned: "codex", roster, status, now: NOW })
    expect(choice.lane.id).toBe("codex")
    expect(choice.rerouted).toBe(false)
  })

  it("waits with the soonest refill time only when every capable lane is exhausted", () => {
    const status = {
      codex: { unavailableUntil: FUTURE },
      claude: { unavailableUntil: "2026-08-19T10:00:00-07:00" },
    }
    const choice = selectLane({ assigned: "codex", roster, status, now: NOW })
    expect(choice.wait).toBe(true)
    expect(choice.reason).toBe("ALL_CAPABLE_LANES_EXHAUSTED")
    expect(choice.retryAfterMs).toBe(Date.parse("2026-08-19T10:00:00-07:00"))
  })

  it("never selects a lane that lacks the capability, whatever the availability", () => {
    // hermes-local is declared and not yet capable; selecting it would be a stall with extra steps.
    const status = { codex: { unavailableUntil: FUTURE }, claude: { unavailableUntil: FUTURE } }
    const choice = selectLane({ assigned: "hermes-local", roster, status, now: NOW })
    expect(choice.wait).toBe(true)
  })

  it("serves an unassigned work order from any available implementation lane", () => {
    const choice = selectLane({ assigned: null, roster, status: {}, now: NOW })
    expect(choice.wait).toBe(false)
    expect(choice.lane.capabilities).toContain(IMPLEMENTATION)
  })
})

describe("the worker prompt is lane-independent", () => {
  it("carries the boundary and the no-command rule to every lane", () => {
    const prompt = buildWorkerPrompt({
      workOrderId: "WO-0026",
      task: "make the loader load",
      allowedPaths: ["lib/workbench/load-threads.ts", "tests/**"],
      remediation: false,
    })
    expect(prompt).toContain("WO-0026")
    expect(prompt).toContain("lib/workbench/load-threads.ts")
    expect(prompt).toContain("Do not run shell commands")
    expect(prompt).toContain("Do not commit")
  })
})

describe("the worker is warned about the wall that cannot be argued with", () => {
  it("tells every lane not to write credential-shaped text, placeholders included", () => {
    const prompt = buildWorkerPrompt({
      workOrderId: "WO-0030",
      task: "integrate the lane",
      allowedPaths: ["scripts/runtime-operator/**"],
      remediation: false,
    })
    expect(prompt).toContain("credential-shaped")
    expect(prompt).toContain("not even in a test")
  })

  it("describes the forbidden shapes without containing one", () => {
    // WO-0030 lost a whole run to `postgres://user:pw@host/db` in a fixture. A warning that
    // demonstrates the pattern would be copied into a comment and trip the wall it warns about.
    const prompt = buildWorkerPrompt({
      workOrderId: "WO-0030",
      task: "integrate the lane",
      allowedPaths: ["scripts/runtime-operator/**"],
      remediation: false,
    })
    const SECRET_FIELD =
      /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bgh[oprsu]_[A-Za-z0-9]{20,}\b|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+|(?:password|token|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*["'][^\s"']{12,}["'])/i
    expect(SECRET_FIELD.test(prompt)).toBe(false)
  })
})
