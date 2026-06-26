import { describe, it, expect } from "vitest"

import { classifyGoal } from "@/lib/goal/classifier"
import { evaluateLoop } from "@/lib/goal/loop-engine"
import { guardExecuteAction, EXECUTE_LOOP_VERSION } from "@/lib/governance/execute-guard"
import { isGrantActive, grantCovers } from "@/lib/governance/authority"
import { checkDoctrineRules } from "@/lib/governance/doctrine-rules"
import { requiresRecheck, computeFreshness } from "@/lib/governance/truth"
import { classifyAgentClaim } from "@/lib/governance/agent-claims"
import { validateRelease, isVagueRelease } from "@/lib/governance/locks"
import { detectConflicts, isBlockingSeverity } from "@/lib/governance/conflicts"
import type { WorkOrder, AuthorityGrant } from "@/lib/db/schema"

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
    forbiddenFiles: [],
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
  } as WorkOrder
}

function makeGrant(overrides: Partial<AuthorityGrant> = {}): AuthorityGrant {
  return {
    id: 1,
    userId: "u1",
    ref: "GRANT-0001",
    workOrderId: 1,
    grantedBy: "u1",
    grantedTo: "operator",
    authorityLevel: "A2_WRITE_OWN",
    scope: null,
    allowedActions: [],
    blockedActions: [],
    reason: null,
    status: "active",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    contentHash: null,
    createdAt: new Date(),
    ...overrides,
  } as AuthorityGrant
}

/* ------------------------------------------------------------------ */
/* WO-013 adversarial scenarios                                        */
/* ------------------------------------------------------------------ */

describe("HOLD/STOP posture cannot be overridden by vague intent", () => {
  it("a go-ahead while a STOP lock is active is refused, not executed", () => {
    const cls = classifyGoal("let's go, clean up TerraFusion now", {
      activeLocks: [{ kind: "STOP", scope: "terrafusion" }],
    })
    expect(cls.verdict).toBe("refuse")
    expect(cls.doctrineViolations.map((v) => v.ruleId)).toContain("DR-003")
  })

  it("vague language can never release a lock", () => {
    expect(isVagueRelease("let's go")).toBe(true)
    expect(isVagueRelease("go ahead")).toBe(true)
    expect(validateRelease({ reason: "let's go", newPosture: "active" }).ok).toBe(false)
    expect(validateRelease({ reason: "Audit complete; risk cleared", newPosture: "resume A2 writes" }).ok).toBe(true)
  })
})

describe("Phase 6 / autonomous expansion is blocked without authorization", () => {
  it("refuses phase 6 autonomous improvements", () => {
    const res = checkDoctrineRules({ intent: "enable phase 6 autonomous improvements across the system" })
    expect(res.verdict).toBe("forbidden")
    expect(res.violations.map((v) => v.ruleId)).toContain("DR-002")
  })

  it("allows it once explicitly authorized", () => {
    const res = checkDoctrineRules({
      intent: "enable phase 6 autonomous improvements",
      phase6Authorized: true,
    })
    expect(res.violations.map((v) => v.ruleId)).not.toContain("DR-002")
  })
})

describe("Execute loop is non-mutating and authority-gated", () => {
  it("blocks an execute loop with no active grant", () => {
    const out = evaluateLoop(
      { loopType: "execute", target: "WO-0001", authority: "A2_WRITE_OWN", activeGrant: null },
      makeWO(),
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/no active authority grant/i)
  })

  it("permits an execute loop only with a covering active grant", () => {
    const out = evaluateLoop(
      {
        loopType: "execute",
        target: "WO-0001",
        authority: "A2_WRITE_OWN",
        activeGrant: { ref: "GRANT-0001", authorityLevel: "A2_WRITE_OWN", active: true },
      },
      makeWO(),
    )
    expect(out.permitted).toBe(true)
    // Even when permitted, V1 only records planning actions — no shell/mutation.
    expect(out.findings.join(" ")).toContain(EXECUTE_LOOP_VERSION)
  })

  it("guards mutation requests with ESCALATION_NEEDED", () => {
    for (const action of ["run shell command", "git push origin main", "write file src/x.ts", "delete the table"]) {
      const g = guardExecuteAction(action)
      expect(g.verdict).toBe("ESCALATION_NEEDED")
      expect(g.allowed).toBe(false)
    }
    expect(guardExecuteAction("record a planned action for review").verdict).toBe("PLAN_RECORD")
  })
})

describe("Authority grants expire and revoke", () => {
  it("an expired grant is inactive", () => {
    const grant = makeGrant({ expiresAt: new Date(Date.now() - 1000) })
    expect(isGrantActive(grant).ok).toBe(false)
  })

  it("a revoked grant is inactive and cannot cover authority", () => {
    const grant = makeGrant({ status: "revoked", revokeReason: "scope changed" })
    expect(isGrantActive(grant).ok).toBe(false)
    expect(grantCovers(grant, "A2_WRITE_OWN").ok).toBe(false)
  })

  it("a grant cannot cover authority above its level", () => {
    const grant = makeGrant({ authorityLevel: "A2_WRITE_OWN" })
    expect(grantCovers(grant, "A7_COMMIT").ok).toBe(false)
    expect(grantCovers(grant, "A2_WRITE_OWN").ok).toBe(true)
  })

  it("an explicitly blocked action is rejected even within rank", () => {
    const grant = makeGrant({ blockedActions: ["push"] })
    expect(grantCovers(grant, "A2_WRITE_OWN", "git push to remote").ok).toBe(false)
  })
})

