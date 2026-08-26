/**
 * The bridge from the canonical work graph to the live outcome-queue executor.
 *
 * `routed_dependency` is canonical work truth. It has no consumer of its own -- and it should not
 * grow one: the outcome queue already owns leasing, fencing, dependency ordering, lifecycle and
 * stale-lease recovery, and HERMES already runs that loop. So a routed dependency becomes executable
 * by PROJECTING it onto an `outcome_queue_item`, which the existing loop leases with its existing
 * machinery. No second executor.
 *
 * The hard rule is that authority is NOT translated. The queue contract carries a single
 * `authorityLevel` (A0-A9), and older selection paths reason in A0-A2 terms, so mapping
 * `runtime_control:control` onto, say, `A2_WRITE_OWN` would quietly destroy the resource-scoped
 * authority model. The core engine actually gates on `authorityState === 'matched'` and the grant
 * ref, never on `authorityLevel` -- so a projection can stay at the neutral A0 sentinel and carry
 * the real envelope (resource x class x capability) explicitly, in dedicated fields. At acquisition,
 * HERMES resolves the canonical dependency and re-verifies that exact envelope before executing.
 *
 * Pure. The DB actions in app/actions call these to build/verify/settle projections.
 */

import { envelopePermits, type EnvelopeEntry, type SurfaceClass } from "@/lib/work-orders/authority-surface"
import type { RoutingState } from "@/lib/work-orders/routed-dependency"

/** Dependency states a projection may be created for. A terminal dependency is never projected. */
export const PROJECTABLE_DEP_STATES: readonly RoutingState[] = ["raised", "routed", "accepted"]

/** Dependency states that make an existing projection ineligible to execute. */
export const TERMINAL_DEP_STATES: readonly RoutingState[] = ["resolved", "refused"]

/** The neutral authority level a projection carries. Deliberately least-privilege: no legacy
 *  A0-A2 path may over-authorize from it, because the real authority is the envelope below. */
export const NEUTRAL_AUTHORITY_LEVEL = "A0_READ_ONLY"

export interface DependencyEnvelope {
  resource: string
  surfaceClass: SurfaceClass
  capability: string
}

export interface ProjectableDependency {
  id: number
  workOrderId: number
  routingState: RoutingState
  operation: string
  requiredResource: string | null
  requiredClass: SurfaceClass | null
  requiredCapability: string | null
  blocksAcceptance: boolean
}

/* ------------------------------------------------------------------ */
/* Digest — binds a projection to the exact envelope + truth binding   */
/* ------------------------------------------------------------------ */

/**
 * A stable digest of the envelope granted plus the truth-binding reference it was verified against.
 * Recomputed at acquisition; a mismatch means the assignment, envelope, or truth binding changed
 * since projection, and execution must be refused rather than run against stale authority.
 */
