/**
 * Who the owner is, in one place.
 *
 * The authority model says approval is not authority and that a grant must be owner-recorded. That
 * only holds if "the owner" is a fact the server can establish. It was not: the workroom authority
 * route minted its standing grant for whoever happened to be signed in, so any account could issue
 * itself write authority and then satisfy the work-context gate with the grant it had just created.
 * A chain that bottoms out in self-service is not a chain.
 *
 * The rules are the ones already used to resolve the operator for a device certificate: an explicitly
 * configured owner wins, and failing that the single account that can actually sign in is the owner.
 * Ambiguity resolves to nobody -- guessing which of several accounts holds authority is the failure
 * this is here to prevent.
 */

export interface OwnerLookup {
  /** The user id for a configured owner address, or null. */
  byEmail(email: string): Promise<string | null>
  /** The only account holding a usable credential, or null when there is not exactly one. */
  soleCredentialed(): Promise<string | null>
}

export interface OwnerVerdict {
  ok: boolean
  failure?: "OWNER_UNRESOLVED" | "NOT_OWNER"
  detail?: string
}

export async function resolveOwnerUserId(lookup: OwnerLookup, configuredEmail?: string): Promise<string | null> {
  const configured = configuredEmail?.trim().toLowerCase()
  if (configured) {
    const byEmail = await lookup.byEmail(configured)
    if (byEmail) return byEmail
  }
  return await lookup.soleCredentialed()
}

/**
 * Decide whether this caller is the owner.
 *
 * An unresolved owner refuses rather than falling through to the caller. The alternative -- treating
 * "we could not tell" as "you must be him" -- is exactly how the route behaved before.
 */
export function assertOwner(userId: string, ownerId: string | null): OwnerVerdict {
  if (!ownerId) {
    return {
      ok: false,
      failure: "OWNER_UNRESOLVED",
      detail: "no owner could be established; set WILLIAMOS_OWNER_EMAIL to the owner's address",
    }
  }
  if (userId !== ownerId) {
    return { ok: false, failure: "NOT_OWNER", detail: "only the owner may record authority" }
  }
  return { ok: true }
}
