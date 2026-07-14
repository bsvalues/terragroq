import { describe, expect, it } from "vitest"
import type { EventLog } from "@/lib/db/schema"

import { getEvidenceRollupSurface } from "@/components/evidence/evidence-rollup-surface"

const zeroOwnerOperations = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
} as const

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
    expect(surface.proofStates.map((state) => state.label)).toEqual([
      "Validation proof",
      "Production proof",
      "Review proof",
      "Safety proof",
    ])
    expect(surface.safety).toEqual({
      readOnly: true,
      recordsEvidence: false,
      mutatesEvents: false,
      autoIngests: false,
      writesProduction: false,
    })
    expect(surface.ownerOperationEvidence).toMatchObject({
      lifecycleState: "NO_OWNER_OPERATION_EVIDENCE",
      reasonCode: "OWNER_OPERATION_EVIDENCE_MISSING",
      certification: { independentlyVerified: false, evidenceHeadHash: null },
    })
  })

  it("makes missing and blocked proof visible without adding ingestion", () => {
    const surface = getEvidenceRollupSurface([])
    const states = new Map(surface.proofStates.map((state) => [state.label, state.status]))

    expect(states.get("Validation proof")).toBe("missing")
    expect(states.get("Production proof")).toBe("required")
    expect(states.get("Review proof")).toBe("thread-gated")
    expect(states.get("Safety proof")).toBe("false-flags-required")
    expect(surface.proofStates.map((state) => state.description).join(" ")).toContain(
      "Command runner, autonomy, background worker, production write, ingestion, and secrets flags must stay false.",
    )
  })

  it("marks production proof present only when route or production evidence exists", () => {
    const surface = getEvidenceRollupSurface([
      event("production.verification", "evidence", "/api/health 200"),
    ])
    const states = new Map(surface.proofStates.map((state) => [state.label, state.status]))

    expect(states.get("Production proof")).toBe("present")
  })

  it("keeps supplied zeros unverified and rejects routine owner work", () => {
    const unverified = getEvidenceRollupSurface([], {
      counters: zeroOwnerOperations,
      workOrderId: "WO-ROLLUP-001",
      action: "evidence-rollup",
    })
    const disqualified = getEvidenceRollupSurface([], {
      counters: { ...zeroOwnerOperations, OWNER_ROUTINE_DECISION_COUNT: 1 },
      workOrderId: "WO-ROLLUP-001",
      action: "evidence-rollup",
    })

    expect(unverified.ownerOperationEvidence).toMatchObject({
      lifecycleState: "UNVERIFIED_ZERO_OWNER_OPERATIONS",
      reasonCode: "OWNER_OPERATION_EVIDENCE_UNVERIFIED",
      certification: { independentlyVerified: false },
    })
    expect(disqualified.ownerOperationEvidence).toMatchObject({
      lifecycleState: "FAILED_OWNER_BABYSITTING",
      reasonCode: "FAIL_OWNER_BABYSITTING",
    })
  })
})
