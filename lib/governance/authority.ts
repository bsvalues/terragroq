// WO-011 — Authority Grant Registry (pure logic).
//
// Doctrine: approval is NOT authority. A work order may be "approved" for a
// posture, but no loop or transition may ACT above A0 unless a durable
// AuthorityGrant record exists that is active (not revoked, not expired) and
// covers the required authority level and action. This module holds the pure,
// deterministic checks so they are reproducible and unit-testable.

import { authorityRank, type AuthorityId } from "@/lib/goal/taxonomy"
import type { AuthorityGrant } from "@/lib/db/schema"

export interface GrantCheck {
  ok: boolean
  reason: string
}

// Is the grant currently live? Considers explicit status and time-based expiry.
export function isGrantActive(grant: AuthorityGrant, now: Date = new Date()): GrantCheck {
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
  grant: AuthorityGrant,
  requiredAuthority: AuthorityId,
  action?: string,
): GrantCheck {
  const live = isGrantActive(grant)
  if (!live.ok) return live

  if (authorityRank(requiredAuthority) > authorityRank(grant.authorityLevel)) {
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
    authorityRank(g.authorityLevel) > authorityRank(best.authorityLevel) ? g : best,
  )
}
