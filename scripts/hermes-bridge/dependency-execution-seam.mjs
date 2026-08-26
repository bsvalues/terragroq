/**
 * The guarded seam that lets the existing outcome-queue executor run a routed-dependency projection
 * WITHOUT weakening its goal machinery.
 *
 * The executor is goal-coupled: selectOutcome -> resolveGoal -> loadLinkedGoal walls any queue item
 * with no governed goal (HERMES_OUTCOME_QUEUE_GOAL_WALL), and completion calls completeGoal. We do
 * not touch that path. Instead we branch at the executor boundary on `canonicalDependencyId`:
 *
 *   null      -> the item is an ordinary goal outcome. Call the existing goal path, exactly as today.
 *   non-null  -> the item is a dependency PROJECTION. Resolve the canonical routed dependency, its
 *                W1 work order, truth binding and envelope, and verify the projection against them
 *                AFTER the lease is held, before any side effect.
 *
 * No fake Goal object is fabricated -- an explicit discriminated union is carried through the few
 * places that need it. No authority is translated: the projection path verifies the resource-scoped
 * v2 envelope; the neutral A0 field is compatibility data only.
 *
 * Pure orchestration with all IO injected, so the seam is tested hard before HERMES is touched. The
 * digest/verify primitives are duplicated from lib/outcome-queue/dependency-projection.ts and guarded
 * by a parity test so they cannot silently diverge.
 */

/* ------------------------------------------------------------------ */
/* Pure primitives (parity-guarded against the TS source)              */
/* ------------------------------------------------------------------ */

const TERMINAL_DEP_STATES = ["resolved", "refused"]

export function computeEnvelopeDigest(envelope, truthBindingRef) {
  return [
    `r=${envelope.resource}`,
    `c=${envelope.surfaceClass}`,
    `cap=${envelope.capability}`,
    `tb=${truthBindingRef}`,
  ].join("|")
}

function capabilityRankWithin(capability, ordered) {
  return ordered.indexOf(capability)
}

// The capability ladders that matter to a runtime projection. Kept minimal and parity-tested; the
// canonical source is lib/work-orders/authority-surface.ts.
const CAPABILITY_LADDERS = {
  runtime_control: ["none", "observe", "control"],
  runtime_config: ["none", "read", "propose", "write"],
  source: ["none", "read", "write"],
  delivery: ["none", "commit", "push", "pr", "merge", "release"],
  data: ["none", "read", "additive", "destructive"],
  secrets: ["none", "read", "write"],
  artifact: ["none", "read", "write"],
  external: ["none", "read", "act"],
}

function envelopeCovers(envelope, requiredClass, requiredCapability) {
  if (envelope.surfaceClass !== requiredClass) return false
  const ladder = CAPABILITY_LADDERS[requiredClass]
  if (!ladder) return false
  const have = capabilityRankWithin(envelope.capability, ladder)
  const need = capabilityRankWithin(requiredCapability, ladder)
  return have >= 0 && need >= 0 && have >= need
}

/**
 * Re-verify a projection against the LIVE dependency + envelope. Mirrors
 * verifyProjectionForExecution in lib/outcome-queue/dependency-projection.ts.
 */
export function verifyProjectionForExecution({ projection, liveDep, liveEnvelope, liveTruthBindingRef }) {
  if (liveDep.id !== projection.canonicalDependencyId) {
    return { ok: false, refusal: "DEPENDENCY_STATE_CHANGED", detail: "Projection points at a different dependency" }
  }
  if (TERMINAL_DEP_STATES.includes(liveDep.routingState)) {
    return { ok: false, refusal: "DEPENDENCY_TERMINAL", detail: `Dependency ${liveDep.id} is ${liveDep.routingState}` }
  }
  const liveDigest = computeEnvelopeDigest(liveEnvelope, liveTruthBindingRef)
  if (liveDigest !== projection.envelopeDigest) {
    return { ok: false, refusal: "ENVELOPE_DRIFT", detail: "Envelope or truth binding changed since projection" }
  }
  if (
    liveDep.requiredClass == null ||
    liveDep.requiredCapability == null ||
    !envelopeCovers(liveEnvelope, liveDep.requiredClass, liveDep.requiredCapability)
  ) {
    return {
      ok: false,
      refusal: "ENVELOPE_INSUFFICIENT",
      detail: `Envelope does not authorize ${liveDep.requiredClass}:${liveDep.requiredCapability}`,
    }
  }
  return { ok: true }
}

export const SETTLEMENT_METHOD = "projection_executor"

/**
 * Build the structured settlement receipt. Mirrors buildSettlementReceipt in
 * lib/outcome-queue/dependency-projection.ts (parity-tested). The fence is carried from the real
 * leased execution; a manual settlement cannot produce it without forging a matching live lease.
 */
