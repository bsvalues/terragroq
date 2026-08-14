import { describe, expect, it, vi } from "vitest"

import {
  loadAuthenticatedWorkbenchThreads,
  type WorkbenchThreadRepository,
} from "@/lib/workbench/load-threads"

const at = (value: string) => new Date(value)

function repository(overrides: Partial<WorkbenchThreadRepository> = {}): WorkbenchThreadRepository {
  return {
    getProject: vi.fn(async () => ({ id: 7, userId: "owner", key: "WOS", name: "WilliamOS" })),
    listThreads: vi.fn(async () => [{
      id: "thread-a", userId: "owner", projectId: 7, title: "Ship cockpit",
      createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-10T00:00:00Z"),
    }]),
    listRootBindings: vi.fn(async () => [
      { threadId: "thread-a", userId: "owner", sourceType: "outcome" as const, sourceId: "OUT-7", role: "root" as const },
    ]),
    listMemberBindings: vi.fn(async () => []),
    listGoals: vi.fn(async () => [{
      id: 4, userId: "owner", ref: "GOAL-4", command: "Ship the cockpit", rationale: "Accepted",
      recommendedMove: null, verdict: "allow", linkedWorkOrderId: 12,
      createdAt: at("2026-08-01T01:00:00Z"), updatedAt: at("2026-08-01T02:00:00Z"),
    }]),
    listOutcomes: vi.fn(async () => [{
      id: 9, userId: "owner", outcomeKey: "OUT-7", goalId: 4, title: "Usable cockpit",
      objective: "Deliver the operator workflow", lifecycleState: "active", activeWorkOrderId: 11,
      approvalDecisionId: 3, terminalEvidenceId: null,
      createdAt: at("2026-08-02T00:00:00Z"), updatedAt: at("2026-08-09T00:00:00Z"),
    }]),
    listWorkOrders: vi.fn(async () => [
      { id: 11, userId: "owner", ref: "WO-11", title: "Implementation", description: "Build it", status: "active", result: null, linkedDecisionId: null, createdAt: at("2026-08-03T00:00:00Z"), updatedAt: at("2026-08-08T00:00:00Z") },
      { id: 12, userId: "owner", ref: "WO-12", title: "Governance", description: "Review it", status: "review", result: null, linkedDecisionId: 5, createdAt: at("2026-08-03T01:00:00Z"), updatedAt: at("2026-08-08T01:00:00Z") },
    ]),
    listDecisions: vi.fn(async () => [
      { id: 3, userId: "owner", ref: "ADR-3", title: "Approve outcome", decision: "Proceed", status: "accepted", authority: "binding", createdAt: at("2026-08-02T01:00:00Z"), updatedAt: at("2026-08-02T01:00:00Z") },
      { id: 5, userId: "owner", ref: "ADR-5", title: "Review policy", decision: "Sovereign review", status: "accepted", authority: "binding", createdAt: at("2026-08-04T00:00:00Z"), updatedAt: at("2026-08-04T00:00:00Z") },
    ]),
    listEvidence: vi.fn(async () => [{
      id: 21, userId: "owner", ref: "EV-21", workOrderId: 11, result: "PASS", notes: "Focused tests passed",
      validators: ["pnpm test"], contentHash: "sha256:abc", artifactPath: "C:/secret/evidence.json",
      createdAt: at("2026-08-09T01:00:00Z"),
    }]),
    listGovernanceEvents: vi.fn(async () => [{
      id: 31, userId: "owner", ref: "GEV-31", entityType: "work_order", entityId: "11",
      eventType: "CI_PASSED", reason: "Validation complete", metadata: { checkpointState: "CI_PASSED", token: "secret", mirrorKey: "receipt-1" },
      createdAt: at("2026-08-09T02:00:00Z"),
    }]),
    listAuditEvents: vi.fn(async () => [{
      id: 32, userId: "owner", type: "CI_PASSED", summary: "Validation complete", register: "work-orders", refId: 11,
      metadata: { checkpointState: "CI_PASSED", password: "secret", mirrorKey: "receipt-1" },
      createdAt: at("2026-08-09T02:00:00Z"),
    }]),
    ...overrides,
  }
}

