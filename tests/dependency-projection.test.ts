import { describe, it, expect } from "vitest"

import {
  NEUTRAL_AUTHORITY_LEVEL,
  computeEnvelopeDigest,
  dependencyResolutionFor,
  isDependencyProjectable,
  projectDependency,
  verifyProjectionForExecution,
  type DependencyEnvelope,
  type ProjectableDependency,
} from "@/lib/outcome-queue/dependency-projection"
import { selectNextOutcome, type OutcomeQueueRecord } from "@/lib/outcome-queue/engine"

/** PROVISION id=2: runtime_control:control over the workspace-runtime service. */
function provisionDep(over: Partial<ProjectableDependency> = {}): ProjectableDependency {
  return {
    id: 2,
    workOrderId: 55,
    routingState: "routed",
    operation: "Start the declared workspace runtime and observe its belonging",
    requiredResource: "workspace-runtime",
    requiredClass: "runtime_control",
    requiredCapability: "control",
    blocksAcceptance: true,
    ...over,
  }
}

const ENVELOPE: DependencyEnvelope = {
  resource: "workspace-runtime",
  surfaceClass: "runtime_control",
  capability: "control",
}
const TB_REF = "binding:1:project:2"

/* ------------------------------------------------------------------ */
/* Projection carries the real envelope, not an A-level                */
/* ------------------------------------------------------------------ */

describe("projectDependency", () => {
  it("projects PROVISION with the resource-scoped envelope, verbatim", () => {
    const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "runtime_control:hermes" })
    expect(p.envelopeClass).toBe("runtime_control")
    expect(p.envelopeCapability).toBe("control")
    expect(p.envelopeResource).toBe("workspace-runtime")
    expect(p.authorityAction).toBe("runtime_control:control")
    expect(p.canonicalDependencyId).toBe(2)
    expect(p.parentWorkOrderId).toBe(55)
  })

  it("NEGATIVE PROOF: no A0-A9 downgrade or translation", () => {
    // The whole point. runtime_control:control is never mapped onto an A-level; authorityLevel stays
    // at the neutral least-privilege sentinel and the real authority is the envelope.
    const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "x" })
    expect(p.authorityLevel).toBe(NEUTRAL_AUTHORITY_LEVEL)
    expect(p.authorityLevel).toBe("A0_READ_ONLY")
    expect(p.authorityAction).not.toMatch(/^A[0-9]_/)
    expect(JSON.stringify(p)).not.toMatch(/A2_WRITE_OWN|A7_COMMIT|A9_RELEASE/)
  })

  it("refuses to project a dependency whose envelope does not cover the operation", () => {
    // An envelope that grants observe cannot project a job that needs control.
    expect(() =>
      projectDependency({
        dep: provisionDep(),
        envelope: { resource: "workspace-runtime", surfaceClass: "runtime_control", capability: "observe" },
        truthBindingRef: TB_REF,
        subject: "x",
      }),
    ).toThrow(/does not cover/)
  })

  it("does not project a terminal dependency", () => {
    expect(isDependencyProjectable(provisionDep({ routingState: "resolved" }))).toBe(false)
    expect(isDependencyProjectable(provisionDep({ routingState: "refused" }))).toBe(false)
    expect(isDependencyProjectable(provisionDep())).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* The existing engine selects the projection (no second executor)     */
/* ------------------------------------------------------------------ */

function projectionRecord(over: Partial<OutcomeQueueRecord> = {}): OutcomeQueueRecord {
  const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "runtime_control:hermes" })
  return {
    userId: "owner",
    outcomeKey: p.outcomeKey,
    goalId: null,
    goalRef: null,
    title: p.title,
    objective: p.objective,
    queueOrder: 0,
    dependencyKeys: [],
    riskClass: p.riskClass,
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: "2026-08-26T00:00:00.000Z",
    approvalDecisionId: 900,
    authorityState: "matched",
    authorityLevel: p.authorityLevel,
    authorityGrantRef: p.authorityGrantRef,
    authoritySubject: p.authoritySubject,
    authorityAction: p.authorityAction,
    lifecycleState: "approved",
    lifecycleReason: null,
    activeWorkOrderId: 55,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    version: 0,
    acquisitionKey: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: "2026-08-26T00:00:00.000Z",
    activatedAt: null,
    terminalAt: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...over,
  }
}

