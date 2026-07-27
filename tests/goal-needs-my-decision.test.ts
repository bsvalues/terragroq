import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

import {
  buildNeedsMyDecisionView,
  getActiveGoalAuthorityRequests,
  getUnresolvedAuthorityRequestGoalIds,
} from "@/components/goal-console/active-goal-authority-requests"
import type {
  GoalTimelineDecisionRequest,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

const authoritySource = readFileSync(
  "app/(shell)/goal-console/authority-request-timelines.ts",
  "utf8",
)
const pageSource = readFileSync(
  "app/(shell)/goal-console/page.tsx",
  "utf8",
)
const viewSource = readFileSync(
  "components/goal-console/goal-console-view.tsx",
  "utf8",
)

function timeline(
  id: number,
  status: GoalTimelineDecisionRequest["status"],
) {
  return {
    id: `goal-timeline:${id}`,
    goal: {
      id,
      outcome: `Outcome needing decision ${id}`,
    },
    decisionRequest: {
      status,
      blockedAction: `Blocked action ${id}`,
      authorityBoundary: `Authority boundary ${id}`,
      choices: ["APPROVE", "DENY"],
      consequences: {
        approve: `Approve consequence ${id}`,
        deny: `Deny consequence ${id}`,
      },
      goalRef: `GOAL-${id}`,
      outcomeRef: `OUTCOME-${id}`,
      workOrderRef: `WO-${id}`,
      expectedNextState: `NEXT-${id}`,
    },
  } as GoalTimelineProjection
}

describe("Goal Console Needs My Decision view", () => {
  it("discovers every unresolved authority request outside the recent-goal limit", () => {
    const workOrders = [
      ...Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        ref: `WO-HERMES-OUTCOME-${index + 1}`,
        updatedAt: new Date(2026, 0, index + 1),
      })),
      {
        id: 31,
        ref: "WO-HERMES-OUTCOME-1",
        updatedAt: new Date(2025, 0, 1),
      },
      {
        id: 32,
        ref: "WO-HERMES-OUTCOME-0",
        updatedAt: new Date(2026, 1, 1),
      },
      {
        id: 33,
        ref: "WO-OTHER-31",
        updatedAt: new Date(2026, 1, 1),
      },
      {
        id: 34,
        ref: null,
        updatedAt: new Date(2026, 1, 1),
      },
    ]
    const lifecycleEvents = [
      {
        id: 101,
        eventType: "HERMES_OWNER_AUTHORITY_DECISION",
        entityId: "1",
        metadata: {
          outcomeId: 1,
          workOrderId: 1,
          terminalEventId: 100,
          decisionId: 91,
          choice: "APPROVE",
          ownerUserId: "owner-1",
          expectedNextState: "RESUME_AUTHORIZED",
        },
      },
      {
        id: 100,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "1",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
      {
        id: 200,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "2",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
      {
        id: 301,
        eventType: "HERMES_OUTCOME_COMPLETED",
        entityId: "3",
        metadata: {},
      },
      {
        id: 300,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "3",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
      {
        id: 402,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "4",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
      {
        id: 401,
        eventType: "HERMES_OWNER_AUTHORITY_DECISION",
        entityId: "4",
        metadata: {
          outcomeId: 4,
          workOrderId: 4,
          terminalEventId: 400,
          decisionId: 94,
          choice: "DENY",
          ownerUserId: "owner-1",
          expectedNextState: "KEEP_BLOCKED",
        },
      },
      {
        id: 400,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "4",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
      {
        id: 501,
        eventType: "HERMES_OWNER_AUTHORITY_DECISION",
        entityId: "5",
        metadata: {
          outcomeId: 5,
          terminalEventId: 500,
          decisionId: 95,
          choice: "APPROVE",
        },
      },
      {
        id: 500,
        eventType: "HERMES_OUTCOME_TERMINAL",
        entityId: "5",
        metadata: { result: "OWNER_DECISION_REQUIRED" },
      },
    ]

    expect(
      getUnresolvedAuthorityRequestGoalIds(workOrders, lifecycleEvents)
        .sort((left, right) => left - right),
    ).toEqual([
      2,
      4,
      ...Array.from({ length: 26 }, (_, index) => index + 5),
    ])

    const actionBody = authoritySource.slice(
      authoritySource.indexOf(
        "export async function getActiveGoalAuthorityRequestTimelines",
      ),
    )
    expect(actionBody).toContain(
      'eq(workOrder.result, "OWNER_DECISION_REQUIRED")',
    )
    expect(actionBody).toContain("isNull(workOrder.linkedDecisionId)")
    expect(actionBody).toContain(
      "getUnresolvedAuthorityRequestGoalIds(",
    )
    expect(actionBody).toContain(
      '"HERMES_OWNER_AUTHORITY_DECISION"',
    )
    expect(actionBody).toContain(
      '"HERMES_OUTCOME_COMPLETED"',
    )
    expect(actionBody).toContain(
      "index += AUTHORITY_REQUEST_PROJECTION_BATCH_SIZE",
    )
    expect(actionBody).toContain("getGoalTimeline(goalId)")
    expect(actionBody).toContain("getActiveGoalAuthorityRequests(candidates)")
    expect(actionBody).not.toContain("GOAL_TIMELINE_LIMIT")
    expect(actionBody).not.toContain(".limit(")
  })

  it("returns only active authority requests", () => {
    const timelines = [
      timeline(1, "ACTIONABLE"),
      timeline(2, "NOT_REQUIRED"),
      timeline(3, "RECEIPT_RECORDED"),
      timeline(4, "STALE"),
      timeline(5, "CONFLICTING"),
      timeline(6, "ACTIONABLE"),
    ]

    expect(
      getActiveGoalAuthorityRequests(timelines).map(
        (candidate) => candidate.goal.id,
      ),
    ).toEqual([1, 6])
  })

  it("builds only actionable requests with why, choices, and per-choice consequences", () => {
    const onAuthorityDecision = vi.fn()
    const items = buildNeedsMyDecisionView(
      [
        timeline(1, "ACTIONABLE"),
        timeline(2, "STALE"),
        timeline(3, "CONFLICTING"),
        timeline(4, "RECEIPT_RECORDED"),
      ],
      onAuthorityDecision,
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "goal-timeline:1",
      title: "Outcome needing decision 1",
      whyNeeded: "Authority boundary 1",
      blockedAction: "Blocked action 1",
      goalRef: "GOAL-1",
      outcomeRef: "OUTCOME-1",
      workOrderRef: "WO-1",
      expectedNextState: "NEXT-1",
    })
    expect(
      items[0].choices.map(({ choice, label, consequence }) => ({
        choice,
        label,
        consequence,
      })),
    ).toEqual([
      {
        choice: "APPROVE",
        label: "Approve resume",
        consequence: "Approve consequence 1",
      },
      {
        choice: "DENY",
        label: "Deny keep blocked",
        consequence: "Deny consequence 1",
      },
    ])
  })

  it("submits the exact request and choice from each action", () => {
    const actionable = timeline(7, "ACTIONABLE")
    const onAuthorityDecision = vi.fn()
    const [item] = buildNeedsMyDecisionView(
      [actionable],
      onAuthorityDecision,
    )

    item.choices.forEach((choice) => choice.select())

    expect(onAuthorityDecision).toHaveBeenNthCalledWith(
      1,
      actionable,
      "APPROVE",
    )
    expect(onAuthorityDecision).toHaveBeenNthCalledWith(
      2,
      actionable,
      "DENY",
    )
  })

  it("removes a request after its refreshed projection records a receipt", () => {
    const onAuthorityDecision = vi.fn()
    expect(
      buildNeedsMyDecisionView(
        [timeline(9, "ACTIONABLE")],
        onAuthorityDecision,
      ),
    ).toHaveLength(1)

    expect(
      buildNeedsMyDecisionView(
        [timeline(9, "RECEIPT_RECORDED")],
        onAuthorityDecision,
      ),
    ).toEqual([])
  })

  it("wires the pure view model into the visible panel", () => {
    const panelSource = readFileSync(
      "components/goal-console/needs-my-decision-panel.tsx",
      "utf8",
    )

    expect(panelSource).toContain("buildNeedsMyDecisionView(")
    expect(panelSource).toContain("Why this decision is needed")
    expect(panelSource).toContain("item.whyNeeded")
    expect(panelSource).toContain("item.choices.map")
    expect(panelSource).toContain("option.consequence")
    expect(panelSource).toContain("onClick={option.select}")
    expect(panelSource).toContain("No active authority requests")
  })

  it("loads and refreshes the dedicated aggregate request source", () => {
    expect(pageSource).toContain("getActiveGoalAuthorityRequestTimelines()")
    expect(pageSource).toContain("initialAuthorityRequests={authorityRequests}")
    expect(viewSource).toContain(
      "const [authorityRequestTimelines, setAuthorityRequestTimelines] = useState(",
    )
    expect(viewSource).toContain(
      "const refreshAuthorityRequestTimelines = useCallback(async () =>",
    )
    expect(viewSource).toContain(
      "AUTHORITY_REQUEST_REFRESH_INTERVAL_MS = 60_000",
    )
    expect(viewSource).toContain(
      "await refreshAuthorityRequestTimelines()",
    )
    const backgroundPoll = viewSource.slice(
      viewSource.indexOf("void refreshAuthorityRequestTimelines().catch"),
      viewSource.indexOf("function handleTimelineRefresh"),
    )
    expect(backgroundPoll).toContain(
      "void refreshAuthorityRequestTimelines().catch",
    )
    expect(backgroundPoll).not.toContain("startTransition")
    expect(viewSource).toContain("timelines={authorityRequestTimelines}")
    expect(viewSource).not.toContain("timelines={goalTimelines.values()}")
  })
})
