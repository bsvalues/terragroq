import { describe, expect, it } from "vitest"
import type { EventLog } from "@/lib/db/schema"

import { getEvidenceRollupSurface } from "@/components/evidence/evidence-rollup-surface"

function event(type: string, register: string | null, summary = "recorded proof"): EventLog {
  return {
    id: 1,
    userId: "user",
    type,
    summary,
    register,
    refId: null,
    metadata: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

describe("evidence rollup surface", () => {
  it("summarizes Work Order, Decision, Evidence, and Authority signals", () => {
    const surface = getEvidenceRollupSurface([
      event("work_order.result", "work-orders"),
      event("decision.status", "decisions"),
      event("work_order.evidence_record", "work-orders"),
      event("authority.granted", "authority"),
    ])
    const cards = new Map(surface.cards.map((card) => [card.label, card.value]))

    expect(cards.get("Work Order Signals")).toBe("2")
    expect(cards.get("Decision Signals")).toBe("1")
    expect(cards.get("Evidence Events")).toBe("1")
    expect(cards.get("Authority Signals")).toBe("1")
  })

  it("includes recent proof signals without mutating the log", () => {
    const surface = getEvidenceRollupSurface([
      event("work_order.result", "work-orders", "WO-1 PASS"),
      event("decision.status", "decisions", "ADR accepted"),
    ])

    expect(surface.recentSignals).toEqual([
      "work_order.result: WO-1 PASS",
      "decision.status: ADR accepted",
    ])
    expect(surface.safety).toEqual({
      readOnly: true,
      recordsEvidence: false,
      mutatesEvents: false,
      autoIngests: false,
      writesProduction: false,
    })
  })
})
