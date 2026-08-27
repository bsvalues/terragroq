import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const RUNTIME_PAGE = "app/(shell)/runtime/page.tsx"
const LEDGER = "docs/product/runtime-migration-gap.md"
const LINE_ROUTE = "app/api/environment/line/route.ts"

/**
 * The gap the branch named, made enforceable.
 *
 * `/runtime` is the one legacy route the primary experience replacement deliberately did NOT delete:
 * it is a composite of about ten reads and only two have become surfaces. The branch said so in a
 * commit message. A commit message is not read by the next lane deciding whether a page looks safe to
 * remove — so the ledger lives in `docs/product/runtime-migration-gap.md`, and this file makes it
 * cost something to be wrong.
 *
 * Two failure modes are pinned. Delete `/runtime` while reads are unmigrated and the build fails.
 * Let the ledger drift from what the page actually does — the quieter and more likely rot — and the
 * build fails too, because a ledger nobody checks is how the first gap survived a green suite.
 */

/** Reads still living only on `/runtime`. Each must still be reachable there. */
const UNMIGRATED_READS = [
  "getRecentEvidence",
  "getRecentOutcomeCompletionTimeline",
  "projectContinuousCampaignStatus",
  "RuntimeProbe",
  "getAuthReadiness",
  "ReadinessNativeAreaPanel",
  "LocalRuntimeLiveStatusPanel",
  "DeviceEnrollmentPanel",
  "buildRuntimeStatus",
] as const

/** Reads that genuinely moved. The claim is checked against the environment, not taken on trust. */
const MIGRATED_READS = ["getRuntimeExecutions", "getOutcomeQueueSurface"] as const

describe("the /runtime migration gap is typed, not merely mentioned", () => {
  it("keeps /runtime reachable while any of its reads has nowhere else to appear", () => {
    expect(UNMIGRATED_READS.length).toBeGreaterThan(0)
    expect(
      fs.existsSync(path.join(ROOT, RUNTIME_PAGE)),
      `${RUNTIME_PAGE} was deleted while ${UNMIGRATED_READS.length} of its reads exist nowhere else. ` +
        `Migrate them into the environment as surfaces first — see ${LEDGER}.`,
    ).toBe(true)
  })

  it("keeps the ledger honest about what is still only on that page", () => {
    const page = fs.readFileSync(path.join(ROOT, RUNTIME_PAGE), "utf8")
    for (const read of UNMIGRATED_READS) {
      expect(
        page.includes(read),
        `${LEDGER} lists ${read} as unmigrated, but ${RUNTIME_PAGE} no longer uses it. ` +
          `Either it moved and the ledger owes a row, or a read was dropped on the floor.`,
      ).toBe(true)
    }
  })

  it("proves the two migrated reads actually reach the environment", () => {
    // "Migrated" is a claim about where a capability now lives. Asserting it against the Line route
    // is what stops the ledger from becoming a list of intentions.
    const line = fs.readFileSync(path.join(ROOT, LINE_ROUTE), "utf8")
    for (const read of MIGRATED_READS) {
      expect(line.includes(read), `${read} is recorded as migrated but the environment never calls it`).toBe(true)
    }
  })

  it("records the gap where the next lane will read it", () => {
    const ledger = fs.readFileSync(path.join(ROOT, LEDGER), "utf8")
    expect(ledger).toContain("OPEN, TYPED, ENFORCED")
    for (const read of [...UNMIGRATED_READS, ...MIGRATED_READS]) {
      expect(ledger.includes(read), `${read} is not in the ledger`).toBe(true)
    }
  })
})
