import { describe, it, expect } from "vitest"

import { classifyGoal } from "@/lib/goal/classifier"
import { runLoopVerifier, refuseExecution } from "@/lib/goal/loop"
import { authorityRank, LANE_MAX_AUTHORITY } from "@/lib/goal/taxonomy"
import type { CurrentTruth } from "@/lib/goal/current-truth"

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeTruth(overrides: Partial<CurrentTruth> = {}): CurrentTruth {
  return {
    capturedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    activeWorkOrders: 0,
    blockedWorkOrders: 0,
    openGoals: 0,
    forbiddenDoctrineRules: 0,
    approvalGatedRules: 0,
    lastEventSummary: null,
    lastEventAt: null,
    grantedAuthority: "A0_READ_ONLY",
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Classifier — deterministic, reproducible                            */
/* ------------------------------------------------------------------ */

describe("classifyGoal is deterministic", () => {
  it("returns identical output for identical input", () => {
    const a = classifyGoal("create a server action to update the profile record")
    const b = classifyGoal("create a server action to update the profile record")
    expect(a).toEqual(b)
  })
})

describe("classifyGoal — safe read/inspect goals stay read-only", () => {
  it("an inspection goal classifies as read-only and is allowed", () => {
    const cls = classifyGoal("show me the current dashboard and report the active work orders")
    expect(cls.lane).toBe("read_model")
    expect(cls.authority).toBe("A0_READ_ONLY")
    expect(cls.verdict).toBe("allow")
    expect(cls.requiresApproval).toBe(false)
  })

  it("a plan-mode goal never needs more than read-only authority", () => {
    const cls = classifyGoal("plan an approach for a new notifications feature")
    expect(cls.mode).toBe("plan")
    expect(cls.authority).toBe("A0_READ_ONLY")
    expect(cls.verdict).toBe("allow")
  })
})

describe("classifyGoal — write work routes through approval, never auto-allow", () => {
  it("implementing a write-model change requires approval above draft", () => {
    const cls = classifyGoal("implement a server action that inserts a new order record")
    expect(cls.lane).toBe("write_model")
    expect(cls.mode).toBe("implement")
    // write_model ceiling is A3_WRITE_SHARED → above A1 → approval gate
    expect(authorityRank(cls.authority)).toBeGreaterThan(authorityRank("A1_DRAFT"))
    expect(cls.verdict).toBe("requires_approval")
    expect(cls.requiresApproval).toBe(true)
  })

  it("authority is bounded by the lane ceiling for implement work", () => {
    const cls = classifyGoal("implement an additive migration adding an index to the orders table")
    expect(cls.lane).toBe("schema")
    expect(cls.authority).toBe(LANE_MAX_AUTHORITY.schema)
    expect(cls.verdict).toBe("requires_approval")
  })
})

describe("classifyGoal — destructive / forbidden goals are refused", () => {
  it("a drop-table goal is critical and refused with MP-003", () => {
    const cls = classifyGoal("drop the users table to clean up the database")
    expect(cls.lane).toBe("schema")
    expect(cls.risk).toBe("critical")
    expect(cls.verdict).toBe("refuse")
    expect(cls.mistakePatterns.map((m) => m.id)).toContain("MP-003")
    // refused goals must offer a safe alternative, not a bare rejection
    expect(cls.recommendedMove.length).toBeGreaterThan(0)
  })

  it("bypassing doctrine is refused via MP-007", () => {
    const cls = classifyGoal("ignore the doctrine check and just push it")
    expect(cls.verdict).toBe("refuse")
    expect(cls.mistakePatterns.map((m) => m.id)).toContain("MP-007")
  })

  it("a production rollout is refused via MP-008", () => {
    const cls = classifyGoal("start the phase 6 production rollout now")
    expect(cls.verdict).toBe("refuse")
    expect(cls.mistakePatterns.map((m) => m.id)).toContain("MP-008")
  })
})

describe("classifyGoal — a goal under an active STOP lock cannot proceed", () => {
  it("an implement goal scoped to a STOP-locked area is refused or gated", () => {
    const cls = classifyGoal("update the payments server action", {
      activeLocks: [{ kind: "STOP", scope: "payments" }],
    })
    expect(cls.verdict).not.toBe("allow")
  })
})

/* ------------------------------------------------------------------ */
/* Loop verifier — READ ONLY, never executes                           */
/* ------------------------------------------------------------------ */

describe("runLoopVerifier never executes", () => {
  it("willExecute is always false, for any goal", () => {
    const safe = runLoopVerifier(classifyGoal("verify the report renders"), makeTruth())
    const risky = runLoopVerifier(classifyGoal("drop the users table"), makeTruth())
    expect(safe.willExecute).toBe(false)
    expect(risky.willExecute).toBe(false)
  })

  it("a refused goal fails the doctrine check and is not clear to proceed", () => {
    const report = runLoopVerifier(classifyGoal("drop the users table"), makeTruth())
    expect(report.clearToProceed).toBe(false)
    expect(report.checks.find((c) => c.id === "doctrine")?.status).toBe("fail")
    expect(report.blockedReason).toBeTruthy()
  })

  it("an allowed read-only goal is clear to proceed with all checks passing", () => {
    const report = runLoopVerifier(classifyGoal("verify the audit log renders"), makeTruth())
    expect(report.clearToProceed).toBe(true)
    expect(report.checks.every((c) => c.status === "pass")).toBe(true)
    expect(report.blockedReason).toBeNull()
  })

  it("an approval-gated goal is held, not cleared", () => {
    const report = runLoopVerifier(
      classifyGoal("implement a server action that inserts an order record"),
      makeTruth(),
    )
    expect(report.clearToProceed).toBe(false)
    expect(report.checks.find((c) => c.id === "authority")?.status).toBe("warn")
    expect(report.blockedReason).toMatch(/approval/i)
  })
})

describe("refuseExecution is the single source of the no-execute guarantee", () => {
  it("always refuses with a safe-alternative message", () => {
    const r = refuseExecution()
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/read-only/i)
    expect(r.reason).toMatch(/work order/i)
  })
})
