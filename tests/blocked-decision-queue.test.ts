import { describe, expect, it } from "vitest"
import type { Decision } from "@/lib/db/schema"

import { getBlockedDecisionQueueSurface } from "@/components/decisions/blocked-decision-queue"

function decision(status: Decision["status"], evidence: string[] = []): Decision {
  return {
    id: 1,
    userId: "user",
    ref: "ADR-0001",
    title: "Approve production authority",
    context: null,
    decision: "Hold until evidence is complete.",
    rationale: null,
    consequences: null,
    status,
    authority: "binding",
    owner: "Primary",
    scope: null,
    evidence,
    tags: [],
    supersedesId: null,
    supersededById: null,
    locked: false,
    reviewAt: null,
    decidedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  }
}

describe("blocked decision queue surface", () => {
  it("shows proposed decisions as blockers", () => {
    const surface = getBlockedDecisionQueueSurface([
      decision("accepted"),
      decision("proposed"),
      decision("superseded"),
      decision("rejected"),
    ])

    expect(surface.items).toHaveLength(1)
    expect(surface.items[0]).toMatchObject({
      ref: "ADR-0001",
      title: "Approve production authority",
      authority: "binding",
      evidenceState: "required",
    })
  })

  it("distinguishes decisions that already have evidence", () => {
    const surface = getBlockedDecisionQueueSurface([decision("proposed", ["build passed"])])

    expect(surface.items[0]?.evidenceState).toBe("present")
    expect(surface.items[0]?.nextMove).toContain("Review evidence")
  })

  it("does not approve decisions, grant authority, execute, or write production", () => {
    const surface = getBlockedDecisionQueueSurface([])

    expect(surface.emptyState.title).toBe("No blocked decisions")
    expect(surface.safety).toEqual({
      readOnly: true,
      approvesDecision: false,
      grantsAuthority: false,
      executesWork: false,
      writesProduction: false,
    })
  })
})
