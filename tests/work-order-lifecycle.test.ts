import { describe, it, expect } from "vitest"

import {
  WO_STATUSES,
  OPEN_WO_STATUSES,
  TERMINAL_WO_STATUSES,
  TRANSITIONS,
  canTransition,
  checkApprovalReadiness,
  requiresExplicitApproval,
  buildClosureReport,
  type WoStatus,
} from "@/lib/work-orders/lifecycle"
import { evaluateLoop } from "@/lib/goal/loop-engine"
import type { WorkOrder } from "@/lib/db/schema"

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeWO(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 1,
    userId: "u1",
    ref: "WO-0001",
    title: "Test WO",
    description: null,
    goal: "do a thing",
    loop: null,
    scope: "scoped",
    nonGoals: [],
    allowedFiles: [],
    forbiddenFiles: ["lib/db/schema.ts"],
    validators: ["tsc --noEmit"],
    stopConditions: [],
    lane: null,
    phase: null,
    status: "approved",
    priority: "medium",
    assignee: null,
    authorityLevel: "A2_WRITE_OWN",
    authorityGranted: null,
    authorityGrantId: null,
    acceptanceCriteria: ["it works"],
    agent: null,
    approvedBy: null,
    approvedAt: null,
    linkedDecisionId: null,
    evidence: [],
    result: null,
    commitRef: null,
    tagRef: null,
    commitAllowed: false,
    tagAllowed: false,
    pushAllowed: false,
    supersedesId: null,
    supersededById: null,
    dueAt: null,
    closedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Transition graph                                                    */
/* ------------------------------------------------------------------ */

describe("WO transition graph is a closed, legal state machine", () => {
  it("open statuses include every non-terminal lifecycle state", () => {
    expect(TERMINAL_WO_STATUSES).toEqual(["closed", "aborted"])
    expect(OPEN_WO_STATUSES).toEqual(["draft", "proposed", "approved", "active", "blocked", "review"])
  })

  it("only permits transitions declared in TRANSITIONS", () => {
    for (const from of WO_STATUSES) {
      for (const to of WO_STATUSES) {
        const expected = TRANSITIONS[from].includes(to)
        expect(canTransition(from, to)).toBe(expected)
      }
    }
  })

  it("closed and aborted are terminal — no exits", () => {
    for (const to of WO_STATUSES) {
      expect(canTransition("closed", to)).toBe(false)
      expect(canTransition("aborted", to)).toBe(false)
    }
  })

  it("the happy path draft → proposed → approved → active → review → closed is legal", () => {
    const path: WoStatus[] = ["draft", "proposed", "approved", "active", "review", "closed"]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  it("a draft can never jump straight to active or approved", () => {
    expect(canTransition("draft", "active")).toBe(false)
    expect(canTransition("draft", "approved")).toBe(false)
  })

  it("rejects unknown states", () => {
    expect(canTransition("nonsense", "active")).toBe(false)
    expect(canTransition("draft", "nonsense")).toBe(false)
  })

  it("every state can be aborted except terminal states", () => {
    for (const from of WO_STATUSES) {
      const terminal = from === "closed" || from === "aborted"
      expect(canTransition(from, "aborted")).toBe(!terminal)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Approval-readiness gate (§9.2)                                      */
/* ------------------------------------------------------------------ */

describe("Approval-readiness gate enforces a complete contract", () => {
  it("a fully specified WO is ready", () => {
    expect(checkApprovalReadiness(makeWO()).ready).toBe(true)
  })

  it("missing scope blocks authorization", () => {
    const r = checkApprovalReadiness(makeWO({ scope: "" }))
    expect(r.ready).toBe(false)
    expect(r.missing).toContain("Scope must be defined")
  })

  it("missing acceptance criteria blocks authorization", () => {
    const r = checkApprovalReadiness(makeWO({ acceptanceCriteria: [] }))
    expect(r.ready).toBe(false)
    expect(r.missing).toContain("Acceptance criteria must exist")
  })

  it("missing validators blocks authorization", () => {
    const r = checkApprovalReadiness(makeWO({ validators: [] }))
    expect(r.ready).toBe(false)
    expect(r.missing).toContain("A validation method must exist")
  })

  it("missing forbidden files blocks authorization", () => {
    const r = checkApprovalReadiness(makeWO({ forbiddenFiles: [] }))
    expect(r.ready).toBe(false)
    expect(r.missing).toContain("Blocked actions / forbidden files must be declared")
  })

  it("reports every missing precondition at once", () => {
    const r = checkApprovalReadiness(
      makeWO({ scope: "", acceptanceCriteria: [], validators: [], forbiddenFiles: [] }),
    )
    expect(r.missing.length).toBeGreaterThanOrEqual(4)
  })
})

/* ------------------------------------------------------------------ */
/* Explicit-approval rule (authority > A1)                             */
/* ------------------------------------------------------------------ */

describe("Authority above A1 always requires explicit operator approval", () => {
  it("A0 and A1 do not require an explicit grant act", () => {
    expect(requiresExplicitApproval("A0_READ_ONLY")).toBe(false)
    expect(requiresExplicitApproval("A1_DRAFT")).toBe(false)
  })

  it("A2 through A9 require an explicit grant act", () => {
    for (const a of [
      "A2_WRITE_OWN",
      "A3_WRITE_SHARED",
      "A4_SCHEMA",
      "A5_DESTRUCTIVE",
      "A6_AUTH",
      "A7_COMMIT",
      "A8_PUSH",
      "A9_RELEASE",
    ]) {
      expect(requiresExplicitApproval(a)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Closure report                                                      */
/* ------------------------------------------------------------------ */

describe("Closure report reflects the stored contract and gates", () => {
  it("shows PENDING result and closed gates by default", () => {
    const report = buildClosureReport(makeWO())
    expect(report).toContain("RESULT: PENDING")
    expect(report).toContain("WORK ORDER: WO-0001")
    expect(report).toContain("[gate closed]")
    expect(report).toContain("PUSH GATE: closed")
  })

  it("surfaces an open commit gate and recorded commit ref", () => {
    const report = buildClosureReport(
      makeWO({ result: "PASS", commitRef: "abc1234", commitAllowed: true }),
    )
    expect(report).toContain("RESULT: PASS")
    expect(report).toContain("COMMIT: abc1234")
    expect(report).not.toContain("COMMIT: abc1234  [gate closed]")
  })
})

/* ------------------------------------------------------------------ */
/* Full execute path invariant — lifecycle + loop engine together      */
/* ------------------------------------------------------------------ */

describe("End-to-end: a WO must be authorized AND granted before an execute loop runs", () => {
  it("an approved WO with no active grant still blocks the execute loop", () => {
    const wo = makeWO({ status: "approved", authorityGranted: "A2_WRITE_OWN" })
    const out = evaluateLoop(
      { loopType: "execute", target: wo.ref!, authority: "A2_WRITE_OWN", activeGrant: null },
      wo,
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/no active authority grant/i)
  })

  it("an unapproved WO blocks the execute loop even with a grant present", () => {
    const wo = makeWO({ status: "draft" })
    const out = evaluateLoop(
      {
        loopType: "execute",
        target: wo.ref!,
        authority: "A2_WRITE_OWN",
        activeGrant: { ref: "GRANT-0001", authorityLevel: "A2_WRITE_OWN", active: true },
      },
      wo,
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/not AUTHORIZED/i)
  })

  it("an authorized WO with a covering active grant permits the execute loop (non-mutating)", () => {
    const wo = makeWO({ status: "active", authorityGranted: "A2_WRITE_OWN" })
    const out = evaluateLoop(
      {
        loopType: "execute",
        target: wo.ref!,
        authority: "A2_WRITE_OWN",
        activeGrant: { ref: "GRANT-0001", authorityLevel: "A2_WRITE_OWN", active: true },
      },
      wo,
    )
    expect(out.permitted).toBe(true)
    expect(out.mode).toBe("EXECUTE")
    // The whole point: even permitted, it never mutates.
    expect(out.actionsTaken.join(" ")).toMatch(/no shell, no file writes/i)
  })

  it("a grant weaker than the requested authority blocks the execute loop", () => {
    const wo = makeWO({ status: "active" })
    const out = evaluateLoop(
      {
        loopType: "execute",
        target: wo.ref!,
        authority: "A7_COMMIT",
        activeGrant: { ref: "GRANT-0001", authorityLevel: "A2_WRITE_OWN", active: true },
      },
      wo,
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/only provides/i)
  })
})
