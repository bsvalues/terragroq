import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { resolveInitialGoalRequest } from "@/components/goal-console/initial-goal-selection"
import { requestedGoalId } from "@/components/goal-console/requested-goal-id"
import {
  SupportingRecordCoverageNotice,
  supportingRecordCoverageStatus,
} from "@/components/outcome-queue/supporting-record-coverage-notice"
import {
  GOAL_TIMELINE_BATCH_SIZE,
  GOAL_TIMELINE_LOAD_LIMIT,
  loadGoalTimelineBatches,
  planMissingGoalTimelines,
  prioritizeQueueGoalIds,
  unavailableGoalTimelineIds,
} from "@/components/outcome-queue/supporting-timeline-loader"

const pageSource = readFileSync("app/(shell)/goal-console/page.tsx", "utf8")
const queuePanelSource = readFileSync(
  "components/outcome-queue/operator-outcome-queue-panel.tsx",
  "utf8",
)
const goalConsoleSource = readFileSync(
  "components/goal-console/goal-console-view.tsx",
  "utf8",
)
const workOrdersSource = readFileSync(
  "components/work-orders/work-orders-view.tsx",
  "utf8",
)
const traceSource = readFileSync(
  "components/trace/runtime-trace-panel.tsx",
  "utf8",
)
const tracePageSource = readFileSync("app/(shell)/trace/page.tsx", "utf8")
const traceQuerySource = readFileSync(
  "app/(shell)/trace/durable-trace-query.ts",
  "utf8",
)
const auditSource = readFileSync("app/(shell)/audit/page.tsx", "utf8")
const auditQuerySource = readFileSync(
  "app/(shell)/audit/durable-record-query.ts",
  "utf8",
)
const evidenceRecordPanelSource = readFileSync(
  "components/evidence/durable-record-panels.tsx",
  "utf8",
)
const traceRecordPanelSource = readFileSync(
  "components/trace/durable-trace-record-panel.tsx",
  "utf8",
)

