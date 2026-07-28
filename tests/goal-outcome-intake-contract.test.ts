import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const source = fs.readFileSync(
  path.join(process.cwd(), "app", "actions", "goals.ts"),
  "utf8",
)
const caller = fs.readFileSync(
  path.join(process.cwd(), "components", "goal-console", "goal-console-view.tsx"),
  "utf8",
)
const schema = fs.readFileSync(
  path.join(process.cwd(), "lib", "db", "schema.ts"),
  "utf8",
)

describe("authenticated goal-to-outcome intake contract", () => {
  it("bootstraps the durable queue and records the goal plus unapproved outcome atomically", () => {
    expect(source).toContain("await ensureOutcomeQueueHardeningSchema()")
    expect(source).toContain("await db.transaction(async (transaction) =>")
    expect(source).toContain("transaction.insert(outcomeQueueItem)")
    expect(source).toContain("mapLegacyGoalToOutcome(created)")
    expect(source).toMatch(/transaction\s*\.insert\(goalOutcomeIntakeReceipt\)/)
    expect(source).toMatch(/transaction\s*\.insert\(governanceEvent\)/)
    expect(source).toContain("transaction.insert(eventLog)")
    expect(source).not.toContain("await appendGovernanceEvent")
  })

  it("binds refused intake receipts without creating an executable queue item", () => {
    expect(source).toContain('return `refused:goal:${goalId}`')
    expect(source).toContain('if (created.verdict === "refuse")')
    expect(source).toContain("outcomeBinding = refusedGoalBinding(created.id)")
    expect(source).toMatch(/if \(created\.verdict === "refuse"\)[\s\S]+?else \{[\s\S]+?transaction\.insert\(outcomeQueueItem\)/)
    expect(source).toContain('if (existingGoal.verdict === "refuse")')
    expect(source).toContain("existingReceipt.outcomeKey !== outcomeBinding")
  })

  it("uses a caller-stable key and retains it until the response succeeds", () => {
    expect(caller).toContain("pendingGoalSubmission")
    expect(caller).toContain("crypto.randomUUID()")
    expect(caller).toContain("sessionStorage.setItem")
    expect(caller).toContain("sessionStorage.removeItem")
    expect(caller).toContain("submitGoal(text, submission.idempotencyKey)")
    expect(caller).toContain("pendingGoalSubmission.current = null")
    expect(source).toContain("pg_advisory_xact_lock")
    expect(source).toContain("GOAL_INTAKE_IDEMPOTENCY_CONFLICT")
    expect(source).toContain("GOAL_INTAKE_BINDING_WALL")
  })

  it("pins one durable request to one goal and one outcome", () => {
    expect(schema).toContain(`"goal_outcome_intake_receipt"`)
    expect(schema).toContain(`unique("goal_outcome_intake_receipt_user_key_unique")`)
    expect(schema).toContain(`unique("goal_outcome_intake_receipt_user_goal_unique")`)
    expect(schema).toContain(`unique("goal_outcome_intake_receipt_user_outcome_unique")`)
    expect(schema).toContain(`replayCount: integer("replayCount").default(0).notNull()`)
  })

  it("does not mint approval or authority during ordinary-language intake", () => {
    expect(source).not.toMatch(/approvalState:\s*["']approved["']/)
    expect(source).not.toMatch(/authorityState:\s*["']matched["']/)
    expect(source).not.toMatch(/authorityGrantRef:/)
    expect(source).not.toMatch(/approvalDecisionId:/)
  })
})
