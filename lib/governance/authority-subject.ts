/**
 * Who a grant was issued TO, resolved rather than assumed (#1015).
 *
 * THREE THINGS, NOT ONE. The registry conflated them, and the conflation is the defect:
 *
 *   owner authority namespace   -- `authority_grant.userId`. Which registry the grant lives in.
 *   acting authenticated identity -- `session.user.id`. Who is making this request.
 *   authority recipient subject -- who the grant was actually issued to.
 *
 * The work-context route read grants with `WHERE "userId" = session.user.id`, which silently asserts
 * that all three are the same principal. For the owner they are. For the synthetic operator (#872)
 * they are not, by construction: it is deliberately a distinct user so agent actions stay
 * attributable, while `record-authority-grant.mjs` records every grant in the OWNER's namespace so a
 * lane cannot grant itself authority. The result was an identity that can authenticate and can never
 * be covered -- `GRANT-0013` is active, `A3_WRITE_SHARED`, scoped to `WO-0027`, and `WO-0027` is
 * owned by the synthetic operator, yet no lookup could ever see the two together.
 *
 * WHY NOT JUST TRUST `grantedTo`. Because it is a label, and a label is a claim. `grantedTo` reads
 * "williamos" on one grant and "operator" on another; deciding that either of those strings means
 * this session would be guessing, and guessing upward into authority is the one direction that must
 * never be guessed. Nothing here maps a name to a principal.
 *
 * WHAT IS PROVED INSTEAD. A scoped grant names work. That work is a durable row with an owner. If
 * every work order the grant's scope names belongs to the acting identity, then the acting identity
 * IS the subject that grant was issued for -- established from provenance the owner already recorded,
 * not from a string either side could write. `grantedTo` is carried through to the receipt as the
 * declared label so the binding stays auditable, and is never the deciding fact.
 *
 * FAIL CLOSED EVERYWHERE. An unscoped grant in someone else's namespace proves nothing about this
 * session and is refused. A scope naming work this session does not own is refused. A scope naming
 * work whose owner cannot be read is refused -- an unreadable premise is not a satisfied one, the
 * same reading the receipt ledger already applies to itself.
 */

/** Work-order refs are the only scope token whose ownership is a durable, checkable fact. */
const WORK_ORDER_REF = /\bWO-[A-Za-z0-9][A-Za-z0-9-]*\b/g

export type AuthoritySubjectFailure =
  | "SUBJECT_NAMESPACE_NOT_OWNER"
  | "SUBJECT_UNSCOPED_DELEGATION"
  | "SUBJECT_SCOPE_UNRESOLVED"
  | "SUBJECT_NOT_RECIPIENT"

export type AuthoritySubjectBasis = "SELF_NAMESPACE" | "PROVEN_DELEGATION"

export interface AuthoritySubjectGrant {
  ref: string | null
  /** The authority namespace the grant lives in. NOT "the user who may use it". */
  userId: string | null
  /** The declared recipient label. Auditable, never decisive. */
  grantedTo?: string | null
  scope?: string | null
}

export interface AuthoritySubjectInputs {
  grant: AuthoritySubjectGrant
  actingUserId: string
  ownerUserId: string | null
  /** Work-order ref -> the user id that owns it. Absent means unreadable, which fails closed. */
  scopeWorkOrderOwners: ReadonlyMap<string, string>
}

export type AuthoritySubjectBinding =
  | {
      ok: true
      basis: AuthoritySubjectBasis
      declaredSubject: string | null
      provenance: readonly string[]
      detail: string
    }
  | { ok: false; failure: AuthoritySubjectFailure; detail: string }

/** Every work-order ref a scope names, de-duplicated and order-independent. */
export function workOrderRefsInScope(scope: string | null | undefined): string[] {
  if (typeof scope !== "string") return []
  return [...new Set(scope.match(WORK_ORDER_REF) ?? [])]
}

/**
 * Decide whether `actingUserId` is the subject this grant was issued for.
 *
 * Returns a basis rather than a bare boolean so the receipt can record HOW the binding was
 * established. "It passed" is not evidence; "it passed because WO-0027 is owned by this session" is.
 */
export function bindAuthoritySubject(input: AuthoritySubjectInputs): AuthoritySubjectBinding {
  const { grant, actingUserId, ownerUserId, scopeWorkOrderOwners } = input
  const label = grant.ref ?? "an unnamed grant"
  const declaredSubject = typeof grant.grantedTo === "string" && grant.grantedTo.trim() !== ""
    ? grant.grantedTo.trim()
    : null

  // The ordinary case, and the one #872 intended: a grant recorded against this very identity.
  // The owner's own session reaches authority this way and must keep doing so.
  if (grant.userId && grant.userId === actingUserId) {
    return {
      ok: true,
      basis: "SELF_NAMESPACE",
      declaredSubject,
      provenance: [],
      detail: `${label} is recorded in this session's own authority namespace`,
    }
  }

  // Anything else is a delegation out of another namespace, and only the governed owner's namespace
  // may delegate. Without this, any user could create a grant and hand it to themselves.
  if (!ownerUserId) {
    return {
      ok: false,
      failure: "SUBJECT_NAMESPACE_NOT_OWNER",
      detail: `the governed owner could not be resolved, so ${label} cannot be read as a delegation`,
    }
  }
  if (grant.userId !== ownerUserId) {
    return {
      ok: false,
      failure: "SUBJECT_NAMESPACE_NOT_OWNER",
      detail: `${label} lives in a namespace that is neither this session's nor the governed owner's`,
    }
  }

  const refs = workOrderRefsInScope(grant.scope)
  if (refs.length === 0) {
    // A general grant in the owner's namespace is the owner's general authority. It names no work,
    // so it carries no evidence about who else it was meant for.
    return {
      ok: false,
      failure: "SUBJECT_UNSCOPED_DELEGATION",
      detail: `${label} names no work order, so there is no provenance binding it to this session`,
    }
  }

  const unresolved = refs.filter((ref) => !scopeWorkOrderOwners.has(ref))
  if (unresolved.length > 0) {
    return {
      ok: false,
      failure: "SUBJECT_SCOPE_UNRESOLVED",
      detail: `the owner of ${unresolved.join(", ")} could not be read, so ${label} cannot be bound`,
    }
  }

  // ALL of them, not some. A scope spanning two subjects binds to neither: partial ownership would
  // let a session inherit authority over work belonging to somebody else.
  const foreign = refs.filter((ref) => scopeWorkOrderOwners.get(ref) !== actingUserId)
  if (foreign.length > 0) {
    return {
      ok: false,
      failure: "SUBJECT_NOT_RECIPIENT",
      detail: `${label} is scoped to ${foreign.join(", ")}, which this session does not own`
        + (declaredSubject ? ` (declared recipient "${declaredSubject}")` : ""),
    }
  }

  return {
    ok: true,
    basis: "PROVEN_DELEGATION",
    declaredSubject,
    provenance: refs,
    detail: `${label} is scoped to ${refs.join(", ")}, owned by this session`,
  }
}
