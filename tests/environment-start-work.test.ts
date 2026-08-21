import { describe, expect, it } from "vitest"

import {
  composeStartWorkResult,
  isContinueIntent,
  startWorkIdempotencyKey,
  type StartWorkAuthorization,
} from "@/lib/environment/start-work"
import type { RetainedStartWork } from "@/lib/environment/working-world"

const SELECTION: RetainedStartWork = {
  projectId: 1,
  projectName: "TerraFusion OS",
  threadId: "t-42",
  outcomeKey: "outcome-build-readiness",
  outcomeTitle: "Build a concise project readiness summary from current evidence",
  activeWorkOrderId: null,
}

describe("isContinueIntent", () => {
  it("recognises the offered continue phrasings", () => {
    for (const q of [
      "Continue the highest-priority TerraFusion OS work",
      "continue it",
      "continue the work",
      "continue",
    ]) expect(isContinueIntent(q)).toBe(true)
  })
  it("does not fire on unrelated sentences", () => {
    expect(isContinueIntent("what are we doing on TerraFusion?")).toBe(false)
    expect(isContinueIntent("the login is broken, fix it")).toBe(false)
    expect(isContinueIntent("continue reading the docs later?")).toBe(false)
  })
})

describe("startWorkIdempotencyKey", () => {
  it("is stable for the same outcome (so a retry dedupes) and matches the contract shape", () => {
    const k1 = startWorkIdempotencyKey(SELECTION)
    const k2 = startWorkIdempotencyKey(SELECTION)
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/)
  })
  it("sanitises disallowed characters", () => {
    expect(startWorkIdempotencyKey({ outcomeKey: "weird key/with spaces#!" })).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/)
  })
})

describe("composeStartWorkResult renders what actually happened, never 'work has begun'", () => {
  it("AUTHORIZED_FOR_ACQUISITION → started, names the exact outcome and authority", () => {
    const result: StartWorkAuthorization = {
      status: "AUTHORIZED_FOR_ACQUISITION",
      queueVersion: 1,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "outcome", allowedAction: "outcome:execute", authorizedAt: "2026-08-21T00:00:00Z", expiresAt: "2026-08-21T01:00:00Z" },
    }
    const out = composeStartWorkResult(SELECTION, result)
    expect(out.started).toBe(true)
    expect(out.say).toContain(SELECTION.outcomeTitle)
    expect(out.say).toContain("A2_WRITE_OWN")
    expect(out.trace.some((t) => t.step === "authorize" && t.detail.includes("AUTHORIZED_FOR_ACQUISITION"))).toBe(true)
  })

  it("ALREADY_AUTHORIZED → started but no double dispatch (idempotent retry)", () => {
    const out = composeStartWorkResult(SELECTION, { status: "ALREADY_AUTHORIZED", queueVersion: 2, authorization: { authorityLevel: "A2_WRITE_OWN", scope: "outcome", allowedAction: "outcome:execute", authorizedAt: "x", expiresAt: "y" } })
    expect(out.started).toBe(true)
    expect(out.say.toLowerCase()).toContain("already started")
    expect(out.say.toLowerCase()).toContain("nothing was dispatched twice")
  })

  it("INELIGIBLE → fail closed, refuses honestly, does NOT reselect", () => {
    const out = composeStartWorkResult(SELECTION, { status: "INELIGIBLE", reason: "OUTCOME_NOT_SUGGESTED" })
    expect(out.started).toBe(false)
    expect(out.say).toContain("OUTCOME_NOT_SUGGESTED")
    expect(out.say.toLowerCase()).toContain("won't quietly start a different one")
    expect(out.trace.some((t) => t.detail.includes("fail closed"))).toBe(true)
  })

  it("CONFLICT/UNAVAILABLE also fail closed", () => {
    for (const status of ["CONFLICT", "UNAVAILABLE"] as const) {
      const out = composeStartWorkResult(SELECTION, { status, reason: "SOME_REASON" })
      expect(out.started).toBe(false)
    }
  })
})
