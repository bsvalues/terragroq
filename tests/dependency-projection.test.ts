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
    const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "operator", authorityGrantRef: "DEP-ACQ-GRANT-2" })
    // Authenticated principal and the concrete grant ref, NOT a role label or a synthetic envelope ref.
    expect(p.authoritySubject).toBe("operator")
    expect(p.authorityGrantRef).toBe("DEP-ACQ-GRANT-2")
    expect(p.authorityGrantRef).not.toMatch(/^envelope:/)
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
    const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "operator", authorityGrantRef: "DEP-ACQ-GRANT-2" })
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
        subject: "operator",
        authorityGrantRef: "DEP-ACQ-GRANT-2",
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
  const p = projectDependency({ dep: provisionDep(), envelope: ENVELOPE, truthBindingRef: TB_REF, subject: "operator", authorityGrantRef: "DEP-ACQ-GRANT-2" })
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
    validAuthorityGrantRefs: ["DEP-ACQ-GRANT-2"],
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

/* ------------------------------------------------------------------ */
/* Structured settlement receipt — LAND's forge-resistant second fact  */
/* ------------------------------------------------------------------ */

import { buildSettlementReceipt, verifyExecutorSettlement, SETTLEMENT_METHOD } from "@/lib/outcome-queue/dependency-projection"

const FENCE = {
  projectionQueueItemId: 23,
  leaseHolder: "hermes:outcome-queue",
  fencingToken: 7,
  executionBinding: "exec-abc",
  queueTerminalKey: "hermes:routed-dependency:2:7:dependency",
}
const EV = { bindW1RuntimeBound: true, observedProjectId: 2, observedRevision: "5a328e728852dc2bb933d704d0daa5c54750728c" }

function goodReceipt() {
  return buildSettlementReceipt({ dependencyId: 2, fence: FENCE, routingState: "resolved", evidence: EV })
}
const EXPECT = {
  expectDependencyId: 2,
  expectProjectionQueueItemId: 23,
  expectProjectId: 2,
  expectRevision: "5a328e728852dc2bb933d704d0daa5c54750728c",
}

describe("verifyExecutorSettlement — LAND fact 2 from structured receipt, not prose", () => {
  it("accepts a valid executor receipt", () => {
    expect(verifyExecutorSettlement({ receipt: goodReceipt(), ...EXPECT })).toMatchObject({ ok: true })
  })

  it("the receipt carries the fence and the projection_executor method", () => {
    const r = goodReceipt()
    expect(r.settlementMethod).toBe(SETTLEMENT_METHOD)
    expect(r.fencingToken).toBe(7)
    expect(r.projectionQueueItemId).toBe(23)
  })

  it("FORGE-RESISTANCE: no receipt at all refuses (a manual UPDATE produces none)", () => {
    expect(verifyExecutorSettlement({ receipt: null, ...EXPECT })).toMatchObject({ ok: false, refusal: "NO_EXECUTOR_RECEIPT" })
  })

  it("refuses a receipt claiming a different settlement method", () => {
    const r = { ...goodReceipt(), settlementMethod: "manual" as never }
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: false, refusal: "WRONG_METHOD" })
  })

  it("refuses if the binder did not bind", () => {
    const r = buildSettlementReceipt({ dependencyId: 2, fence: FENCE, routingState: "resolved", evidence: { ...EV, bindW1RuntimeBound: false } })
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: false, refusal: "NOT_BOUND" })
  })

  it("refuses the wrong observed Project", () => {
    const r = buildSettlementReceipt({ dependencyId: 2, fence: FENCE, routingState: "resolved", evidence: { ...EV, observedProjectId: 41 } })
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: false, refusal: "WRONG_PROJECT" })
  })

  it("refuses the wrong TerraFusion revision", () => {
    const r = buildSettlementReceipt({ dependencyId: 2, fence: FENCE, routingState: "resolved", evidence: { ...EV, observedRevision: "deadbeef00112233445566778899aabbccddeeff" } })
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: false, refusal: "WRONG_REVISION" })
  })

  it("refuses a receipt bound to a different projection", () => {
    const r = buildSettlementReceipt({ dependencyId: 2, fence: { ...FENCE, projectionQueueItemId: 999 }, routingState: "resolved", evidence: EV })
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: false, refusal: "PROJECTION_MISMATCH" })
  })

  it("accepts an abbreviated revision that prefixes the bound one", () => {
    const r = buildSettlementReceipt({ dependencyId: 2, fence: FENCE, routingState: "resolved", evidence: { ...EV, observedRevision: "5a328e72" } })
    expect(verifyExecutorSettlement({ receipt: r, ...EXPECT })).toMatchObject({ ok: true })
  })
})

import { formatTruthBindingRef } from "@/lib/outcome-queue/dependency-projection"

describe("revision-aware truth-binding reference — the drift guard can now see a rebound", () => {
  it("encodes each resource's head revision", () => {
    const ref = formatTruthBindingRef({
      bindingId: 1,
      projectId: 2,
      resourceRevisions: { "terrafusion-primary-repo": "5a328e72", "williamos-primary-repo": "a6dc845c" },
    })
    expect(ref).toBe("binding:1:project:2|rev:terrafusion-primary-repo=5a328e72;williamos-primary-repo=a6dc845c")
  })

  it("a WilliamOS rebound changes the reference (so the digest drifts)", () => {
    const before = formatTruthBindingRef({ bindingId: 1, projectId: 2, resourceRevisions: { "williamos-primary-repo": "d0c3bf4f" } })
    const after = formatTruthBindingRef({ bindingId: 1, projectId: 2, resourceRevisions: { "williamos-primary-repo": "a6dc845c" } })
    expect(before).not.toBe(after)
    // and therefore the envelope digest differs
    const env = { resource: "workspace-runtime", surfaceClass: "runtime_control" as const, capability: "control" }
    expect(computeEnvelopeDigest(env, before)).not.toBe(computeEnvelopeDigest(env, after))
  })

  it("is order-independent in resource keys (stable)", () => {
    const a = formatTruthBindingRef({ bindingId: 1, projectId: 2, resourceRevisions: { b: "2", a: "1" } })
    const b = formatTruthBindingRef({ bindingId: 1, projectId: 2, resourceRevisions: { a: "1", b: "2" } })
    expect(a).toBe(b)
  })

  it("the OLD coarse ref no longer matches the revision-aware one (so #23 is stale)", () => {
    const coarse = "binding:1:project:2"
    const fresh = formatTruthBindingRef({ bindingId: 1, projectId: 2, resourceRevisions: { "terrafusion-primary-repo": "5a328e72", "williamos-primary-repo": "a6dc845c" } })
    expect(coarse).not.toBe(fresh)
  })
})
