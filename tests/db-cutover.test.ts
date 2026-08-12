import { describe, expect, it } from "vitest"

// @ts-expect-error — plain .mjs helpers, no type declarations
import { classify, isScaffoldEmail } from "../scripts/db/neon-state-probe.mjs"
// @ts-expect-error — plain .mjs helpers, no type declarations
import { quiescence } from "../scripts/db/verify-cutover.mjs"

describe("neon-state-probe classification", () => {
  it("classifies an empty database as NO_CANONICAL_STATE", () => {
    const tables = { goal: 0, decision: 0, governance_event: 0, user: 0 }
    expect(classify({ tables, userAnalysis: { total: 0, scaffold: 0, nonScaffold: 0 } })).toBe(
      "NO_CANONICAL_STATE",
    )
  })

  it("classifies scaffold-only auth users as NO_CANONICAL_STATE", () => {
    const tables = { goal: 0, decision: 0, user: 3 }
    expect(classify({ tables, userAnalysis: { total: 3, scaffold: 3, nonScaffold: 0 } })).toBe(
      "NO_CANONICAL_STATE",
    )
  })

  it("requires migration when any canonical table has rows", () => {
    const tables = { goal: 2, decision: 0, user: 0 }
    expect(classify({ tables, userAnalysis: { total: 0, scaffold: 0, nonScaffold: 0 } })).toBe(
      "MIGRATION_REQUIRED",
    )
  })

  it("requires migration when a real (non-scaffold) user exists", () => {
    const tables = { goal: 0, decision: 0, user: 2 }
    expect(classify({ tables, userAnalysis: { total: 2, scaffold: 1, nonScaffold: 1 } })).toBe(
      "MIGRATION_REQUIRED",
    )
  })

  it("recognizes known scaffold identities and not real ones", () => {
    expect(isScaffoldEmail("operator@command.io")).toBe(true)
    expect(isScaffoldEmail("diag+1782790395@example.com")).toBe(true)
    expect(isScaffoldEmail("bsvalues@gmail.com")).toBe(false)
  })
})

describe("verify-cutover quiescence", () => {
  it("reports quiescent when Neon row counts are unchanged", () => {
    const m = { tables: { goal: 5, decision: 3 } }
    expect(quiescence(m, { tables: { goal: 5, decision: 3 } })).toEqual({ quiescent: true, diffs: [] })
  })

  it("detects a new Neon write", () => {
    const before = { tables: { goal: 5, decision: 3 } }
    const after = { tables: { goal: 6, decision: 3 } }
    const r = quiescence(before, after)
    expect(r.quiescent).toBe(false)
    expect(r.diffs).toContain("goal: 5 -> 6")
  })
})