describe("the existing outcome-queue engine leases the projection (no new executor)", () => {
  const opts = {
    now: "2026-08-26T01:00:00.000Z",
    allowedRiskClasses: ["R0", "R1"],
    validApprovalDecisionIds: [900],
    validAuthorityGrantRefs: ["envelope:routed_dependency:2"],
  }

  it("selectNextOutcome ACTIVATES the projection with no A-level involved", () => {
    const sel = selectNextOutcome([projectionRecord()], opts)
    expect(sel.selected).toBe(true)
    if (sel.selected) {
      expect(sel.mode).toBe("ACTIVATE")
      expect(sel.item.authorityAction).toBe("runtime_control:control")
    }
  })

  it("is NOT selected when its authority grant ref is not in the valid set", () => {
    const sel = selectNextOutcome([projectionRecord()], { ...opts, validAuthorityGrantRefs: [] })
    expect(sel.selected).toBe(false)
  })

  it("respects one-active-per-user: waits behind a live active outcome", () => {
    // Reusing the executor means inheriting its serialization -- correct, not a defect.
    const active = projectionRecord({
      outcomeKey: "goal:GOAL-0025",
      lifecycleState: "active",
      leaseHolder: "hermes",
      leaseToken: "t",
      leaseExpiresAt: "2026-08-26T02:00:00.000Z",
    })
    const sel = selectNextOutcome([active, projectionRecord()], opts)
    expect(sel.selected).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Acquisition re-verification — no stale authority                    */
/* ------------------------------------------------------------------ */

describe("verifyProjectionForExecution", () => {
  const projection = {
    canonicalDependencyId: 2,
    envelopeResource: "workspace-runtime",
    envelopeClass: "runtime_control" as const,
    envelopeCapability: "control",
    envelopeDigest: computeEnvelopeDigest(ENVELOPE, TB_REF),
  }
  const liveDep = {
    id: 2,
    routingState: "routed" as const,
    requiredClass: "runtime_control" as const,
    requiredCapability: "control",
    requiredResource: "workspace-runtime",
  }

  it("passes when the live dependency and envelope are unchanged", () => {
    expect(
      verifyProjectionForExecution({ projection, liveDep, liveEnvelope: ENVELOPE, liveTruthBindingRef: TB_REF }),
    ).toEqual({ ok: true })
  })

  it("NEGATIVE PROOF: refuses if the truth binding changed since projection", () => {
    const v = verifyProjectionForExecution({
      projection,
      liveDep,
      liveEnvelope: ENVELOPE,
      liveTruthBindingRef: "binding:1:project:2:REBOUND",
    })
    expect(v).toMatchObject({ ok: false, refusal: "ENVELOPE_DRIFT" })
  })

  it("NEGATIVE PROOF: refuses if the envelope changed since projection", () => {
    const v = verifyProjectionForExecution({
      projection,
      liveDep,
      liveEnvelope: { ...ENVELOPE, capability: "observe" },
      liveTruthBindingRef: TB_REF,
    })
    expect(v).toMatchObject({ ok: false, refusal: "ENVELOPE_DRIFT" })
  })

  it("NEGATIVE PROOF: refuses if the dependency became terminal", () => {
    const v = verifyProjectionForExecution({
      projection,
      liveDep: { ...liveDep, routingState: "resolved" },
      liveEnvelope: ENVELOPE,
      liveTruthBindingRef: TB_REF,
    })
    expect(v).toMatchObject({ ok: false, refusal: "DEPENDENCY_TERMINAL" })
  })

  it("refuses if the live envelope no longer authorizes the required capability", () => {
    // Same digest guards most drift; this covers a live envelope that is present but insufficient.
    const weakDigest = computeEnvelopeDigest({ ...ENVELOPE, capability: "observe" }, TB_REF)
    const v = verifyProjectionForExecution({
      projection: { ...projection, envelopeDigest: weakDigest, envelopeCapability: "observe" },
      liveDep: { ...liveDep, requiredCapability: "control" },
      liveEnvelope: { ...ENVELOPE, capability: "observe" },
      liveTruthBindingRef: TB_REF,
    })
    expect(v).toMatchObject({ ok: false, refusal: "ENVELOPE_INSUFFICIENT" })
  })
})

/* ------------------------------------------------------------------ */
/* Return path — settles the dependency, not the parent outcome        */
/* ------------------------------------------------------------------ */

describe("dependencyResolutionFor", () => {
  it("a PASS resolves the dependency", () => {
    expect(dependencyResolutionFor("PASS")).toEqual({ routingState: "resolved", settlesParent: false })
  })

  it("anything else refuses it", () => {
    expect(dependencyResolutionFor("FAIL")).toMatchObject({ routingState: "refused" })
    expect(dependencyResolutionFor("PARTIAL")).toMatchObject({ routingState: "refused" })
  })

  it("NEGATIVE PROOF: completing the queue item never passes the parent outcome", () => {
    // A completed queue item settles the DEPENDENCY; the parent recomputes separately.
    expect(dependencyResolutionFor("PASS").settlesParent).toBe(false)
    expect(dependencyResolutionFor("FAIL").settlesParent).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Digest stability                                                    */
/* ------------------------------------------------------------------ */

describe("computeEnvelopeDigest", () => {
  it("is stable for the same envelope and truth binding", () => {
    expect(computeEnvelopeDigest(ENVELOPE, TB_REF)).toBe(computeEnvelopeDigest(ENVELOPE, TB_REF))
  })

  it("changes when any axis changes", () => {
    const base = computeEnvelopeDigest(ENVELOPE, TB_REF)
    expect(computeEnvelopeDigest({ ...ENVELOPE, capability: "observe" }, TB_REF)).not.toBe(base)
    expect(computeEnvelopeDigest({ ...ENVELOPE, resource: "other" }, TB_REF)).not.toBe(base)
    expect(computeEnvelopeDigest(ENVELOPE, "binding:2:project:2")).not.toBe(base)
  })
})
