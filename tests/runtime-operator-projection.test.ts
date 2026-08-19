import { describe, expect, it } from "vitest"

import { parseProjectionIssue } from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * WO-0029 delivered correct work, wrote "Closes #871" into its pull request, and left #891 -- the issue
 * it was actually for -- untouched and open. Its description cited #871 as prior art before naming its
 * own projection, and the parser took the first #N in free text. A work order that cites anything
 * therefore misprojects onto whatever it cites.
 */
describe("a work order's projection is stated, not inferred", () => {
  it("reads the explicit projection even when the description cites other issues first", () => {
    const description =
      "Two of #871's four objectives never matched a pattern at all, which #762 records. " +
      "Authorized under GRANT-0015, frozen acceptance projected at GitHub issue 891."
    expect(parseProjectionIssue(description)).toBe(891)
  })

  it("accepts the shorter projection form", () => {
    expect(parseProjectionIssue("projection: #742")).toBe(742)
    expect(parseProjectionIssue("Projection = 742")).toBe(742)
  })

  it("returns null rather than guessing from a bare issue reference", () => {
    // The registry omits a work order with no projection, so it is never dispatched at a guess.
    expect(parseProjectionIssue("fixes #123 and mentions #456")).toBeNull()
    expect(parseProjectionIssue("see issue 890 for background")).toBeNull()
  })

  it("returns null for an absent description", () => {
    expect(parseProjectionIssue(undefined)).toBeNull()
    expect(parseProjectionIssue("")).toBeNull()
  })

  it("still reads the form every dispatched work order has used", () => {
    expect(
      parseProjectionIssue("Authorized under GRANT-0012, Codex lane, frozen acceptance projected at GitHub issue 890."),
    ).toBe(890)
  })
})
