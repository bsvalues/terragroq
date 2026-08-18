import { describe, expect, it } from "vitest"

import { DOCTRINE_FILES } from "../lib/governance/work-context-live"
import { dependencyClosure, mayAdvanceAnchor, pathIntersectsClosure } from "../lib/governance/receipt-anchor"

describe("dependency closure", () => {
  it("covers what the lane reserved and the instruction chain it read", () => {
    const closure = dependencyClosure({ reservedPaths: ["lib/governance/", "app/api/loom/"] })
    expect(closure).toContain("lib/governance/")
    for (const doctrine of DOCTRINE_FILES) expect(closure).toContain(doctrine)
  })

  it("is a set, so a duplicated reservation does not change the closure", () => {
    const once = dependencyClosure({ reservedPaths: ["lib/goal/"] })
    const twice = dependencyClosure({ reservedPaths: ["lib/goal/", " lib/goal/ "] })
    expect(twice).toEqual(once)
  })
})

describe("what counts as touching the closure", () => {
  it("treats a trailing slash as a directory and matches everything beneath it", () => {
    expect(pathIntersectsClosure("lib/governance/owner.ts", ["lib/governance/"])).toBe(true)
  })

  it("does not let a directory reservation capture a differently named sibling", () => {
    // "lib/goal" as a prefix would swallow "lib/goals-v2", which is a different subsystem entirely.
    expect(pathIntersectsClosure("lib/goals-v2/taxonomy.ts", ["lib/goal/"])).toBe(false)
  })

  it("requires an exact match for a file reservation", () => {
    expect(pathIntersectsClosure("AGENTS.md", ["AGENTS.md"])).toBe(true)
    expect(pathIntersectsClosure("docs/AGENTS.md", ["AGENTS.md"])).toBe(false)
  })

  it("compares Windows-style paths on the same terms", () => {
    expect(pathIntersectsClosure("lib\\governance\\owner.ts", ["lib/governance/"])).toBe(true)
  })
})

describe("advancing the anchor", () => {
  const closure = dependencyClosure({ reservedPaths: ["lib/governance/"] })

  it("advances when main moved without touching anything the receipt proved", () => {
    // This is the case that matters. Without it every receipt dies on the next unrelated merge, and a
    // gate that blocks every lane gets removed rather than obeyed.
    const verdict = mayAdvanceAnchor(closure, ["components/Chart.tsx", "README.md"])
    expect(verdict.ok).toBe(true)
    expect(verdict.intersecting).toEqual([])
  })

  it("refuses when a reserved path moved, and says which", () => {
    const verdict = mayAdvanceAnchor(closure, ["components/Chart.tsx", "lib/governance/owner.ts"])
    expect(verdict.ok).toBe(false)
    expect(verdict.intersecting).toEqual(["lib/governance/owner.ts"])
  })

  it("refuses when the controlling doctrine moved, even if the reservation did not", () => {
    const verdict = mayAdvanceAnchor(closure, ["AGENTS.md"])
    expect(verdict.ok).toBe(false)
    expect(verdict.intersecting).toEqual(["AGENTS.md"])
  })

  it("advances when nothing changed at all", () => {
    expect(mayAdvanceAnchor(closure, []).ok).toBe(true)
  })
})
