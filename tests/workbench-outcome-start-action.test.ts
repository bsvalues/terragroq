import { beforeEach, describe, expect, it, vi } from "vitest"

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
vi.mock("@/lib/session", () => ({ getUserId: vi.fn(async () => "owner") }))

import { startWorkbenchOutcome } from "@/app/actions/start-workbench-outcome"

describe("startWorkbenchOutcome action", () => {
  beforeEach(() => {
    startGoalOutcome.mockClear()
  })

  it("delegates to the internally authenticated atomic intake and preserves closed execution", async () => {
    const input = {
      projectId: 7,
      intent: "record structured #911 reliability remediation without host mutation",
      idempotencyKey: "workbench-outcome:stable-0001",
    }
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

  it.each([
    "Build a useful release dashboard",
    "Fix the broken Project selector",
  ])("rejects a generic outcome-routed intent at the public action boundary: %s", async (intent) => {
    const result = await startWorkbenchOutcome({
      projectId: 7,
      intent,
      idempotencyKey: "workbench-outcome:generic-direct-0001",
    })

    expect(result).toEqual({
      status: "INVALID_INTENT",
      reason: "ROUTE_NOT_START_OUTCOME",
      projectId: 7,
      threadId: null,
      goalId: null,
      outcomeKey: null,
      root: null,
      intakeTruth: "unknown",
      ownershipTruth: "unavailable",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
  })
})
