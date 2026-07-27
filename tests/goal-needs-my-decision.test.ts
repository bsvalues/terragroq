import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

import {
  buildNeedsMyDecisionView,
  getActiveGoalAuthorityRequests,
} from "@/components/goal-console/active-goal-authority-requests"
import type {
  GoalTimelineDecisionRequest,
  GoalTimelineProjection,
} from "@/components/goal-console/goal-timeline-read-model"

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
})
