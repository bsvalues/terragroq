import { hashRecord } from "@/lib/governance/hash"
import { AUTHORITY_LEVELS } from "@/lib/goal/taxonomy"

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
  /** The token was not issued for the facts presented alongside it -- a different failure from staleness. */
  | "FAILED_RECEIPT_MISMATCH"
  | "FAILED_WORK_ORDER_NOT_READ"
  | "FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED"
  | "FAILED_SCOPE_COLLISION"
  | "FAILED_PREMATURE_HANDOFF"
  | "FAILED_AUTHORITY_NOT_GRANTED"

/**
 * The measured values a receipt was issued against, when the caller holds them.
 *
 * The ledger path does not need this: it looks the facts up by token, so anything that fails to match
 * is drift by construction. A caller that carries the lane's own claims alongside the token -- the
 * Claude Code PreToolUse hook -- can supply it and get the two causes told apart.
 */
export interface IssuedAgainst {
  mainSha?: string
  doctrineDigest?: string
}

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
export function verifyWorkContextReceipt(
  presented: unknown,
  live: WorkContextFacts,
  issuedAgainst?: IssuedAgainst,
): WorkContextVerdict {
  if (!NON_EMPTY(presented)) {
    return { ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "no work context receipt was presented" }
  }
  const issued = issueWorkContextReceipt(live)
  if (!issued.ok) return issued
  const token = presented.trim()
  if (issued.receipt === token) return { ok: true, receipt: issued.receipt }

  // A mismatch has two very different causes with two very different remedies, and reporting both as
  // "main has moved" sent a tampered receipt to the wrong fix. When the caller can say what the
  // receipt was issued against, re-derive with those measured values: if the token comes back, the
  // lane's claims are intact and only measured truth moved. If it still does not, the token was never
  // issued for these claims.
  if (issuedAgainst?.mainSha || issuedAgainst?.doctrineDigest) {
    const asIssued = receiptToken({
      ...live,
      mainSha: issuedAgainst.mainSha ?? live.mainSha,
      doctrineDigest: issuedAgainst.doctrineDigest ?? live.doctrineDigest,
    })
    if (asIssued === token) {
      return { ok: false, failure: "FAILED_STALE_MAIN", detail: describeDrift(live, issuedAgainst) }
    }
    return {
      ok: false,
      failure: "FAILED_RECEIPT_MISMATCH",
      detail: "the receipt was not issued for these facts; re-establish context rather than editing the claim",
    }
  }

  // No issuance context available. The ledger path stores the facts itself, so a mismatch there can
  // only mean measured truth moved.
  return {
    ok: false,
    failure: "FAILED_STALE_MAIN",
    detail: "the receipt does not match current truth; main, the work order, or doctrine has moved",
  }
}

const short = (sha: string) => sha.trim().slice(0, 10)

/** Name what actually drifted, so the lane re-establishes knowing why rather than guessing. */
function describeDrift(live: WorkContextFacts, issuedAgainst: IssuedAgainst): string {
  const moved: string[] = []
  if (issuedAgainst.mainSha && issuedAgainst.mainSha.trim().toLowerCase() !== live.mainSha.trim().toLowerCase()) {
    moved.push(`main moved ${short(issuedAgainst.mainSha)} -> ${short(live.mainSha)}`)
  }
  if (issuedAgainst.doctrineDigest && issuedAgainst.doctrineDigest.trim() !== live.doctrineDigest.trim()) {
    moved.push("the controlling doctrine changed")
  }
  return moved.length > 0
    ? `${moved.join("; ")}; re-establish context`
    : "the receipt is stale against current truth; re-establish context"
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

/**
 * Prove the authority the lane claims is one somebody actually granted it.
 *
 * Until now the receipt took `authorityLevel` as a claim, which made it decoration: a lane could
 * write "A4_RELEASE" into its own premise and the gate would hash it approvingly. The doctrine this
 * repository already states is the opposite -- approval is not authority, and nothing may act above
 * A0 unless a durable grant record exists that is active and covers the level. So the claim is now
 * checked against grant rows.
 *
 * Scope is enforced when the grant declares one. A grant issued for one outcome must not silently
 * cover a different piece of work: that is how a narrow permission becomes a general one.
 *
 * The grant checks themselves are NOT reimplemented here -- `grantCovers` already encodes revocation,
 * expiry, rank and blocked actions, and a second copy of that logic would eventually disagree with
 * the first.
 */
export function assertAuthorityGranted(
  claimed: string,
  scopeKeys: readonly string[],
  grants: readonly AuthorityGrantLike[],
  covers: (grant: AuthorityGrantLike, required: string) => { ok: boolean; reason: string },
): WorkContextVerdict {
  if (!NON_EMPTY(claimed)) {
    return { ok: false, failure: "FAILED_WORK_ORDER_NOT_READ", detail: "no authority level claimed" }
  }
  // An unknown level must not be treated as a low one. authorityRank() returns 0 for any id it does
  // not recognise, so grantCovers compares 0 against the grant's rank and reports "covered" -- which
  // means a lane claiming "A9_ROOT" or "NONSENSE" sails through while a lane claiming the real
  // "A9_RELEASE" is correctly refused. The claim is checked against the taxonomy first so a
  // misspelling fails closed instead of becoming a free pass.
  if (!AUTHORITY_LEVELS.some((level) => level.id === claimed.trim())) {
    return {
      ok: false,
      failure: "FAILED_AUTHORITY_NOT_GRANTED",
      detail: `"${claimed.trim()}" is not a defined authority level`,
    }
  }
  if (!Array.isArray(grants) || grants.length === 0) {
    return {
      ok: false,
      failure: "FAILED_AUTHORITY_NOT_GRANTED",
      detail: `no authority grant exists covering ${claimed}`,
    }
  }

  const reasons: string[] = []
  for (const grant of grants) {
    const verdict = covers(grant, claimed)
    if (!verdict.ok) {
      reasons.push(verdict.reason)
      continue
    }
    // An unscoped grant is general by construction. A scoped one must name this work.
    const scope = typeof grant.scope === "string" ? grant.scope.trim() : ""
    if (scope && !scopeKeys.some((key) => NON_EMPTY(key) && scope.includes(key.trim()))) {
      reasons.push(`grant scope "${scope}" does not cover ${scopeKeys.filter(Boolean).join(" or ")}`)
      continue
    }
    return { ok: true }
  }

  return {
    ok: false,
    failure: "FAILED_AUTHORITY_NOT_GRANTED",
    // The reasons matter: "expired", "wrong scope" and "rank too low" are three different fixes.
    detail: reasons.slice(0, 3).join("; ") || `no active grant covers ${claimed}`,
  }
}

/** The parts of a grant this check reads. Kept structural so tests need no database. */
export interface AuthorityGrantLike {
  scope?: string | null
  authorityLevel: string
  status: string
}
