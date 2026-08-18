import { hashRecord } from "@/lib/governance/hash"

/**
 * The pre-execution gate: an agent does not get to mutate until it proves it understands the job.
 *
 * The rules this enforces were already written down and already active. What kept failing is that
 * they were advisory: an agent reads a prompt, infers the rest from memory or a stale branch, and
 * starts editing. Prose loses to convenience every time, so the premise becomes a token that the
 * mutation path checks rather than a paragraph the agent is trusted to have read.
 *
 * The receipt is DERIVED, not stored. It is a hash over the facts that were proven, so verification
 * recomputes those facts live and compares. That makes staleness automatic rather than a background
 * job: the moment origin/main moves or the Work Order changes, every previously issued receipt stops
 * matching, and the next consequential effect must revalidate. Nothing has to remember to expire it.
 *
 * This deliberately reuses the existing primitives -- `hashRecord` from lib/governance/hash.ts,
 * and the authority checks in `lib/governance/authority.ts` -- rather than introducing a parallel
 * mechanism, because a second way to express authority is how two sources of truth get created.
 */

export const WORK_CONTEXT_RECEIPT_VERSION = "work-context-receipt.v1" as const

/** Facts the lane must prove before its first mutation. Every field is required. */
export interface WorkContextFacts {
  /** Exact current origin/main SHA, fetched — not remembered. */
  mainSha: string
  /** The Work Order this lane is executing, and the outcome it serves. */
  workOrderRef: string
  parentOutcome: string
  /** Paths this lane reserved. A mutation outside them is a scope collision, not a judgement call. */
  reservedPaths: readonly string[]
  /** Authority envelope the Work Order carries. */
  authorityLevel: string
  /** Digest of the controlling instruction chain as read, so a doctrine change invalidates the receipt. */
  doctrineDigest: string
  /** Result of searching current main for an existing subsystem satisfying the requested behaviour. */
  existingSubsystem: "none-found" | "integrating" | "superseding"
  /** Where topology came from. Memory is not a source. */
  topologySource: "canonical-registry" | "live-probe"
  /** Overlapping branches/PRs found, if any. Non-empty means the lane must not proceed. */
  collisions: readonly string[]
  /** What of the parent outcome remains after this child settles. */
  remainingParentAcceptance: string
}

export type WorkContextFailure =
  | "FAILED_CONTEXT_NOT_PROVEN"
  | "FAILED_STALE_MAIN"
  | "FAILED_WORK_ORDER_NOT_READ"
  | "FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED"
  | "FAILED_SCOPE_COLLISION"
  | "FAILED_PREMATURE_HANDOFF"

export interface WorkContextVerdict {
  ok: boolean
  receipt?: string
  failure?: WorkContextFailure
  /** Which fact failed, so the lane can fix the premise instead of guessing. */
  detail?: string
}

const NON_EMPTY = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

/**
 * Issue a receipt for a set of proven facts, refusing to issue one when a premise is missing.
 *
 * Refusal is the point. A receipt that can be obtained by supplying blanks is a rubber stamp, and an
 * agent under time pressure will supply blanks.
 */
export function issueWorkContextReceipt(facts: WorkContextFacts): WorkContextVerdict {
  if (!NON_EMPTY(facts?.mainSha) || !/^[0-9a-f]{7,40}$/i.test(facts.mainSha.trim())) {
    return { ok: false, failure: "FAILED_STALE_MAIN", detail: "no current origin/main SHA was proven" }
  }
  if (!NON_EMPTY(facts.workOrderRef) || !NON_EMPTY(facts.parentOutcome) || !NON_EMPTY(facts.authorityLevel)) {
    return { ok: false, failure: "FAILED_WORK_ORDER_NOT_READ", detail: "work order, parent outcome or authority missing" }
  }
  if (!NON_EMPTY(facts.doctrineDigest)) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "controlling instruction chain not read" }
  }
  if (facts.existingSubsystem !== "none-found" && facts.existingSubsystem !== "integrating" && facts.existingSubsystem !== "superseding") {
    return { ok: false, failure: "FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED", detail: "no subsystem search recorded" }
  }
  if (facts.topologySource !== "canonical-registry" && facts.topologySource !== "live-probe") {
    // Remembering a node's address is exactly how the plane spent a week aiming at an empty one.
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "topology was not taken from a live or canonical source" }
  }
  if (!Array.isArray(facts.reservedPaths) || facts.reservedPaths.length === 0) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "no path reservation declared" }
  }
  if (Array.isArray(facts.collisions) && facts.collisions.length > 0) {
    return { ok: false, failure: "FAILED_SCOPE_COLLISION", detail: facts.collisions.join(", ") }
  }
  if (!NON_EMPTY(facts.remainingParentAcceptance)) {
    // A child that does not know what the parent still needs is a child that stops and asks.
    return { ok: false, failure: "FAILED_PREMATURE_HANDOFF", detail: "remaining parent acceptance not recorded" }
  }

  return { ok: true, receipt: receiptToken(facts) }
}

export function receiptToken(facts: WorkContextFacts): string {
  return hashRecord({
    contract: WORK_CONTEXT_RECEIPT_VERSION,
    mainSha: facts.mainSha.trim().toLowerCase(),
    workOrderRef: facts.workOrderRef.trim(),
    parentOutcome: facts.parentOutcome.trim(),
    authorityLevel: facts.authorityLevel.trim(),
    doctrineDigest: facts.doctrineDigest.trim(),
    existingSubsystem: facts.existingSubsystem,
    topologySource: facts.topologySource,
    // Order must not change the token: a reservation is a set, not a sequence.
    reservedPaths: [...facts.reservedPaths].map((p) => p.trim()).sort(),
    remainingParentAcceptance: facts.remainingParentAcceptance.trim(),
  })
}

/**
 * Check a presented receipt against the facts as they are NOW.
 *
 * The presented token is recomputed from live facts rather than looked up, so a receipt cannot
 * outlive the premise it was issued for. A moved main, an edited Work Order, or a changed doctrine
 * digest all produce a different token and therefore a refusal -- without anyone having to notice.
 */
export function verifyWorkContextReceipt(presented: unknown, live: WorkContextFacts): WorkContextVerdict {
  if (!NON_EMPTY(presented)) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "no work context receipt was presented" }
  }
  const issued = issueWorkContextReceipt(live)
  if (!issued.ok) return issued
  if (issued.receipt !== presented.trim()) {
    return {
      ok: false,
      failure: "FAILED_STALE_MAIN",
      detail: "the receipt does not match current truth; main, the work order, or doctrine has moved",
    }
  }
  return { ok: true, receipt: issued.receipt }
}

/**
 * Whether an operation needs a receipt at all.
 *
 * Reading is never gated. The gate exists to stop unproven MUTATION, and gating reads would push
 * agents toward working blind rather than toward proving context -- the opposite of the intent.
 */
export function requiresWorkContext(mutating: boolean): boolean {
  return mutating
}