export function buildSettlementReceipt({ dependencyId, fence, routingState, evidence }) {
  return {
    canonicalDependencyId: dependencyId,
    projectionQueueItemId: fence.projectionQueueItemId,
    queueTerminalKey: fence.queueTerminalKey ?? null,
    leaseHolder: fence.leaseHolder,
    fencingToken: fence.fencingToken,
    executionBinding: fence.executionBinding,
    settlementMethod: SETTLEMENT_METHOD,
    routingState,
    bindW1RuntimeBound: evidence.bindW1RuntimeBound,
    observedProjectId: evidence.observedProjectId ?? null,
    observedRevision: evidence.observedRevision ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Subject resolution — the executor boundary branch                   */
/* ------------------------------------------------------------------ */

/**
 * Decide what an acquired queue item actually is, and for a projection, verify it against live
 * canonical state AFTER the lease is held.
 *
 * @param queueItem the acquired outcome_queue_item row (must include canonicalDependencyId + envelope*)
 * @param deps.loadDependencyContext async (dependencyId) => { dep, envelope, truthBindingRef } | null
 * @returns { kind: "goal" }
 *        | { kind: "dependency", ok: true, dependencyId, workOrderId, envelope }
 *        | { kind: "dependency", ok: false, refusal, detail }
 */
export async function resolveExecutionSubject(queueItem, deps) {
  const depId = queueItem?.canonicalDependencyId ?? null
  if (depId == null) {
    // Ordinary goal outcome. The executor keeps using its existing resolveGoal/loadLinkedGoal path.
    return { kind: "goal" }
  }

  const context = await deps.loadDependencyContext(depId)
  if (!context || !context.dep) {
    return { kind: "dependency", ok: false, refusal: "DEPENDENCY_TERMINAL", detail: "Canonical dependency is gone" }
  }

  const verdict = verifyProjectionForExecution({
    projection: {
      canonicalDependencyId: depId,
      envelopeResource: queueItem.envelopeResource,
      envelopeClass: queueItem.envelopeClass,
      envelopeCapability: queueItem.envelopeCapability,
      envelopeDigest: queueItem.envelopeDigest,
    },
    liveDep: context.dep,
    liveEnvelope: context.envelope,
    liveTruthBindingRef: context.truthBindingRef,
  })

  if (!verdict.ok) {
    return { kind: "dependency", ok: false, refusal: verdict.refusal, detail: verdict.detail }
  }
  return {
    kind: "dependency",
    ok: true,
    dependencyId: depId,
    workOrderId: context.dep.workOrderId,
    envelope: context.envelope,
  }
}

/* ------------------------------------------------------------------ */
/* Completion — branch by subject kind, settle before terminalize      */
/* ------------------------------------------------------------------ */

/**
 * Complete an execution by subject kind.
 *
 *  goal       -> delegate to the existing completion path, untouched.
 *  dependency -> settle the CANONICAL dependency FIRST; only after successful settlement terminalize
 *                the queue projection so the lease releases. If settlement fails (binding/envelope
 *                changed under it), FAIL CLOSED: preserve evidence, release the projection with a
 *                typed settlement failure, and leave the dependency unresolved for recomputation.
 *                Queue completion means transport finished -- never that W1 / WO 55 passed.
 */
export async function completeExecutionSubject({ subject, evidence, queueResult }, ops) {
  if (subject.kind === "goal") {
    return { kind: "goal", completed: await ops.completeGoal() }
  }
  if (!subject.ok) {
    // A refused subject never runs; release the projection with the refusal, dependency untouched.
    await ops.releaseProjection({ reason: subject.refusal })
    return { kind: "dependency", executed: false, refusal: subject.refusal }
  }

  let settlement
  try {
    settlement = await ops.settleDependency({
      dependencyId: subject.dependencyId,
      queueResult,
      evidence,
      // The fence + structured acceptance evidence become the forge-resistant receipt. Without a
      // real leased fence, settlement cannot produce a valid receipt.
      fence: ops.fence,
      settlementEvidence: ops.settlementEvidence,
    })
  } catch (error) {
    // Settlement failed AFTER the work ran. Do not pretend the graph advanced.
    await ops.releaseProjection({ reason: "SETTLEMENT_FAILED", evidence, error: String(error?.message ?? error) })
    return { kind: "dependency", executed: true, settled: false, refusal: "SETTLEMENT_FAILED" }
  }

  // Canonical dependency settled. Now release the transport lease by terminalizing the projection.
  await ops.terminalizeProjection({ result: queueResult, evidence })
  return {
    kind: "dependency",
    executed: true,
    settled: true,
    dependencyId: subject.dependencyId,
    routingState: settlement.routingState,
    // The dependency advanced; the parent recomputes. The queue item completing did NOT pass W1.
    parentWorkOrderId: settlement.parentWorkOrderId,
    settlesParent: false,
  }
}
