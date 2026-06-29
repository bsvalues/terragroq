import { describe, expect, it } from "vitest"
import { getBrainCouncilContradictionReview } from "@/components/brain-council/brain-council-contradiction-review"

describe("Brain Council contradiction review", () => {
  it("shows open and resolved contradictions", () => {
    const review = getBrainCouncilContradictionReview()
    const statuses = review.contradictions.map((item) => item.status)

    expect(review.posture).toBe("CONTRADICTION_REVIEW_READ_ONLY")
    expect(statuses).toContain("open")
    expect(statuses).toContain("resolved")
  })

  it("tracks severity and resolution paths", () => {
    const review = getBrainCouncilContradictionReview()

    expect(review.contradictions.some((item) => item.severity === "high")).toBe(true)
    expect(review.contradictions.every((item) => item.resolutionPath.length > 10)).toBe(true)
  })

  it("does not resolve or mutate contradictions", () => {
    const review = getBrainCouncilContradictionReview()

    expect(review.safety).toEqual({
      resolvesContradiction: false,
      changesBelief: false,
      changesPolicy: false,
      mutatesData: false,
    })
  })
})
