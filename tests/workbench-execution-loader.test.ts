import { describe, expect, it, vi } from "vitest"

import {
  WORKBENCH_EXECUTION_SOURCE_LIMIT,
  loadAuthenticatedWorkbenchExecution,
  type WorkbenchExecutionRepository,
} from "@/lib/workbench/load-execution"

const at = (value: string) => new Date(value)

function repository(overrides: Partial<WorkbenchExecutionRepository> = {}): WorkbenchExecutionRepository {
  return {
    getScope: vi.fn(async () => ({ projectId: 7, threadId: "thread-a", userId: "owner" })),
    listBindings: vi.fn(async () => [{ threadId: "thread-a", userId: "owner", sourceType: "outcome" as const, sourceId: "OUT-7", role: "root" as const }]),
    listGoals: vi.fn(async () => [{ id: 4, userId: "owner", linkedWorkOrderId: 12, updatedAt: at("2026-08-14T11:00:00Z") }]),
    listOutcomes: vi.fn(async () => [{
      id: 9, userId: "owner", outcomeKey: "OUT-7", goalId: 4, title: "Usable cockpit", lifecycleState: "active",
      activeWorkOrderId: 11, leaseHolder: "hermes",
      leaseExpiresAt: at("2026-08-14T13:00:00Z"), terminalEvidenceId: 61, updatedAt: at("2026-08-14T12:10:00Z"),
    }]),
    listWorkOrders: vi.fn(async () => [
      { id: 11, userId: "owner", ref: "WO-11", status: "active", assignee: "hermes", agent: "codex", updatedAt: at("2026-08-14T12:11:00Z") },
      { id: 12, userId: "owner", ref: "WO-12", status: "review", assignee: null, agent: null, updatedAt: at("2026-08-14T12:12:00Z") },
    ]),
    listClaims: vi.fn(async () => []),
    listLoops: vi.fn(async () => []),
    listEvidence: vi.fn(async () => []),
    listGovernanceEvents: vi.fn(async () => []),
    listAuditEvents: vi.fn(async () => []),
    listAcquisitionAttempts: vi.fn(async () => []),
    ...overrides,
  }
}

describe("authenticated Workbench Execution loader", () => {
  it("traverses exact bindings and foreign keys in bounded batches", async () => {
    const repo = repository()
    const authenticate = vi.fn(async () => "owner")

    const result = await loadAuthenticatedWorkbenchExecution(7, "thread-a", {
      authenticate,
      repository: repo,
      clock: () => at("2026-08-14T12:30:00Z"),
    })

    expect(authenticate).toHaveBeenCalledOnce()
    expect(repo.getScope).toHaveBeenCalledWith("owner", 7, "thread-a")
    expect(repo.listBindings).toHaveBeenCalledWith("owner", "thread-a", WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listOutcomes).toHaveBeenCalledWith("owner", { outcomeKeys: ["OUT-7"], goalIds: [] }, WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listGoals).toHaveBeenCalledWith("owner", [4], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11, 12], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listClaims).toHaveBeenCalledWith("owner", [11, 12], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listLoops).toHaveBeenCalledWith("owner", [11, 12], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listEvidence).toHaveBeenCalledWith("owner", [11, 12], [61], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listGovernanceEvents).toHaveBeenCalledWith("owner", { goalIds: [4], outcomeKeys: ["OUT-7"], workOrderIds: [11, 12] }, WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listAuditEvents).toHaveBeenCalledWith("owner", { goalIds: [4], outcomeKeys: ["OUT-7"], workOrderIds: [11, 12] }, WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(repo.listAcquisitionAttempts).toHaveBeenCalledWith("owner", ["OUT-7"], [11, 12], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(result.availability).toBe("available")
    expect(result.work.workOrders.map((row) => row.id)).toEqual([12, 11])
  })

  it("fails closed before dependent reads when scope or root ownership is unavailable", async () => {
    const missingScope = repository({ getScope: vi.fn(async () => null) })
    const missing = await loadAuthenticatedWorkbenchExecution(7, "thread-a", {
      authenticate: async () => "intruder", repository: missingScope,
    })
    expect(missing.availability).toBe("unavailable")
    expect(missingScope.listBindings).not.toHaveBeenCalled()

    const noRoot = repository({ listBindings: vi.fn(async () => [{ threadId: "thread-a", userId: "owner", sourceType: "goal" as const, sourceId: "4", role: "member" as const }]) })
    const rootless = await loadAuthenticatedWorkbenchExecution(7, "thread-a", {
      authenticate: async () => "owner", repository: noRoot,
    })
    expect(rootless.availability).toBe("unavailable")
    expect(noRoot.listGoals).not.toHaveBeenCalled()
    expect(rootless.coverage.conflicts).toContain("ROOT_BINDING_MISSING:thread-a")
  })

  it("drops foreign/unlinked rows, never derives targets from names, and reports every bounded source", async () => {
    const sentinel = Array.from({ length: WORKBENCH_EXECUTION_SOURCE_LIMIT + 1 }, (_, index) => ({
      id: index + 1, userId: "owner", entityType: "work_order", entityId: "11", eventType: "CI_PASSED",
      reason: null, metadata: { checkpointState: "CI_PASSED" }, createdAt: at("2026-08-14T12:00:00Z"),
    }))
    const repo = repository({
      listGoals: vi.fn(async () => [{ id: 4, userId: "other", linkedWorkOrderId: 999, updatedAt: at("2026-08-14T11:00:00Z") }]),
      listGovernanceEvents: vi.fn(async () => sentinel),
    })

    const result = await loadAuthenticatedWorkbenchExecution(7, "thread-a", {
      authenticate: async () => "owner", repository: repo,
    })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11], WORKBENCH_EXECUTION_SOURCE_LIMIT + 1)
    expect(JSON.stringify(result)).not.toContain("999")
    expect(result.coverage.truncatedKinds).toContain("governance_event")
    expect(result.events).toHaveLength(WORKBENCH_EXECUTION_SOURCE_LIMIT)
  })

  it("returns a data-free degraded projection when an authenticated source read fails", async () => {
    const repo = repository({ getScope: vi.fn(async () => { throw new Error("database unavailable") }) })

    const result = await loadAuthenticatedWorkbenchExecution(7, "thread-a", {
      authenticate: async () => "owner", repository: repo,
      clock: () => at("2026-08-14T12:30:00Z"),
    })

    expect(result.availability).toBe("degraded")
    expect(result.truthState).toBe("unknown")
    expect(result.observedAt).toBe("2026-08-14T12:30:00.000Z")
    expect(result.work).toEqual({ outcomes: [], workOrders: [] })
  })
})
