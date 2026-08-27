/**
 * Authority has three principals, and conflating any two of them widens it (#1015).
 *
 *   owner authority namespace   -- `authority_grant.userId`
 *   acting authenticated identity -- `session.user.id`
 *   authority recipient subject -- who the grant was issued to
 *
 * The work-context route read `authority_grant WHERE "userId" = session.user.id`, which asserts all
 * three are one principal. For the owner they are. For the synthetic operator (#872) they are not --
 * it is deliberately a distinct user, while `record-authority-grant.mjs` records every grant in the
 * OWNER's namespace so no lane can grant itself authority. So the identity built to make agent action
 * attributable could authenticate and could never be covered.
 *
 * The fixtures below are the real arrangement, not invented shapes: `GRANT-0013` is active,
 * `A3_WRITE_SHARED`, `grantedTo: "williamos"`, scoped to `WO-0027`, attributed to the owner -- and
 * `WO-0027` is owned by the synthetic operator. It is the positive case ONLY because that ownership
 * proves the recipient. Every neighbouring shape must still be refused.
 */
import { describe, expect, it } from "vitest"

import { bindAuthoritySubject, workOrderRefsInScope } from "@/lib/governance/authority-subject"
import { authorityGrantFactsFromRow, grantCovers } from "@/lib/governance/authority"

const OWNER = "owner-user-id"
const OPERATOR = "ab9045ac-0a98-428a-9bd8-d49a84bcd9dc"
const CODEX = "codex-lane-user-id"
const STRANGER = "some-other-user-id"

/** GRANT-0013 as it actually exists on ATLAS. */
const GRANT_0013 = {
  ref: "GRANT-0013",
  userId: OWNER,
  grantedTo: "williamos",
  scope: "WO-0027",
}

const ownedByOperator = new Map([["WO-0027", OPERATOR]])

function bind(grant: Record<string, unknown>, actingUserId: string, owners = ownedByOperator, ownerUserId: string | null = OWNER) {
  return bindAuthoritySubject({
    grant: grant as never,
    actingUserId,
    ownerUserId,
    scopeWorkOrderOwners: owners,
  })
}

describe("a session is bound to a grant by provenance, never by a label", () => {
  it("binds the synthetic operator to GRANT-0013, because it owns the work that grant names", () => {
    const binding = bind(GRANT_0013, OPERATOR)
    expect(binding.ok).toBe(true)
    if (!binding.ok) return
    expect(binding.basis).toBe("PROVEN_DELEGATION")
    expect(binding.provenance).toEqual(["WO-0027"])
    // The label is carried for audit and is not what decided it.
    expect(binding.declaredSubject).toBe("williamos")
  })

  it("refuses the same grant for a session that does not own WO-0027", () => {
    const binding = bind(GRANT_0013, STRANGER)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_NOT_RECIPIENT")
  })

  it("does not let the synthetic operator inherit a grant issued to another subject", () => {
    // The regression that matters most: a grant naming Codex's work must not become the operator's
    // merely because both are non-owner agents in the owner's namespace.
    const codexGrant = { ref: "GRANT-CODEX", userId: OWNER, grantedTo: "codex", scope: "WO-9001" }
    const binding = bind(codexGrant, OPERATOR, new Map([["WO-9001", CODEX]]))
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_NOT_RECIPIENT")
    expect(binding.detail).toContain("WO-9001")
  })

  it("ignores a flattering label when the provenance disagrees", () => {
    // `grantedTo: "operator"` is exactly the string a subject-name lookup would have matched.
    const mislabelled = { ref: "GRANT-LABEL", userId: OWNER, grantedTo: "operator", scope: "WO-9001" }
    expect(bind(mislabelled, OPERATOR, new Map([["WO-9001", CODEX]])).ok).toBe(false)
  })

  it("binds on provenance even when no label was recorded at all", () => {
    const unlabelled = { ref: "GRANT-NOLABEL", userId: OWNER, grantedTo: null, scope: "WO-0027" }
    const binding = bind(unlabelled, OPERATOR)
    expect(binding.ok).toBe(true)
    if (!binding.ok) return
    expect(binding.declaredSubject).toBeNull()
  })
})

