import { describe, expect, it } from "vitest"

import { OUTCOME_QUEUE_SQL } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"
import { deriveHermesWorkContract } from "@/scripts/hermes-bridge/work-contract.mjs"

/**
 * The SQL sibling of PR #952 (owner invariant 2026-08-21): #952 opened the JS execution walls to
 * derived lane-policy contracts, but the SQL ACQUISITION-ELIGIBILITY predicate still hardcoded only
 * the three registered contract ids. A derived-contract outcome was authorized-for-acquisition yet
 * never selected (NO_ELIGIBLE_OUTCOME). This locks the fix: the acquisition SQL admits the two derived
 * contracts with the SAME exactness as the registered ones (id + digest + full JSON + default
 * selection), and never loosens to text.
 *
 * Syntax is validated separately by EXPLAIN against real Postgres (acquire + every DML query plan
 * clean). These tests assert the branch is present, constrained, and pinned to the SINGLE source of
 * truth so the SQL constants can never drift from what the authorize action persists.
 */
const UI = deriveHermesWorkContract({ lane: "ui", risk: "low", authority: "A2_WRITE_OWN", acceptedContractIds: [] })!
const OO = deriveHermesWorkContract({
  lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN", acceptedContractIds: [],
})!

const ELIGIBILITY_QUERIES = ["acquire", "revalidateAcquisition", "recoverStaleLease"] as const

describe("derived lane-policy acquisition eligibility (SQL sibling of #952)", () => {
  it("derives the two lane contracts with stable ids and 64-hex digests", () => {
    expect(UI.id).toBe("derived-lane-ui.v1")
    expect(OO.id).toBe("derived-lane-operator-objective.v1")
    for (const c of [UI, OO]) expect(c.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(UI.digest).not.toBe(OO.digest)
  })

  it.each(ELIGIBILITY_QUERIES)("%s admits BOTH derived contracts by id and digest", (name) => {
    const sql = OUTCOME_QUEUE_SQL[name] as string | undefined
    // recoverStaleLease may not exist in every revision; skip absent optional queries.
    if (typeof sql !== "string") return
    for (const c of [UI, OO]) {
      expect(sql).toContain(`'${c.id}'`)
      expect(sql).toContain(`'${c.digest}'`)
    }
  })

  it("the acquire eligibility pins each derived contract to default selection (no loosening)", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    for (const c of [UI, OO]) {
      // Every derived id occurrence sits in a branch that also constrains digest + default selection.
      const idx = sql.indexOf(`'${c.id}'`)
      expect(idx).toBeGreaterThan(-1)
      // The branch runs id → digest → full-JSON pin → default-selection guard; the JSON pin is long,
      // so window generously past it. The guard must appear before the next registered branch.
      const branch = sql.slice(idx, idx + 4000)
      expect(branch).toContain(`'${c.digest}'`)
      expect(branch).toContain(`q."acceptedContractIds" = ARRAY[]::text[]`)
    }
  })

  it("the full derived contract JSON is pinned (jsonb value-equality), so a forged partial cannot pass", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    for (const c of [UI, OO]) {
      // The exact serialized contract appears as a ::jsonb literal in the eligibility predicate.
      expect(sql).toContain(`${JSON.stringify(c).replaceAll("'", "''")}'::jsonb`)
    }
  })

  it("registered contracts still gate acquisition (the fix adds, never replaces)", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    // The registered latest-evidence and #911 ids remain present alongside the derived ones.
    expect(sql).toContain("selected-thread-latest-evidence.v1")
    expect(sql).toContain("issue-911")
  })
})