describe("Goal Console outcome supporting-record drill-down", () => {
  it("loads a bounded set of missing queue Goal timelines in sequential batches", () => {
    expect(pageSource).toContain("getGoalTimelinesByIds")
    expect(pageSource).toContain("planMissingGoalTimelines")
    expect(pageSource).toContain("loadGoalTimelineBatches")
    expect(pageSource).not.toContain("missingTimelineBatches.map")
    expect(pageSource).toContain("timelines={supportingTimelines}")
    expect(pageSource).toContain("initialGoalId={initialGoalId}")
    expect(pageSource).toContain("requestedGoalId((await searchParams).goal)")
  })

  it("accepts only one canonical positive safe Goal query id", () => {
    expect(requestedGoalId("8")).toBe(8)
    expect(requestedGoalId(" 8 ")).toBe(8)
    expect(requestedGoalId(["8"])).toBe(8)
    expect(requestedGoalId(undefined)).toBeNull()
    expect(requestedGoalId([])).toBeNull()
    expect(requestedGoalId("")).toBeNull()
    expect(requestedGoalId("0")).toBeNull()
    expect(requestedGoalId("-1")).toBeNull()
    expect(requestedGoalId("1.5")).toBeNull()
    expect(requestedGoalId("08")).toBeNull()
    expect(requestedGoalId("not-a-goal")).toBeNull()
    expect(requestedGoalId(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull()
    expect(requestedGoalId(["8", "8"])).toBeNull()
    expect(requestedGoalId(["8", "9"])).toBeNull()
  })

  it("caps total work while rendering an explicit boundary after Goal 50", async () => {
    const beyondOneBatch = planMissingGoalTimelines(
      Array.from({ length: 26 }, (_, index) => index + 1),
      [],
    )
    const beyondTotalLimit = planMissingGoalTimelines(
      Array.from({ length: 51 }, (_, index) => index + 1),
      [],
    )

    expect(GOAL_TIMELINE_BATCH_SIZE).toBe(25)
    expect(GOAL_TIMELINE_LOAD_LIMIT).toBe(50)
    expect(beyondOneBatch.batches.map((batch) => batch.length)).toEqual([25, 1])
    expect(beyondOneBatch.truncated).toBe(false)
    expect(beyondTotalLimit.batches.map((batch) => batch.length)).toEqual([25, 25])
    expect(beyondTotalLimit.selectedGoalIds).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(beyondTotalLimit.truncated).toBe(true)

    const coverage = {
      coveredGoalIds: beyondTotalLimit.selectedGoalIds,
      unavailableGoalIds: [],
      truncated: beyondTotalLimit.truncated,
    }
    expect(supportingRecordCoverageStatus(50, coverage)).toBeNull()
    const boundaryStatus = supportingRecordCoverageStatus(51, coverage)
    expect(boundaryStatus).toBe("DEFERRED")
    const boundaryMarkup = renderToStaticMarkup(createElement(
      SupportingRecordCoverageNotice,
      { goalId: 51, coverage },
    ))
    expect(boundaryMarkup).toContain('data-supporting-record-coverage="deferred"')
    expect(boundaryMarkup).toContain("Supporting-record detail deferred")
    expect(boundaryMarkup).toContain("missing links are not evidence that no records exist")
    const unavailableMarkup = renderToStaticMarkup(createElement(
      SupportingRecordCoverageNotice,
      {
        goalId: 50,
        coverage: {
          ...coverage,
          unavailableGoalIds: [50],
        },
      },
    ))
    expect(unavailableMarkup).toContain('data-supporting-record-coverage="unavailable"')
    expect(unavailableMarkup).toContain("Supporting-record detail unavailable")
    expect(unavailableMarkup).toContain("no substitute records were inferred")

    let activeLoads = 0
    let maximumConcurrentLoads = 0
    const calls: number[][] = []
    const loaded = await loadGoalTimelineBatches(beyondTotalLimit.batches, async (goalIds) => {
      activeLoads += 1
      maximumConcurrentLoads = Math.max(maximumConcurrentLoads, activeLoads)
      calls.push(goalIds)
      await Promise.resolve()
      activeLoads -= 1
      return goalIds
    })

    expect(calls).toEqual(beyondTotalLimit.batches)
    expect(maximumConcurrentLoads).toBe(1)
    expect(loaded.records).toHaveLength(50)
    expect(loaded.failedGoalIds).toEqual([])
  })

  it("prioritizes a live Goal after more than 50 terminal rows", () => {
    const terminalRows = Array.from({ length: 51 }, (_, index) => ({
      goalId: index + 1,
      isActive: false,
      isNextEligible: false,
      lifecycleState: "completed",
    }))
    const liveGoalId = 900
    const queueGoalIds = prioritizeQueueGoalIds([
      ...terminalRows,
      {
        goalId: liveGoalId,
        isActive: true,
        isNextEligible: false,
        lifecycleState: "active",
      },
    ])
    const plan = planMissingGoalTimelines(queueGoalIds, [])

    expect(queueGoalIds[0]).toBe(liveGoalId)
    expect(plan.selectedGoalIds).toContain(liveGoalId)
    expect(plan.selectedGoalIds).toEqual([
      liveGoalId,
      ...Array.from({ length: 49 }, (_, index) => index + 1),
    ])
    expect(plan.selectedGoalIds).not.toContain(50)
    expect(plan.truncated).toBe(true)
  })

  it("preserves successful batches and marks every failed-batch Goal unavailable", async () => {
    const firstBatch = Array.from({ length: 25 }, (_, index) => index + 1)
    const secondBatch = Array.from({ length: 25 }, (_, index) => index + 26)
    const loaded = await loadGoalTimelineBatches(
      [firstBatch, secondBatch],
      async (goalIds) => {
        if (goalIds[0] === firstBatch[0]) throw new Error("batch unavailable")
        return goalIds
      },
    )

    expect(loaded.records).toEqual(secondBatch)
    expect(loaded.failedGoalIds).toEqual(firstBatch)
    expect(unavailableGoalTimelineIds(
      [...firstBatch, ...secondBatch],
      loaded.records,
      loaded.failedGoalIds,
    )).toEqual(firstBatch)
    expect(pageSource).toContain("additionalTimelineLoad.failedGoalIds")
  })

  it("re-applies A after A to B to unavailable to A without refresh resets", () => {
    let lastRequestedGoalId: number | null = null
    const resolve = (requestedGoalId: number, exists: boolean) => {
      const resolution = resolveInitialGoalRequest(
        lastRequestedGoalId,
        requestedGoalId,
        exists,
      )
      lastRequestedGoalId = resolution.lastRequestedGoalId
      return resolution.goalIdToApply
    }

    expect(resolve(8, true)).toBe(8)
    expect(resolve(9, true)).toBe(9)
    expect(resolve(404, false)).toBeNull()
    expect(lastRequestedGoalId).toBeNull()
    expect(resolve(8, true)).toBe(8)
    expect(resolve(8, true)).toBeNull()

    expect(goalConsoleSource).toContain("lastRequestedInitialGoalId")
    expect(goalConsoleSource.indexOf("const requestedGoal =")).toBeLessThan(
      goalConsoleSource.indexOf("resolveInitialGoalRequest("),
    )
    expect(goalConsoleSource).toContain(
      "initialGoals.find((goal) => goal.id === current.id) ?? current",
    )
  })

  it("renders a labelled row-level record navigation only when links exist", () => {
    expect(queuePanelSource).toContain("projectOutcomeQueueSupportingRecordLinks")
    expect(queuePanelSource).toContain("supportingRecordLinks.length > 0")
    expect(queuePanelSource).toContain("aria-label={`Supporting records for ${row.title}`}")
    expect(queuePanelSource).toContain("Linked records")
    expect(queuePanelSource).toContain("link.records.map")
    expect(queuePanelSource).toContain("{record.reference}")
    expect(queuePanelSource).toContain("record.href ?")
    expect(queuePanelSource).toContain("Open exact")
    expect(queuePanelSource).toContain("Open the read-only")
    expect(queuePanelSource).toContain("SupportingRecordCoverageNotice")
    expect(pageSource).toContain("supportingTimelineCoverage={supportingTimelineCoverage}")
    expect(queuePanelSource).toContain("indexGoalTimelinesById")
    expect(queuePanelSource).toContain("timelinesByGoalId.get(row.goalId)")
    expect(queuePanelSource).not.toContain(
      "projectOutcomeQueueSupportingRecordLinks(row, timelines)",
    )
    expect(queuePanelSource).toContain('WORK_ORDER: "work order"')
    expect(queuePanelSource).not.toContain("link.kind.toLowerCase()")
  })

  it("loads exact user-scoped Evidence, Trace, and Audit records through bounded reads", () => {
    expect(goalConsoleSource).toContain("DURABLE_RECORD_ANCHORS.goal")
    expect(workOrdersSource).toContain("DURABLE_RECORD_ANCHORS.workOrder")
    expect(traceSource).toContain("DURABLE_RECORD_ANCHORS.trace")
    expect(auditSource).toContain("DURABLE_RECORD_ANCHORS.audit")
    expect(auditSource).toContain('id="persisted-evidence-truth-title"')
    expect(auditSource).toContain("getDurableEvidenceRecord")
    expect(auditSource).toContain("getDurableAuditRecord")
    expect(tracePageSource).toContain("getDurableTraceRecord")
    expect(auditQuerySource).toContain("eq(evidenceRecord.userId, userId)")
    expect(auditQuerySource).toContain("eq(eventLog.userId, userId)")
    expect(traceQuerySource).toContain("eq(governanceEvent.userId, userId)")
    expect(auditQuerySource).toContain("DURABLE_RECORD_MATCH_LIMIT")
    expect(traceQuerySource).toContain("DURABLE_TRACE_MATCH_LIMIT")
    expect(auditQuerySource).toContain("matches.length === 1 ? matches[0] : null")
    expect(traceQuerySource).toContain("matches.length === 1 ? matches[0] : null")
    expect(traceQuerySource).toContain("RUNTIME_CHECKPOINT_EVENT")
    expect(traceQuerySource).toContain("RUNTIME_FAILURE_EVENT")
    expect(traceQuerySource).not.toContain("RUNTIME_LEASE_EVENT")
  })

  it("visibly identifies an exact record and fails closed when it cannot resolve", () => {
    expect(evidenceRecordPanelSource).toContain("Exact durable Evidence record")
    expect(evidenceRecordPanelSource).toContain("Exact durable Audit record")
    expect(evidenceRecordPanelSource).toContain("No broader or substitute record was displayed.")
    expect(evidenceRecordPanelSource).toContain("evidence:${record.id}")
    expect(evidenceRecordPanelSource).toContain("audit:${record.id}")
    expect(traceRecordPanelSource).toContain("Exact durable Trace record")
    expect(traceRecordPanelSource).toContain("trace:${record.id}")
    expect(traceRecordPanelSource).toContain("No broader or substitute record was displayed.")
  })
})
