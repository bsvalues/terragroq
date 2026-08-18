/**
 * The synthetic operator: an identity a frontier agent can hold, distinct from the owner.
 *
 * #871 failed before its first boundary because a non-human operator could not authenticate at all.
 * Every door was human-mediated -- a browser session, a client certificate issued to a physical device,
 * or a one-time code that itself required an existing session -- so the only door that opened for an
 * agent was a shell, and every agent walked through it and became the orchestrator.
 *
 * What is deliberately NOT built here: roles, policy languages, federation, a credential console, or
 * anything resembling a service-account subsystem. #872 needs exactly four properties, and the existing
 * device-credential machinery already provides three of them:
 *
 *   who is acting        -- a distinct user row, never the owner's
 *   what authority       -- ordinary authority_grant rows against that user id
 *   revocation / expiry  -- device_credential.revokedAt and device_session.expiresAt
 *   an authenticated session -- getSession() already accepts a device session cookie
 *
 * So the only thing missing was an identity to bind a credential to. That is all this adds.
 */

/** Non-routable by construction: this identity must never receive mail or be signed into by a human. */
export const SYNTHETIC_OPERATOR_EMAIL = "synthetic-operator@williamos.invalid"
export const SYNTHETIC_OPERATOR_NAME = "WilliamOS synthetic operator"

export interface OperatorIdentityVerdict {
  ok: boolean
  failure?: "OPERATOR_IS_OWNER" | "OPERATOR_UNRESOLVED"
  detail?: string
}

/**
 * Refuse an operator identity that is the owner.
 *
 * Reusing the owner's identity would make every agent action indistinguishable from William's in the
 * audit trail, which defeats both the authority model and the owner-only rule in #860. "Who did it"
 * has to survive this change, so the check is explicit rather than assumed from a different email.
 */
export function assertOperatorDistinctFromOwner(
  operatorUserId: string | null,
  ownerUserId: string | null,
): OperatorIdentityVerdict {
  if (!operatorUserId) {
    return { ok: false, failure: "OPERATOR_UNRESOLVED", detail: "no synthetic operator identity exists yet" }
  }
  if (ownerUserId && operatorUserId === ownerUserId) {
    return {
      ok: false,
      failure: "OPERATOR_IS_OWNER",
      detail: "the synthetic operator resolved to the owner; agent actions would be unattributable",
    }
  }
  return { ok: true }
}

/** Normalised comparison, so a case or whitespace difference cannot mint a second operator. */
export function isSyntheticOperatorEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SYNTHETIC_OPERATOR_EMAIL
}
