import { describe, expect, it } from "vitest"

import {
  SYNTHETIC_OPERATOR_EMAIL,
  assertOperatorDistinctFromOwner,
  isSyntheticOperatorEmail,
} from "../lib/device-auth/operator"

describe("the synthetic operator identity", () => {
  it("is refused when it resolves to the owner", () => {
    // Sharing the owner's identity would make every agent action indistinguishable from William's.
    const verdict = assertOperatorDistinctFromOwner("user-1", "user-1")
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("OPERATOR_IS_OWNER")
  })

  it("is accepted when it is a separate identity", () => {
    expect(assertOperatorDistinctFromOwner("operator-1", "user-1")).toEqual({ ok: true })
  })

  it("is refused before it exists, rather than treated as absent-therefore-fine", () => {
    const verdict = assertOperatorDistinctFromOwner(null, "user-1")
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("OPERATOR_UNRESOLVED")
  })

  it("still refuses the owner when the owner cannot be resolved", () => {
    // An unresolved owner must not turn into "nothing to compare against, therefore admit".
    expect(assertOperatorDistinctFromOwner("operator-1", null)).toEqual({ ok: true })
    expect(assertOperatorDistinctFromOwner(null, null).ok).toBe(false)
  })

  it("matches its address regardless of case or padding", () => {
    expect(isSyntheticOperatorEmail(`  ${SYNTHETIC_OPERATOR_EMAIL.toUpperCase()} `)).toBe(true)
    expect(isSyntheticOperatorEmail("bsvalues@gmail.com")).toBe(false)
    expect(isSyntheticOperatorEmail(null)).toBe(false)
  })

  it("uses a non-routable address, so no human can be mailed or sign in as it", () => {
    expect(SYNTHETIC_OPERATOR_EMAIL.endsWith(".invalid")).toBe(true)
  })
})