describe("the owner's own authority is untouched", () => {
  it("still reaches its own namespace directly", () => {
    const binding = bind({ ref: "GRANT-0001", userId: OWNER, grantedTo: "owner", scope: null }, OWNER)
    expect(binding.ok).toBe(true)
    if (!binding.ok) return
    expect(binding.basis).toBe("SELF_NAMESPACE")
  })

  it("gives the synthetic operator its own namespace too, which is what #872 intended", () => {
    const binding = bind({ ref: "GRANT-OP", userId: OPERATOR, grantedTo: "williamos", scope: null }, OPERATOR)
    expect(binding.ok).toBe(true)
    if (!binding.ok) return
    expect(binding.basis).toBe("SELF_NAMESPACE")
  })
})

describe("nobody reaches into a namespace that is not theirs", () => {
  it("refuses an unscoped grant from the owner's namespace", () => {
    // A general owner grant names no work, so it carries no evidence about anyone else.
    const binding = bind({ ref: "GRANT-GENERAL", userId: OWNER, grantedTo: "williamos", scope: null }, OPERATOR)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_UNSCOPED_DELEGATION")
  })

  it("refuses a scope that names no work order, such as a goal", () => {
    const goalScoped = { ref: "GRANT-0018", userId: OWNER, grantedTo: "operator", scope: "goal:GOAL-0011" }
    const binding = bind(goalScoped, OPERATOR)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_UNSCOPED_DELEGATION")
  })

  it("refuses delegation out of a third party's namespace", () => {
    const binding = bind({ ref: "GRANT-X", userId: STRANGER, grantedTo: "williamos", scope: "WO-0027" }, OPERATOR)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_NAMESPACE_NOT_OWNER")
  })

  it("refuses every delegation when the governed owner cannot be resolved", () => {
    const binding = bind(GRANT_0013, OPERATOR, ownedByOperator, null)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_NAMESPACE_NOT_OWNER")
  })

  it("refuses when the scoped work order's owner cannot be read", () => {
    // An unreadable premise is not a satisfied one.
    const binding = bind(GRANT_0013, OPERATOR, new Map())
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_SCOPE_UNRESOLVED")
  })

  it("requires ALL scoped work, not some: a scope spanning two subjects binds to neither", () => {
    const spanning = { ref: "GRANT-SPAN", userId: OWNER, grantedTo: "williamos", scope: "WO-0027 WO-9001" }
    const owners = new Map([["WO-0027", OPERATOR], ["WO-9001", CODEX]])
    const binding = bind(spanning, OPERATOR, owners)
    expect(binding.ok).toBe(false)
    if (binding.ok) return
    expect(binding.failure).toBe("SUBJECT_NOT_RECIPIENT")
  })
})

describe("binding is not coverage", () => {
  const row = (over: Record<string, unknown> = {}) => authorityGrantFactsFromRow({
    id: 13,
    ref: "GRANT-0013",
    status: "active",
    authorityLevel: "A3_WRITE_SHARED",
    allowedActions: ["implement"],
    blockedActions: [],
    expiresAt: null,
    revokedAt: null,
    userId: OWNER,
    grantedTo: "williamos",
    ...over,
  })

  it("carries the namespace and recipient through the pure contract now", () => {
    expect(row().userId).toBe(OWNER)
    expect(row().grantedTo).toBe("williamos")
  })

  it("still terminates coverage on revocation, however well bound the subject is", () => {
    expect(bind(GRANT_0013, OPERATOR).ok).toBe(true)
    expect(grantCovers(row({ status: "revoked" }), "A2_WRITE_OWN", "implement").ok).toBe(false)
  })

  it("still terminates coverage on expiry", () => {
    expect(grantCovers(row({ expiresAt: "2020-01-01T00:00:00.000Z" }), "A2_WRITE_OWN", "implement").ok).toBe(false)
  })

  it("still refuses an authority level the grant does not reach", () => {
    expect(grantCovers(row(), "A9_RELEASE", "implement").ok).toBe(false)
  })

  it("still refuses an action outside the grant's allowed set", () => {
    expect(grantCovers(row(), "A2_WRITE_OWN", "release").ok).toBe(false)
  })
})

describe("scope parsing", () => {
  it("finds work-order refs and ignores everything else", () => {
    expect(workOrderRefsInScope("WO-0027")).toEqual(["WO-0027"])
    expect(workOrderRefsInScope("goal:GOAL-0011")).toEqual([])
    expect(workOrderRefsInScope(null)).toEqual([])
  })

  it("de-duplicates so a repeated ref is one premise, not two", () => {
    expect(workOrderRefsInScope("WO-0027 and again WO-0027")).toEqual(["WO-0027"])
  })
})
