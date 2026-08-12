import { describe, expect, it } from "vitest"

// @ts-expect-error — plain .mjs helper, no type declarations
import { compareManifests } from "../scripts/db/db-state-manifest.mjs"

const base = {
  tableCount: 2,
  totalRows: 3,
  tables: {
    goal: { pk: ["id"], rows: 2, minPk: "1", maxPk: "2", contentHash: "aaa" },
    user: { pk: ["id"], rows: 1, minPk: "u_1", maxPk: "u_1", contentHash: "bbb" },
  },
}

const clone = (m: unknown) => JSON.parse(JSON.stringify(m))

describe("compareManifests", () => {
  it("reports no differences for identical manifests", () => {
    expect(compareManifests(base, clone(base))).toEqual([])
  })

  it("detects a changed row (content hash)", () => {
    const drifted = clone(base)
    drifted.tables.goal.contentHash = "zzz"
    expect(compareManifests(base, drifted)).toContain("goal: content hash mismatch")
  })

  it("detects a row-count change", () => {
    const drifted = clone(base)
    drifted.tables.goal.rows = 1
    expect(compareManifests(base, drifted)).toContain("goal: row count 2 -> 1")
  })

  it("detects a missing table", () => {
    const drifted = clone(base)
    delete drifted.tables.user
    expect(compareManifests(base, drifted).some((d: string) => d.includes("table set differs"))).toBe(true)
  })
})
