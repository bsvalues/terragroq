import { describe, expect, it } from "vitest"

import {
  MAX_OBJECTIVE_LENGTH,
  assertAdmissible,
  normaliseObjective,
  objectiveTitle,
} from "../lib/objective/intake"

const REAL_OBJECTIVE =
  "Determine what the recovered OMEN Benton database is, whether TerraFusion already possesses that data, whether anything requires preservation, and return evidence."

describe("admitting an objective", () => {
  it("admits the #871 acceptance objective", () => {
    expect(assertAdmissible(REAL_OBJECTIVE)).toEqual({ ok: true })
  })

  it("admits an objective the old classifier could not route", () => {
    // "Verify the deployed PACS state against the recorded completion evidence" returned
    // clarification_required, because no regex matched. Admission must not depend on recognising the
    // phrasing -- that dependency is the defect, not the fix.
    expect(assertAdmissible("Verify the deployed PACS state against the recorded completion evidence").ok).toBe(true)
    expect(assertAdmissible("Find out why the recovered Benton database conflicts with what we know about PACS").ok).toBe(true)
  })

  it("refuses an empty or non-string objective", () => {
    for (const input of ["", "   ", null, undefined, 42, {}]) {
      const verdict = assertAdmissible(input)
      expect(verdict.ok).toBe(false)
      expect(verdict.failure).toBe("OBJECTIVE_EMPTY")
    }
  })

  it("refuses an objective beyond the bound", () => {
    const verdict = assertAdmissible("x".repeat(MAX_OBJECTIVE_LENGTH + 1))
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("OBJECTIVE_TOO_LONG")
  })

  it("accepts one exactly at the bound", () => {
    expect(assertAdmissible("x".repeat(MAX_OBJECTIVE_LENGTH)).ok).toBe(true)
  })
})

describe("recording what was asked", () => {
  it("collapses whitespace so the same objective twice is the same text", () => {
    expect(normaliseObjective("  determine   what\nthe database is  ")).toBe("determine what the database is")
  })

  it("titles from the first sentence when there is one", () => {
    expect(objectiveTitle("Determine what the OMEN database is. Then report.")).toBe(
      "Determine what the OMEN database is.",
    )
  })

  it("cuts a long title at a word boundary rather than mid-word", () => {
    const title = objectiveTitle(REAL_OBJECTIVE)
    expect(title.length).toBeLessThanOrEqual(121)
    // The failure this guards against is a title reading as corruption, e.g. "...recovered OMEN Bent".
    expect(title.endsWith("…")).toBe(true)
    expect(title.replace("…", "").endsWith(" ")).toBe(false)
    expect(REAL_OBJECTIVE.startsWith(title.replace("…", ""))).toBe(true)
  })

  it("leaves a short objective as its own title", () => {
    expect(objectiveTitle("Who owns PACS?")).toBe("Who owns PACS?")
  })
})
