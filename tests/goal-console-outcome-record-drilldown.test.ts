import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

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
const auditSource = readFileSync("app/(shell)/audit/page.tsx", "utf8")

describe("Goal Console outcome supporting-record drill-down", () => {
  it("loads timeline evidence for every queue Goal in bounded batches", () => {
    expect(pageSource).toContain("getGoalTimelinesByIds")
    expect(pageSource).toContain("GOAL_TIMELINE_BATCH_SIZE = 25")
    expect(pageSource).toContain("timelines={supportingTimelines}")
    expect(pageSource).toContain("initialGoalId={initialGoalId}")
  })

  it("renders a labelled row-level record navigation only when links exist", () => {
    expect(queuePanelSource).toContain("projectOutcomeQueueSupportingRecordLinks")
    expect(queuePanelSource).toContain("supportingRecordLinks.length > 0")
    expect(queuePanelSource).toContain("aria-label={`Supporting records for ${row.title}`}")
    expect(queuePanelSource).toContain("Linked records")
    expect(queuePanelSource).toContain("link.records.map")
    expect(queuePanelSource).toContain("{record.reference}")
    expect(queuePanelSource).toContain("Open the read-only")
  })

  it("provides stable read-only targets for every projected record surface", () => {
    expect(goalConsoleSource).toContain("DURABLE_RECORD_ANCHORS.goal")
    expect(workOrdersSource).toContain("DURABLE_RECORD_ANCHORS.workOrder")
    expect(traceSource).toContain("DURABLE_RECORD_ANCHORS.trace")
    expect(auditSource).toContain("DURABLE_RECORD_ANCHORS.audit")
    expect(auditSource).toContain('id="persisted-evidence-truth-title"')
  })
})
