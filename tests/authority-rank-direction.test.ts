import { describe, expect, it } from "vitest"

import {
  authorityRank,
  isAuthorityId,
  providedAuthorityRank,
  requiredAuthorityRank,
} from "@/lib/goal/taxonomy"
import { grantCovers, strongestActiveGrant } from "@/lib/governance/authority"

/** Minimal grant shape; the real row carries more, none of which these checks read. */
const grant = (over: Record<string, unknown> = {}) => ({
  id: 1, ref: "GRANT-TEST", userId: "u", status: "active",
  authorityLevel: "A2_WRITE_OWN", scope: null, allowedActions: [], blockedActions: [],
  expiresAt: null, revokeReason: null, ...over,
}) as never

describe("authority ranking is directional", () => {
  it("ranks a demanded level that nobody defined above everything", () => {
    // Fail-closed direction: asking for authority that does not exist must never be satisfiable.
    expect(requiredAuthorityRank("A5_DEPLOY")).toBe(Number.POSITIVE_INFINITY)
    expect(requiredAuthorityRank("")).toBe(Number.POSITIVE_INFINITY)
    expect(requiredAuthorityRank(null)).toBe(Number.POSITIVE_INFINITY)
  })

  it("ranks a provided level that nobody defined below everything", () => {
    // A malformed grant provides nothing; it must not become the strongest in the registry.
    expect(providedAuthorityRank("A9_ROOT")).toBe(-1)
    expect(providedAuthorityRank(undefined)).toBe(-1)
    expect(providedAuthorityRank("A0_READ_ONLY")).toBe(0)
  })

  it("agrees with the raw rank for real levels", () => {
    for (const id of ["A0_READ_ONLY", "A2_WRITE_OWN", "A9_RELEASE"]) {
      expect(requiredAuthorityRank(id)).toBe(authorityRank(id))
      expect(providedAuthorityRank(id)).toBe(authorityRank(id))
    }
  })

  it("recognises only defined ids", () => {
    expect(isAuthorityId("A2_WRITE_OWN")).toBe(true)
    // Near-misses of real ids are what made this dangerous rather than merely untidy.
    for (const bogus of ["A5_DEPLOY", "A9_ROOT", "a2_write_own", "", null, undefined]) {
      expect(isAuthorityId(bogus as string)).toBe(false)
    }
  })
})

describe("grantCovers no longer passes undefined levels", () => {
  it("refuses a requirement that is not a defined level", () => {
    // Previously authorityRank ranked these 0, so 0 > 2 was false and the grant reported covered.
    for (const bogus of ["A5_DEPLOY", "A9_ROOT", "NONSENSE"]) {
      expect(grantCovers(grant(), bogus as never).ok).toBe(false)
    }
  })

  it("refuses a grant whose own level is not defined", () => {
    expect(grantCovers(grant({ authorityLevel: "A9_ROOT" }), "A2_WRITE_OWN" as never).ok).toBe(false)
  })

  it("still covers a real requirement within a real grant", () => {
    expect(grantCovers(grant(), "A2_WRITE_OWN" as never).ok).toBe(true)
    expect(grantCovers(grant({ authorityLevel: "A9_RELEASE" }), "A2_WRITE_OWN" as never).ok).toBe(true)
  })

  it("still refuses a real requirement above the grant", () => {
    expect(grantCovers(grant(), "A9_RELEASE" as never).ok).toBe(false)
  })

  it("does not let a malformed grant win strongest-active", () => {
    const best = strongestActiveGrant([
      grant({ id: 1, authorityLevel: "A9_ROOT" }),
      grant({ id: 2, authorityLevel: "A2_WRITE_OWN" }),
    ] as never)
    expect(best?.authorityLevel).toBe("A2_WRITE_OWN")
  })
})
