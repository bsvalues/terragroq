import { describe, expect, it } from "vitest"
import { buildWorkbenchModel } from "@/lib/workbench/workbench-model"
import type { OperatorState } from "@/lib/operator/operator-state"
import type { ActivityFeed } from "@/lib/operator/activity"

const stamp = "2026-08-14T06:00:00.000Z"
const envelope = <T>(value: T) => ({ value, truthState: "live" as const, source: "test", observedAt: stamp, freshness: "current" })

describe("workbench model", () => {
  it("projects durable work as threads without fabricating project membership", () => {
    const state = {
      installation: "WILLIAMOS_PRIMARY",
      now: envelope({ activeExecutions: 0, queueDepth: 0 }),
      projects: envelope([{ key: "william-os", name: "WilliamOS", lifecycle: "active" as const, resources: [] }]),
      outcomes: envelope([]),
      work: envelope([{ id: 42, ref: "WO-0042", title: "Recompose the shell", status: "closed", closedAt: new Date(stamp) }]),
      executions: envelope([{ id: "exec:42", outcomeId: 42, outcomeIdentity: "OUTCOME-42", workOrderRef: "WO-0042", attempt: 1, attemptStatus: "delivered" as const, outcomeStatus: "delivered", coordinator: "HERMES", node: "AEGIS", worker: "Codex", events: 7, failureEvals: 0, delivery: { prNumber: 812, mergeSha: "abcdef123456", branch: "codex/workbench" } }]),
      recentActivity: envelope([]),
      needsWilliam: envelope([]),
      governance: envelope({ foundingADRs: [] }),
      knowledge: envelope({ canonical: 0, memory: 1, documents: 2, evidence: 3, governance: 4 }),
      systems: { ...envelope([{ node: "ATLAS", role: "state", status: "healthy" as const, detail: "live — query returned" }]), truthState: "inferred" as const },
    } satisfies OperatorState
    const activity: ActivityFeed = { items: [{ id: 9, at: stamp, kind: "delivery", label: "Delivered", detail: "WO-0042 · PR #812", ref: "WO-0042" }], churnCollapsed: 2, source: "test", latestEventAt: stamp, observedAt: stamp, truthState: "persisted" }

    const model = buildWorkbenchModel(state, activity)
    expect(model.threads[0]).toMatchObject({ id: "work:42", ref: "WO-0042", state: "completed", projectKey: null, latestAt: stamp })
    expect(model.threads[0].artifacts).toEqual([{ id: "delivery:PR #812", kind: "delivery", label: "PR #812", detail: "merge abcdef1" }])
    expect(model.projects[0].threadIds).toEqual([])
  })
})
