import { describe, it, expect, vi } from "vitest"

import {
  completeExecutionSubject,
  computeEnvelopeDigest as seamDigest,
  resolveExecutionSubject,
  verifyProjectionForExecution as seamVerify,
} from "@/scripts/hermes-bridge/dependency-execution-seam.mjs"
import {
  computeEnvelopeDigest as tsDigest,
  verifyProjectionForExecution as tsVerify,
} from "@/lib/outcome-queue/dependency-projection"

const ENVELOPE = { resource: "workspace-runtime", surfaceClass: "runtime_control" as const, capability: "control" }
const TB_REF = "binding:1:project:2"
const DIGEST = seamDigest(ENVELOPE, TB_REF)

function goalItem() {
  return { canonicalDependencyId: null, outcomeKey: "goal:GOAL-0025" }
}
function projectionItem(over: Record<string, unknown> = {}) {
  return {
    canonicalDependencyId: 2,
    envelopeResource: "workspace-runtime",
    envelopeClass: "runtime_control",
    envelopeCapability: "control",
    envelopeDigest: DIGEST,
    ...over,
  }
}
function liveContext(over: Record<string, unknown> = {}) {
  return {
    dep: {
      id: 2,
      workOrderId: 55,
      routingState: "routed",
      requiredClass: "runtime_control",
      requiredCapability: "control",
      requiredResource: "workspace-runtime",
    },
    envelope: ENVELOPE,
    truthBindingRef: TB_REF,
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* Parity: the .mjs seam matches the TS source of truth                */
/* ------------------------------------------------------------------ */

describe("seam primitives match the TS source (no silent divergence)", () => {
  it("digest parity", () => {
    expect(seamDigest(ENVELOPE, TB_REF)).toBe(tsDigest(ENVELOPE, TB_REF))
  })

  it("verify parity across ok / drift / terminal / insufficient", () => {
    const projection = {
      canonicalDependencyId: 2,
      envelopeResource: "workspace-runtime",
      envelopeClass: "runtime_control" as const,
      envelopeCapability: "control",
      envelopeDigest: DIGEST,
    }
    const liveDep = { id: 2, routingState: "routed" as const, requiredClass: "runtime_control" as const, requiredCapability: "control", requiredResource: "workspace-runtime" }
    const cases = [
      { liveEnvelope: ENVELOPE, liveTruthBindingRef: TB_REF },
      { liveEnvelope: ENVELOPE, liveTruthBindingRef: "binding:1:project:2:REBOUND" },
      { liveEnvelope: { ...ENVELOPE, capability: "observe" }, liveTruthBindingRef: TB_REF },
    ]
    for (const c of cases) {
      const seam = seamVerify({ projection, liveDep, ...c })
      const ts = tsVerify({ projection, liveDep, ...c })
      expect(seam.ok).toBe(ts.ok)
      if (!seam.ok && !ts.ok) expect(seam.refusal).toBe(ts.refusal)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Subject resolution branches cleanly                                 */
/* ------------------------------------------------------------------ */

describe("resolveExecutionSubject", () => {
  it("a goal item never loads dependency context — existing path only", async () => {
    const loadDependencyContext = vi.fn()
    const subject = await resolveExecutionSubject(goalItem(), { loadDependencyContext })
    expect(subject).toEqual({ kind: "goal" })
    expect(loadDependencyContext).not.toHaveBeenCalled()
  })

  it("a projection re-reads the canonical dependency AFTER the lease and verifies it", async () => {
    const loadDependencyContext = vi.fn(async () => liveContext())
    const subject = await resolveExecutionSubject(projectionItem(), { loadDependencyContext })
    expect(loadDependencyContext).toHaveBeenCalledWith(2)
    expect(subject).toMatchObject({ kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55 })
  })

  it("refuses if the dependency became terminal between projection and acquisition", async () => {
    const subject = await resolveExecutionSubject(projectionItem(), {
      loadDependencyContext: async () => liveContext({ dep: { ...liveContext().dep, routingState: "resolved" } }),
    })
    expect(subject).toMatchObject({ kind: "dependency", ok: false, refusal: "DEPENDENCY_TERMINAL" })
  })

  it("refuses on envelope/truth drift before any side effect", async () => {
    const subject = await resolveExecutionSubject(projectionItem(), {
      loadDependencyContext: async () => liveContext({ truthBindingRef: "binding:1:project:2:REBOUND" }),
    })
    expect(subject).toMatchObject({ kind: "dependency", ok: false, refusal: "ENVELOPE_DRIFT" })
  })

  it("refuses if the canonical dependency is gone", async () => {
    const subject = await resolveExecutionSubject(projectionItem(), { loadDependencyContext: async () => null })
    expect(subject).toMatchObject({ kind: "dependency", ok: false, refusal: "DEPENDENCY_TERMINAL" })
  })
})

/* ------------------------------------------------------------------ */
/* Completion branches by kind; settle before terminalize; fail closed */
/* ------------------------------------------------------------------ */

describe("completeExecutionSubject", () => {
  it("a goal subject delegates to completeGoal, untouched", async () => {
    const completeGoal = vi.fn(async () => "goal-done")
    const settleDependency = vi.fn()
    const terminalizeProjection = vi.fn()
    const out = await completeExecutionSubject(
      { subject: { kind: "goal" }, evidence: ["e"], queueResult: "COMPLETE" },
      { completeGoal, settleDependency, terminalizeProjection, releaseProjection: vi.fn() },
    )
    expect(out).toMatchObject({ kind: "goal" })
    expect(completeGoal).toHaveBeenCalled()
    expect(settleDependency).not.toHaveBeenCalled()
    expect(terminalizeProjection).not.toHaveBeenCalled()
  })

  it("a dependency subject settles the CANONICAL dependency BEFORE terminalizing the projection", async () => {
    const order: string[] = []
    const settleDependency = vi.fn(async () => {
      order.push("settle")
      return { routingState: "resolved", parentWorkOrderId: 55 }
    })
    const terminalizeProjection = vi.fn(async () => order.push("terminalize"))
    const completeGoal = vi.fn()
    const out = await completeExecutionSubject(
      { subject: { kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55 }, evidence: ["ev"], queueResult: "PASS" },
      { completeGoal, settleDependency, terminalizeProjection, releaseProjection: vi.fn() },
    )
    expect(order).toEqual(["settle", "terminalize"]) // evidence attached before terminalization
    expect(completeGoal).not.toHaveBeenCalled()
    expect(out).toMatchObject({ kind: "dependency", executed: true, settled: true, settlesParent: false })
  })

  it("NEGATIVE PROOF: queue completion never closes W1 (settlesParent is false)", async () => {
    const out = await completeExecutionSubject(
      { subject: { kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55 }, evidence: ["ev"], queueResult: "PASS" },
      {
        completeGoal: vi.fn(),
        settleDependency: async () => ({ routingState: "resolved", parentWorkOrderId: 55 }),
        terminalizeProjection: vi.fn(),
        releaseProjection: vi.fn(),
      },
    )
    expect(out).toMatchObject({ settlesParent: false })
  })

  it("FAIL CLOSED: settlement failure does NOT terminalize as success", async () => {
    const terminalizeProjection = vi.fn()
    const releaseProjection = vi.fn()
    const out = await completeExecutionSubject(
      { subject: { kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55 }, evidence: ["ev"], queueResult: "PASS" },
      {
        completeGoal: vi.fn(),
        settleDependency: async () => { throw new Error("binding changed under settlement") },
        terminalizeProjection,
        releaseProjection,
      },
    )
    expect(out).toMatchObject({ kind: "dependency", executed: true, settled: false, refusal: "SETTLEMENT_FAILED" })
    expect(terminalizeProjection).not.toHaveBeenCalled() // must NOT terminalize as success
    expect(releaseProjection).toHaveBeenCalled() // preserve evidence, release the lease
  })

  it("a refused subject never runs and releases the projection", async () => {
    const settleDependency = vi.fn()
    const terminalizeProjection = vi.fn()
    const releaseProjection = vi.fn()
    const out = await completeExecutionSubject(
      { subject: { kind: "dependency", ok: false, refusal: "ENVELOPE_DRIFT" }, evidence: [], queueResult: "PASS" },
      { completeGoal: vi.fn(), settleDependency, terminalizeProjection, releaseProjection },
    )
    expect(out).toMatchObject({ executed: false, refusal: "ENVELOPE_DRIFT" })
    expect(settleDependency).not.toHaveBeenCalled()
    expect(terminalizeProjection).not.toHaveBeenCalled()
    expect(releaseProjection).toHaveBeenCalled()
  })
})

import { buildSettlementReceipt as seamBuildReceipt } from "@/scripts/hermes-bridge/dependency-execution-seam.mjs"
import { buildSettlementReceipt as tsBuildReceipt } from "@/lib/outcome-queue/dependency-projection"

describe("settlement receipt parity + fence threading", () => {
  const fence = { projectionQueueItemId: 23, leaseHolder: "h", fencingToken: 7, executionBinding: "b", queueTerminalKey: "k" }
  const ev = { bindW1RuntimeBound: true, observedProjectId: 2, observedRevision: "5a328e72" }

  it(".mjs receipt matches the TS receipt", () => {
    const a = seamBuildReceipt({ dependencyId: 2, fence, routingState: "resolved", evidence: ev })
    const b = tsBuildReceipt({ dependencyId: 2, fence, routingState: "resolved", evidence: ev })
    expect(a).toEqual(b)
  })

  it("completeExecutionSubject threads the fence + settlementEvidence to settleDependency", async () => {
    const settleDependency = vi.fn(async () => ({ routingState: "resolved", parentWorkOrderId: 55 }))
    await completeExecutionSubject(
      { subject: { kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55 }, evidence: ["ev"], queueResult: "PASS" },
      { completeGoal: vi.fn(), settleDependency, terminalizeProjection: vi.fn(), releaseProjection: vi.fn(), fence, settlementEvidence: ev },
    )
    expect(settleDependency).toHaveBeenCalledWith(expect.objectContaining({ fence, settlementEvidence: ev }))
  })
})