export function computeEnvelopeDigest(
  envelope: DependencyEnvelope,
  truthBindingRef: string,
): string {
  const parts = [
    `r=${envelope.resource}`,
    `c=${envelope.surfaceClass}`,
    `cap=${envelope.capability}`,
    `tb=${truthBindingRef}`,
  ]
  return parts.join("|")
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export interface DependencyProjection {
  /** The canonical source. One live projection per dependency (enforced by a unique index). */
  canonicalDependencyId: number
  parentWorkOrderId: number
  outcomeKey: string
  title: string
  objective: string
  envelopeResource: string
  envelopeClass: SurfaceClass
  envelopeCapability: string
  envelopeDigest: string
  /** The real action, verbatim -- "runtime_control:control", never an A-level. */
  authorityAction: string
  authoritySubject: string
  authorityGrantRef: string
  authorityLevel: string
  authorityState: "matched"
  approvalState: "approved"
  riskClass: string
}

export function isDependencyProjectable(dep: ProjectableDependency): boolean {
  return (
    PROJECTABLE_DEP_STATES.includes(dep.routingState) &&
    dep.requiredClass != null &&
    dep.requiredCapability != null &&
    dep.requiredResource != null
  )
}

/**
 * Build the projection spec for a routed dependency. The caller persists it as an
 * `outcome_queue_item` with the canonical-source/envelope columns; the unique index guarantees one
 * live projection per dependency, so calling this twice cannot create two jobs.
 */
export function projectDependency(input: {
  dep: ProjectableDependency
  envelope: DependencyEnvelope
  truthBindingRef: string
  subject: string
  riskClass?: string
}): DependencyProjection {
  const { dep, envelope, truthBindingRef, subject } = input
  if (!isDependencyProjectable(dep)) {
    throw new Error(`Dependency ${dep.id} (${dep.routingState}) is not projectable`)
  }
  // The envelope must actually cover the operation, or projecting it would queue work the envelope
  // cannot authorize -- caught here rather than at acquisition.
  if (
    envelope.surfaceClass !== dep.requiredClass ||
    !capabilityCovers(envelope, dep.requiredClass!, dep.requiredCapability!)
  ) {
    throw new Error(
      `Envelope ${envelope.surfaceClass}:${envelope.capability} does not cover required ${dep.requiredClass}:${dep.requiredCapability}`,
    )
  }

  return {
    canonicalDependencyId: dep.id,
    parentWorkOrderId: dep.workOrderId,
    outcomeKey: `routed-dependency:${dep.id}`,
    title: `Execute routed dependency #${dep.id}`,
    objective: dep.operation,
    envelopeResource: envelope.resource,
    envelopeClass: envelope.surfaceClass,
    envelopeCapability: envelope.capability,
    envelopeDigest: computeEnvelopeDigest(envelope, truthBindingRef),
    authorityAction: `${envelope.surfaceClass}:${envelope.capability}`,
    authoritySubject: subject,
    authorityGrantRef: `envelope:routed_dependency:${dep.id}`,
    authorityLevel: NEUTRAL_AUTHORITY_LEVEL,
    authorityState: "matched",
    approvalState: "approved",
    riskClass: input.riskClass ?? "R1",
  }
}

function capabilityCovers(envelope: DependencyEnvelope, cls: SurfaceClass, capability: string): boolean {
  const grant: EnvelopeEntry = {
    resourceKey: envelope.resource,
    surfaceClass: envelope.surfaceClass,
    capability: envelope.capability,
  }
  const need: EnvelopeEntry = { resourceKey: envelope.resource, surfaceClass: cls, capability }
  return envelopePermits([grant], need)
}

/* ------------------------------------------------------------------ */
/* Verify at acquisition                                               */
/* ------------------------------------------------------------------ */

export type AcquisitionRefusal =
  | "DEPENDENCY_TERMINAL"
  | "DEPENDENCY_STATE_CHANGED"
  | "ENVELOPE_DRIFT"
  | "ENVELOPE_INSUFFICIENT"

export type AcquisitionVerdict = { ok: true } | { ok: false; refusal: AcquisitionRefusal; detail: string }

/**
 * Re-verify, at the moment HERMES is about to execute, that the projection still reflects the
 * canonical dependency and its envelope. This is where "no execution if the assignment/envelope/
 * truth binding changed" is enforced. No A-level is consulted.
 */
export function verifyProjectionForExecution(input: {
  projection: Pick<
    DependencyProjection,
    "canonicalDependencyId" | "envelopeResource" | "envelopeClass" | "envelopeCapability" | "envelopeDigest"
  >
  liveDep: Pick<ProjectableDependency, "id" | "routingState" | "requiredClass" | "requiredCapability" | "requiredResource">
  liveEnvelope: DependencyEnvelope
  liveTruthBindingRef: string
}): AcquisitionVerdict {
  const { projection, liveDep, liveEnvelope, liveTruthBindingRef } = input

  if (liveDep.id !== projection.canonicalDependencyId) {
    return { ok: false, refusal: "DEPENDENCY_STATE_CHANGED", detail: "Projection points at a different dependency" }
  }
  if (TERMINAL_DEP_STATES.includes(liveDep.routingState)) {
    return {
      ok: false,
      refusal: "DEPENDENCY_TERMINAL",
      detail: `Dependency ${liveDep.id} is ${liveDep.routingState}; nothing to execute`,
    }
  }

  const liveDigest = computeEnvelopeDigest(liveEnvelope, liveTruthBindingRef)
  if (liveDigest !== projection.envelopeDigest) {
    return {
      ok: false,
      refusal: "ENVELOPE_DRIFT",
      detail: "Envelope or truth binding changed since projection; refusing stale authority",
    }
  }

  // The live envelope must still grant the class/capability the dependency requires, over its
  // resource. Resource-scoped, no A-level inference.
  if (
    liveDep.requiredClass == null ||
    liveDep.requiredCapability == null ||
    !capabilityCovers(liveEnvelope, liveDep.requiredClass, liveDep.requiredCapability)
  ) {
    return {
      ok: false,
      refusal: "ENVELOPE_INSUFFICIENT",
      detail: `Envelope does not authorize ${liveDep.requiredClass}:${liveDep.requiredCapability}`,
    }
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Return path                                                         */
/* ------------------------------------------------------------------ */

/**
 * How a completed queue projection settles its canonical dependency.
 *
 * A completed queue item does NOT mean the parent outcome passed. It resolves (or refuses) the
 * DEPENDENCY; the parent work order then recomputes, and whether that unlocks the next edge is a
 * separate question the graph answers.
 */
export function dependencyResolutionFor(queueResult: string): {
  routingState: Extract<RoutingState, "resolved" | "refused">
  settlesParent: false
} {
  const passed = queueResult.trim().toUpperCase() === "PASS"
  return { routingState: passed ? "resolved" : "refused", settlesParent: false }
}