describe("loadAuthenticatedWorkbenchThreads", () => {
  it("authenticates, traverses only explicit durable edges in bounded batches, and preserves link conflicts", async () => {
    const repo = repository()
    const authenticate = vi.fn(async () => "owner")

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate, repository: repo })

    expect(authenticate).toHaveBeenCalledOnce()
    expect(repo.getProject).toHaveBeenCalledWith("owner", 7)
    expect(repo.listThreads).toHaveBeenCalledWith("owner", 7, 51)
    expect(repo.listRootBindings).toHaveBeenCalledWith("owner", ["thread-a"])
    expect(repo.listMemberBindings).toHaveBeenCalledWith("owner", ["thread-a"], 501)
    expect(repo.listOutcomes).toHaveBeenCalledWith("owner", { sourceIds: ["OUT-7"], goalIds: [] }, 501)
    expect(repo.listGoals).toHaveBeenCalledWith("owner", [4], 501)
    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11, 12], 501)
    expect(repo.listDecisions).toHaveBeenCalledWith("owner", [3, 5], 501)
    expect(repo.listEvidence).toHaveBeenCalledWith("owner", [11, 12], [], 501)
    expect(repo.listGovernanceEvents).toHaveBeenCalledOnce()
    expect(repo.listAuditEvents).toHaveBeenCalledOnce()

    expect(result).toHaveLength(1)
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "outcome_queue_item:OUT-7", "goal:4", "work_order:11", "work_order:12",
      "decision:3", "decision:5", "evidence_record:21", "governance_event:31",
    ]))
    expect(result[0].coverage.conflicts).toContain("LINK_CONFLICT:goal:4:work_order")
    expect(result[0].items.filter((item) => item.rawState === "CI_PASSED")).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("artifactPath")
    expect(result[0].items.find((item) => item.source.kind === "goal")?.source.drilldown).toEqual({
      mode: "EXACT",
      href: "/goal-console?goal=4#goal-delivery-timeline",
    })
    expect(result[0].items.find((item) => item.source.kind === "work_order")?.source.drilldown).toEqual({
      mode: "EXACT",
      href: "/work-orders#work-order-11",
    })
    expect(result[0].items.find((item) => item.source.kind === "evidence_record")?.source.drilldown).toEqual({
      mode: "EXACT",
      href: "/audit?evidence=evidence%3A21#evidence-record-evidence-21",
    })
  })

  it("deduplicates an audit mirror by its explicit governance event id", async () => {
    const repo = repository({
      listGovernanceEvents: vi.fn(async () => [{
        id: 31, userId: "owner", ref: "GEV-31", entityType: "work_order", entityId: "11",
        eventType: "CI_PASSED", reason: "Validation complete", metadata: { checkpointState: "CI_PASSED" },
        createdAt: at("2026-08-09T02:00:00Z"),
      }]),
      listAuditEvents: vi.fn(async () => [{
        id: 32, userId: "owner", type: "CI_PASSED", summary: "Validation complete", register: "work-orders", refId: 11,
        metadata: { checkpointState: "CI_PASSED", governanceEventId: 31 },
        createdAt: at("2026-08-09T02:00:00Z"),
      }]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result[0].items.filter((item) => item.rawState === "CI_PASSED")).toHaveLength(1)
    expect(result[0].coverage.conflicts).not.toContain("MIRROR_CONFLICT:governance_event:31")
  })

  it("includes native outcome governance and audit history through canonical explicit identities", async () => {
    const repo = repository({
      listGovernanceEvents: vi.fn(async () => [{
        id: 51, userId: "owner", ref: "OUT-7", entityType: "outcome_queue_item", entityId: "OUT-7",
        eventType: "V1_2_CHILD_OUTCOME_SUGGESTED", reason: "Outcome suggested", metadata: {},
        createdAt: at("2026-08-09T03:00:00Z"),
      }]),
      listAuditEvents: vi.fn(async () => [{
        id: 52, userId: "owner", type: "outcome.suggested", summary: "Outcome suggested", register: "outcome-queue", refId: 4,
        metadata: {}, createdAt: at("2026-08-09T03:01:00Z"),
      }]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listGovernanceEvents).toHaveBeenCalledWith("owner", {
      goalIds: [4], workOrderIds: [11, 12], outcomeKeys: ["OUT-7"],
    }, 501)
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "governance_event:51", "event_log:52",
    ]))
  })

  it("does not reinterpret a numeric-looking outcome key as the outcome row id", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "outcome" as const, sourceId: "9", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result).toHaveLength(1)
    expect(result[0].items.some((item) => item.source.kind === "outcome_queue_item")).toBe(false)
    expect(result[0].coverage.missingSources).toContain("outcome_queue_item:9")
  })

  it("fails closed for a missing tenant project and never queries thread data", async () => {
    const repo = repository({ getProject: vi.fn(async () => null) })

    await expect(loadAuthenticatedWorkbenchThreads(7, {
      authenticate: async () => "intruder",
      repository: repo,
    })).resolves.toEqual([])

    expect(repo.listThreads).not.toHaveBeenCalled()
    expect(repo.listRootBindings).not.toHaveBeenCalled()
    expect(repo.listMemberBindings).not.toHaveBeenCalled()
  })

  it("drops foreign rows and never requests records from refs, titles, repo paths, or naming conventions", async () => {
    const repo = repository({
      listGoals: vi.fn(async () => [{
        id: 4, userId: "other", ref: "GOAL-4", command: "foreign", rationale: null,
        recommendedMove: null, verdict: "allow", linkedWorkOrderId: 999,
        createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-01T00:00:00Z"),
      }]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11], 501)
    expect(JSON.stringify(result)).not.toContain("999")
    expect(result[0].coverage.missingSources).toContain("goal:4")
  })

  it("marks bounded source reads as truncated and calls each table at most once for multiple threads", async () => {
    const repo = repository({
      listThreads: vi.fn(async () => Array.from({ length: 51 }, (_, index) => ({
        id: `thread-${index}`, userId: "owner", projectId: 7, title: `Thread ${index}`,
        createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-10T00:00:00Z"),
      }))),
      listRootBindings: vi.fn(async (_userId: string, threadIds: string[]) => threadIds.map((threadId: string, index: number) => ({
        threadId, userId: "owner", sourceType: "goal" as const, sourceId: String(index + 1), role: "root" as const,
      }))),
      listGoals: vi.fn(async (_userId: string, ids: number[]) => ids.map((id: number) => ({
        id, userId: "owner", ref: null, command: `Goal ${id}`, rationale: null, recommendedMove: null,
        verdict: "allow", linkedWorkOrderId: null, createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-01T00:00:00Z"),
      }))),
      listOutcomes: vi.fn(async () => []), listWorkOrders: vi.fn(async () => []), listDecisions: vi.fn(async () => []),
      listEvidence: vi.fn(async () => []), listGovernanceEvents: vi.fn(async () => []), listAuditEvents: vi.fn(async () => []),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result).toHaveLength(50)
    expect(repo.listGoals).toHaveBeenCalledOnce()
    expect(repo.listOutcomes).toHaveBeenCalledOnce()
    expect(result.every((thread) => thread.coverage.truncated)).toBe(true)
  })

  it("keeps a durable Thread visible when its root is missing instead of hiding history", async () => {
    const repo = repository({ listRootBindings: vi.fn(async () => []) })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result).toHaveLength(1)
    expect(result[0].items).toEqual([])
    expect(result[0].coverage.conflicts).toContain("ROOT_BINDING_MISSING:thread-a")
  })
})
