import { describe, expect, it } from "vitest"

import { RELATIONSHIP, shapeResourceRecord, type ResourceRow } from "../lib/resource/resolve"

const row = (over: Partial<ResourceRow>): ResourceRow => ({
  type: "data_source",
  canonicalIdentity: "x",
  label: "x",
  relationship: RELATIONSHIP.source,
  allowedOperations: [],
  ratifiedAt: null,
  projectKey: "terrafusion",
  projectName: "TerraFusion",
  ...over,
})

describe("resolving a resource", () => {
  it("distinguishes an undeclared resource from an empty one", () => {
    // "Nothing is declared" and "I have no idea" lead to opposite next actions. Conflating them is how
    // an agent talks itself into deciding an architecture from a directory listing.
    expect(shapeResourceRecord("PACS", [])).toBeNull()
  })

  it("names the declared workload owner rather than inferring it", () => {
    const record = shapeResourceRecord("PACS", [
      row({ type: "node", canonicalIdentity: "aegis", label: "AEGIS", relationship: RELATIONSHIP.workloadOwner }),
    ])
    expect(record?.workloadOwner).toEqual({ identity: "aegis", label: "AEGIS" })
  })

  it("reports no owner as null instead of guessing one", () => {
    const record = shapeResourceRecord("PACS", [row({ canonicalIdentity: "backup.bak" })])
    expect(record?.workloadOwner).toBeNull()
  })

  it("groups sources, runtime, derivatives and completion evidence", () => {
    const record = shapeResourceRecord("PACS", [
      row({ canonicalIdentity: "pacs_oltp.bak", relationship: RELATIONSHIP.source }),
      row({ type: "service", canonicalIdentity: "mssql", relationship: RELATIONSHIP.runtime }),
      row({ type: "database", canonicalIdentity: "canonical_tf", relationship: RELATIONSHIP.derivative }),
      row({ canonicalIdentity: "verify-pacs-bak", relationship: RELATIONSHIP.completionEvidence }),
    ])
    expect(record?.sources).toHaveLength(1)
    expect(record?.runtime).toHaveLength(1)
    expect(record?.derivatives).toHaveLength(1)
    expect(record?.completionEvidence[0].identity).toBe("verify-pacs-bak")
  })

  it("merges permitted operations across rows without duplicates", () => {
    const record = shapeResourceRecord("PACS", [
      row({ canonicalIdentity: "a", allowedOperations: ["read", "verify"] }),
      row({ canonicalIdentity: "b", allowedOperations: ["verify"] }),
    ])
    expect(record?.allowedOperations).toEqual(["read", "verify"])
  })

  it("marks a drafted record unratified and says why", () => {
    const record = shapeResourceRecord("PACS", [row({ canonicalIdentity: "a" })])
    expect(record?.ratified).toBe(false)
    expect(record?.caveat).toContain("not been ratified")
  })

  it("is ratified only when every row is", () => {
    const partly = shapeResourceRecord("PACS", [
      row({ canonicalIdentity: "a", ratifiedAt: new Date() }),
      row({ canonicalIdentity: "b", ratifiedAt: null }),
    ])
    expect(partly?.ratified).toBe(false)

    const fully = shapeResourceRecord("PACS", [
      row({ canonicalIdentity: "a", ratifiedAt: new Date() }),
      row({ canonicalIdentity: "b", ratifiedAt: new Date() }),
    ])
    expect(fully?.ratified).toBe(true)
    expect(fully?.caveat).toBeUndefined()
  })
})
