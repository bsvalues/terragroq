/**
 * `@/lib/session`, for a process that has no HTTP request and must not invent one.
 *
 * THIS IS THE ONE HONEST GAP AND IT IS NAMED RATHER THAN HIDDEN. The real `getUserId()` reads
 * `next/headers`, resolves a browser session through `lib/auth`, and falls back to a device session
 * cookie. None of those exist here. The alternatives were:
 *
 *   - fabricate a session row so the real code path "succeeds" -- which is minting an authentication
 *     artifact to satisfy an authentication check, the same class of act as minting a grant to
 *     satisfy an authority check, and refused for the same reason;
 *   - widen the lookup to no user at all -- which is how "unable to scope" becomes "scoped to
 *     everyone";
 *   - name the actor, apply it exactly where the session would have supplied it, and record the
 *     naming as an ASSERTION rather than an authentication.
 *
 * The third is what happens here, and it is the same boundary `RS-00-settle-stamp-identity.mjs`
 * already draws for the READ side (`--actor`, `AUTHORITY_UNVERIFIABLE_NO_ACTOR`). Nothing else in
 * `app/actions/authority.ts` is substituted: ref allocation under the advisory lock, the content
 * hash, the `AUTHORITY_GRANTED` governance event, the authority register event and the Tier-2
 * artifact ledger export are all the canonical module's own unmodified code.
 *
 * Unnamed refuses. An actor this process cannot name is not a reason to act on behalf of everyone.
 */
const NAMED_ACTOR = (process.env.WILLIAMOS_GRANT_ACTOR_USER_ID ?? "").trim()

export const actorIdentification = NAMED_ACTOR ? "ASSERTED_BY_OPERATOR_NOT_AUTHENTICATED" : "NONE"

export async function getUserId() {
  if (!NAMED_ACTOR) {
    throw new Error(
      "ACTOR_UNNAMED: this process has no session and was given no actor, so the operator whose "
      + "registry is written cannot be identified. Refusing rather than defaulting to one.",
    )
  }
  return NAMED_ACTOR
}

export async function getSession() {
  throw new Error(
    "SESSION_SHELL_NOT_EXECUTABLE: there is no request context here and no session will be "
    + "fabricated to pretend otherwise. Callers that need a session must run inside the runtime.",
  )
}
