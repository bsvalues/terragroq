// WO-011 — Authority Grant Registry (pure logic).
//
// Doctrine: approval is NOT authority. A work order may be "approved" for a
// posture, but no loop or transition may ACT above A0 unless a durable
// AuthorityGrant record exists that is active (not revoked, not expired) and
// covers the required authority level and action. This module holds the pure,
// deterministic checks so they are reproducible and unit-testable.

import { isAuthorityId, providedAuthorityRank, requiredAuthorityRank, type AuthorityId } from "@/lib/goal/taxonomy"
import type { AuthorityGrant } from "@/lib/db/schema"
import { fromUtcWallDriver } from "@/lib/db/utc-wall-timestamp"

export interface GrantCheck {
  ok: boolean
  reason: string
}

/**
 * What these checks actually read off a grant. Stated as a type rather than left implicit because the
 * governed routes select a SUBSET of `authority_grant`'s columns through the raw `pg` pool and then
 * cast the row -- and a cast is not a check. Naming the contract is what lets a partial row be passed
 * honestly instead of with `as never`.
 */
export interface AuthorityGrantFacts {
  id: number
  ref: string | null
  status: string
  authorityLevel: string
  allowedActions: string[]
  blockedActions: string[]
  expiresAt: Date | null
  revokedAt?: Date | null
  revokeReason?: string | null
  /**
   * The authority NAMESPACE this grant lives in, and the recipient it was issued to. Absent from
   * this contract until #1015, which is how the registry came to conflate namespace, acting identity
   * and recipient: what a check cannot see, it cannot distinguish. `grantCovers` deliberately still
   * ignores both -- coverage is about lifecycle, level and action. Binding a grant to a subject is
   * `bindAuthoritySubject`'s job, and keeping the two separate is what stops "covered" from quietly
   * meaning "covered for anyone".
   */
  userId?: string | null
  grantedTo?: string | null
}

/**
 * Read a raw `pg` row of `authority_grant` with the SAME semantics `lib/db/schema.ts` gives a drizzle
 * read of it. Every raw reader of this table must come through here.
 *
 * Two things a raw row gets wrong on its own, both of which widen authority rather than narrow it:
 *
 *   `expiresAt`/`revokedAt` are UTC wall clocks that node-pg parses as local time, so west of UTC a
 *   bounded grant outlives its bound -- two hours honoured as nine on HERMES
 *   (`CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW`).
 *
 *   `allowedActions`/`blockedActions` arrive `null` where drizzle guarantees `[]`, and a `null`
 *   blocked-list throws inside `grantCovers` -- which the stamp-identity route would have caught and
 *   turned into `AUTHORITY_UNREADABLE`, but the work-context route would not.
 *
 * An unreadable timestamp THROWS rather than degrading to `null`. A dropped bound is not a missing
 * bound: it is an unbounded grant, which is the one outcome this registry exists to prevent.
 */
export function authorityGrantFactsFromRow(row: Record<string, unknown>): AuthorityGrantFacts {
  const instant = (value: unknown): Date | null =>
    value === null || value === undefined ? null : fromUtcWallDriver(value as string | Date)
  const actions = (value: unknown): string[] =>
    Array.isArray(value) ? (value as string[]) : []

  return {
    id: Number(row.id),
    ref: (row.ref as string | null) ?? null,
    status: String(row.status),
    authorityLevel: String(row.authorityLevel),
    allowedActions: actions(row.allowedActions),
    blockedActions: actions(row.blockedActions),
    expiresAt: instant(row.expiresAt),
    revokedAt: instant(row.revokedAt),
    revokeReason: (row.revokeReason as string | null) ?? null,
    userId: (row.userId as string | null) ?? null,
    grantedTo: (row.grantedTo as string | null) ?? null,
  }
}

// Is the grant currently live? Considers explicit status and time-based expiry.
export function isGrantActive(grant: AuthorityGrantFacts, now: Date = new Date()): GrantCheck {
  if (grant.status === "revoked") {
    return { ok: false, reason: `Grant ${grant.ref ?? `#${grant.id}`} was revoked${grant.revokeReason ? `: ${grant.revokeReason}` : ""}` }
  }
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: `Grant ${grant.ref ?? `#${grant.id}`} expired at ${grant.expiresAt.toISOString()}` }
  }
  if (grant.status !== "active") {
    return { ok: false, reason: `Grant ${grant.ref ?? `#${grant.id}`} status is "${grant.status}"` }
  }
  return { ok: true, reason: "active" }
}

// Does this grant cover the required authority level (and optional action)?
export function grantCovers(
  grant: AuthorityGrantFacts,
  requiredAuthority: AuthorityId,
  action?: string,
): GrantCheck {
  const live = isGrantActive(grant)
  if (!live.ok) return live

  // Directional ranking: an undefined REQUIRED level outranks everything so nothing covers it, and an
  // undefined GRANTED level provides nothing. Using the raw rank here meant a misspelled requirement
  // ranked 0 and every grant "covered" it.
  if (!isAuthorityId(requiredAuthority)) {
    return { ok: false, reason: `"${requiredAuthority}" is not a defined authority level` }
  }
  if (!isAuthorityId(grant.authorityLevel)) {
    return { ok: false, reason: `Grant ${grant.ref ?? `#${grant.id}`} declares undefined authority "${grant.authorityLevel}"` }
  }
  if (requiredAuthorityRank(requiredAuthority) > providedAuthorityRank(grant.authorityLevel)) {
    return {
      ok: false,
      reason: `Grant provides ${grant.authorityLevel} but ${requiredAuthority} is required`,
    }
  }

  if (action) {
    const lc = action.toLowerCase()
    const blocked = grant.blockedActions.find((b) => b && lc.includes(b.toLowerCase()))
    if (blocked) {
      return { ok: false, reason: `Action "${action}" is explicitly blocked by grant ${grant.ref ?? `#${grant.id}`}` }
    }
    if (grant.allowedActions.length > 0) {
      const permitted = grant.allowedActions.some((a) => a && lc.includes(a.toLowerCase()))
      if (!permitted) {
        return { ok: false, reason: `Action "${action}" is not within the grant's allowed actions` }
      }
    }
  }

  return { ok: true, reason: "covered" }
}

// Pick the strongest currently-active grant for a target from a candidate set.
export function strongestActiveGrant(grants: AuthorityGrant[], now: Date = new Date()): AuthorityGrant | null {
  const active = grants.filter((g) => isGrantActive(g, now).ok)
  if (active.length === 0) return null
  return active.reduce((best, g) =>
    // provided-rank: a grant declaring an undefined level ranks below every real one rather than
    // being picked as the strongest.
    providedAuthorityRank(g.authorityLevel) > providedAuthorityRank(best.authorityLevel) ? g : best,
  )
}
