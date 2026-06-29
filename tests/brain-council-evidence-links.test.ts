import { describe, expect, it } from "vitest"
import { getBrainCouncilEvidenceLinks } from "@/components/brain-council/brain-council-evidence-links"

describe("Brain Council evidence links", () => {
  it("cross-links to existing read-only evidence surfaces", () => {
    const links = getBrainCouncilEvidenceLinks()

    expect(links.map((link) => link.href)).toEqual([
      "/runtime",
      "/work-orders",
      "/audit",
      "/governance",
    ])
    expect(links.every((link) => link.description.length > 0)).toBe(true)
  })

  it("does not define action endpoints", () => {
    const links = getBrainCouncilEvidenceLinks()
    const pathSegments = links.flatMap((link) => link.href.split("/").filter(Boolean))

    expect(pathSegments.some((segment) => /^(run|execute|activate|approve)$/i.test(segment))).toBe(false)
  })
})
