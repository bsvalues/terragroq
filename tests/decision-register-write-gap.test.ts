import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const ACTIONS = "app/actions/decisions.ts"
const LINE_ROUTE = "app/api/environment/line/route.ts"
const LEDGER = "docs/product/decision-register-write-gap.md"

/**
 * The three governed decision writes that lost their surface, made enforceable.
 *
 * Deleting `/decisions` migrated two writes to the Line and said so honestly. It wired six. The other
 * four have no door in the product any more: accept/reject a proposal, set a decision's authority,
 * attach evidence to one, and delete one — the last of those deliberately.
 *
 * Nothing is broken: the actions are intact and their protection guards are still tested. What is gone
 * is the way to reach them. That is the failure this whole exercise exists to catch — a capability
 * disappearing while the suite stays green because nothing asserted it was reachable — so it is pinned
 * here rather than left to be rediscovered.
 */

/** Governed writes that survive in code and have NO caller in the environment. */
const UNREPLACED_WRITES = ["updateDecisionStatus", "setDecisionAuthority", "linkEvidence"] as const

/** Writes the Line genuinely performs. Checked against the route, not taken on trust. */
const REPLACED_WRITES = ["createDecision", "supersedeDecision"] as const

describe("the decision register's unreplaced writes are named, not merely missing", () => {
  const actions = fs.readFileSync(path.join(ROOT, ACTIONS), "utf8")
  const line = fs.readFileSync(path.join(ROOT, LINE_ROUTE), "utf8")

  it("keeps every unreplaced write alive in code, so the capability is recoverable", () => {
    // Removing them would turn "no surface reaches this" into "this no longer exists", and the
    // protection guards that `runtime-finding-decision-action-guard` and
    // `v1-2-campaign-authority-actions` assert would go with them.
    for (const write of UNREPLACED_WRITES) {
      expect(
        actions.includes(`export async function ${write}`),
        `${write} was deleted rather than replaced. ${LEDGER} says it is unreplaced-but-alive; ` +
          `if it genuinely went away, its guards went with it and the ledger owes an explanation.`,
      ).toBe(true)
    }
  })

  it("tells the truth about which writes the environment can actually reach", () => {
    for (const write of REPLACED_WRITES) {
      expect(line.includes(write), `${write} is recorded as migrated but the Line route never calls it`).toBe(true)
    }
    for (const write of UNREPLACED_WRITES) {
      expect(
        line.includes(write),
        `${write} now HAS a caller in the environment — good. Move its row in ${LEDGER} out of the ` +
          `unreplaced list and out of UNREPLACED_WRITES here, so the ledger stops understating the product.`,
      ).toBe(false)
    }
  })

  it("records the gap where the next lane will read it", () => {
    const ledger = fs.readFileSync(path.join(ROOT, LEDGER), "utf8")
    expect(ledger).toContain("OPEN, TYPED, ENFORCED")
    for (const write of [...UNREPLACED_WRITES, ...REPLACED_WRITES, "deleteDecision"]) {
      expect(ledger.includes(write), `${write} is not in the ledger`).toBe(true)
    }
  })
})