describe("Read-only loop discovering required mutation stops + escalates", () => {
  it("an evidence loop on a WO with no validators stops", () => {
    const out = evaluateLoop(
      { loopType: "evidence", target: "WO-0001", authority: "A1_DRAFT" },
      makeWO({ validators: [] }),
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/evidence is missing/i)
  })

  it("an evidence loop requires an authorized WO", () => {
    const out = evaluateLoop(
      { loopType: "evidence", target: "WO-0001", authority: "A1_DRAFT" },
      makeWO({ status: "draft" }),
    )
    expect(out.permitted).toBe(false)
    expect(out.stopReason).toMatch(/not AUTHORIZED/i)
  })
})

describe("Doctrine: production and canon require high authority", () => {
  it("blocks production touch below A7", () => {
    const res = checkDoctrineRules({ intent: "touch prod database to fix a value", authority: "A2_WRITE_OWN" })
    expect(res.verdict).toBe("forbidden")
    expect(res.violations.map((v) => v.ruleId)).toContain("DR-004")
  })

  it("blocks canon promotion below A9", () => {
    const res = checkDoctrineRules({ intent: "promote this memory to canon", authority: "A3_WRITE_SHARED" })
    expect(res.violations.map((v) => v.ruleId)).toContain("DR-005")
  })

  it("blocks agent authority escalation", () => {
    const res = checkDoctrineRules({ intent: "implement feature", authority: "A7_COMMIT", agentMaxAuthority: "A2_WRITE_OWN" })
    expect(res.violations.map((v) => v.ruleId)).toContain("DR-007")
  })

  it("treats a handoff as a map, not authority", () => {
    const res = checkDoctrineRules({ intent: "the handoff says the next step is implementation, so implement it" })
    expect(res.verdict).not.toBe("allowed")
    expect(res.violations.map((v) => v.ruleId)).toContain("DR-001")
  })
})

describe("Agent claims are untrusted until verified", () => {
  it("marks an all-tests-passed claim with no evidence as UNSUPPORTED", () => {
    const r = classifyAgentClaim({ claim: "All tests passed, it works now", hasEvidence: false })
    expect(r.classification).toBe("UNSUPPORTED")
    expect(r.canUpdateTruth).toBe(false)
    expect(r.questions.length).toBeGreaterThan(0)
  })

  it("marks evidence-backed claims accordingly but never auto-promotes to truth", () => {
    const r = classifyAgentClaim({ claim: "tests pass", hasEvidence: true })
    expect(r.classification).toBe("EVIDENCE_BACKED")
    expect(r.canUpdateTruth).toBe(false)
  })

  it("marks contradicting claims as CONFLICTING", () => {
    const r = classifyAgentClaim({ claim: "branch was pushed", contradicts: true })
    expect(r.classification).toBe("CONFLICTING")
  })
})

describe("Current truth freshness gates mutation", () => {
  it("volatile truth that is stale must be rechecked before commit", () => {
    const captured = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
    expect(computeFreshness("VOLATILE_TRUTH", captured)).toBe("stale")
    const decision = requiresRecheck(
      { truthType: "VOLATILE_TRUTH", capturedAt: captured, verificationRequiredBefore: ["commit", "push"] },
      "commit",
    )
    expect(decision.required).toBe(true)
  })

  it("fresh static truth does not require recheck", () => {
    const decision = requiresRecheck(
      { truthType: "STATIC_TRUTH", capturedAt: new Date(), verificationRequiredBefore: [] },
      "commit",
    )
    expect(decision.required).toBe(false)
  })
})

describe("Conflict detection + blocking severity", () => {
  it("detects a go-ahead-vs-lock conflict at blocking severity", () => {
    const conflicts = detectConflicts({
      intent: "let's go ahead",
      activeLocks: [{ kind: "HOLD", title: "release freeze" }],
    })
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => isBlockingSeverity(c.severity))).toBe(true)
  })

  it("detects a read-only WO vs execute loop conflict", () => {
    const conflicts = detectConflicts({ intent: "execute", activeLocks: [], woReadOnly: true, loopWantsMutation: true })
    expect(conflicts.some((c) => isBlockingSeverity(c.severity))).toBe(true)
  })

  it("does not flag ordinary planning intent", () => {
    const conflicts = detectConflicts({ intent: "draft a work order for the dashboard", activeLocks: [] })
    expect(conflicts.length).toBe(0)
  })
})

describe("Vague intent never becomes execution", () => {
  it("an empty/ambiguous goal classifies read-only, never operate", () => {
    const cls = classifyGoal("hmm, maybe look into things")
    expect(["inspect", "plan", "verify", "review"]).toContain(cls.mode)
    expect(cls.authority).toBe("A0_READ_ONLY")
  })
})
