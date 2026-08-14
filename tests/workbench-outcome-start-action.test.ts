import { describe, expect, it, vi } from "vitest"

const { startGoalOutcome } = vi.hoisted(() => ({ startGoalOutcome: vi.fn(async () => ({
  status: "ACCEPTED" as const,
  projectId: 7,
  threadId: "thread-opaque",
  goalId: 41,
  outcomeKey: "goal:GOAL-0041",
  root: { sourceType: "outcome" as const, sourceId: "goal:GOAL-0041" },
  intakeTruth: "persisted" as const,
  ownershipTruth: "project_thread_bound" as const,
  approvalGrantedByIntake: false as const,
  authorityGrantedByIntake: false as const,
  executionAuthorizedByIntake: false as const,
})) }))

vi.mock("@/app/actions/goals", () => ({ startGoalOutcome }))

import { startWorkbenchOutcome } from "@/app/actions/start-workbench-outcome"

describe("startWorkbenchOutcome action", () => {
  it("delegates to the internally authenticated atomic intake and preserves closed execution", async () => {
    const input = { projectId: 7, intent: "Deliver", idempotencyKey: "workbench-outcome:stable-0001" }
    const result = await startWorkbenchOutcome(input)

    expect(startGoalOutcome).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({
      status: "ACCEPTED",
      ownershipTruth: "project_thread_bound",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
  })
})
