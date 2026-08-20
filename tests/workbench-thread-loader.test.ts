import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  loadAuthenticatedWorkbenchThreads,
  type WorkbenchThreadRepository,
} from "@/lib/workbench/load-threads"
import { primaryDecisionRequestDigest } from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

const at = (value: string) => new Date(value)
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
function runtimeFindingFixture() {
  const sourceMetadata = { findingId: "FINDING-11", objectiveWorkOrderId: "WO-11", sequence: 1 }
  const gateBinding = {
    sourceFindingEventId: 442, sourceUserId: "owner", findingId: "FINDING-11", objectiveWorkOrderId: "WO-11",
    issueNumber: 911, gate: "POLICY", gates: ["POLICY"], reason: "policy change",
  }
  const gateMetadata = { ...gateBinding, payloadDigest: sha256(JSON.stringify(gateBinding)) }
  const decisionPacket = {
    blockedAction: "Materialize gated work", authorityBoundary: "Owner authority required",
    approveConsequence: "Record authority only", denyConsequence: "Resolve denied",
    minimumChoice: "APPROVE_OR_DENY",
  }
  const projection = {
    id: "RUNTIME_FINDING_ACTIONABILITY_V1", version: 1, parentWorkOrderRowId: 11, parentWorkOrderRef: "WO-11",
    authorityGrantId: 18, authorityGrantRef: "GRANT-0018", sourceFindingEventId: 442,
    authorityGrantLevel: "A2_WRITE_OWN",
    gateSettlementEventId: 501, findingId: "FINDING-11", sequence: 1, gates: ["POLICY"], routineSiblingState: "SETTLED",
  }
  const request = {
    sourceKind: "RUNTIME_FINDING", ownerUserId: "owner", parentWorkOrderRowId: 11, parentWorkOrderRef: "WO-11",
    authorityGrantId: 18, authorityGrantRef: "GRANT-0018", authorityGrantLevel: "A2_WRITE_OWN",
    sourceFindingEventId: 442, sourcePayloadDigest: sha256(JSON.stringify(sourceMetadata)),
    gateSettlementEventId: 501, gatePayloadDigest: gateMetadata.payloadDigest,
    actionableProjectionId: projection.id, actionableProjectionVersion: projection.version,
    actionableProjectionDigest: sha256(canonical(projection)), findingId: "FINDING-11", sequence: 1,
    gate: "POLICY", gates: ["POLICY"], allowedChoices: ["APPROVE", "DENY"], recommendation: "DENY",
    recommendationRationale: "Default deny", decisionPacket, decisionPacketDigest: sha256(JSON.stringify(decisionPacket)),
  }
  const receiptPayload = {
    sourceKind: request.sourceKind, ownerUserId: request.ownerUserId,
    parentWorkOrderRowId: request.parentWorkOrderRowId, parentWorkOrderRef: request.parentWorkOrderRef,
    authorityGrantId: request.authorityGrantId, authorityGrantRef: request.authorityGrantRef,
    authorityGrantLevel: request.authorityGrantLevel, sourceFindingEventId: request.sourceFindingEventId,
    sourcePayloadDigest: request.sourcePayloadDigest, gateSettlementEventId: request.gateSettlementEventId,
    gatePayloadDigest: request.gatePayloadDigest, actionableProjectionId: request.actionableProjectionId,
    actionableProjectionVersion: request.actionableProjectionVersion,
    actionableProjectionDigest: request.actionableProjectionDigest, findingId: request.findingId,
    sequence: request.sequence, gate: request.gate, gates: request.gates,
    decisionPacketDigest: request.decisionPacketDigest, choice: "DENY",
    requestDigest: primaryDecisionRequestDigest(request), responseDigest: "e".repeat(64),
    accountEmail: "bsvalues@gmail.com", disposition: "DENIED_RESOLVED", resumeReleased: false,
  }
  return {
    events: [{
      id: 442, userId: "owner", ref: null, entityType: "work_order", entityId: "11",
      eventType: "RUNTIME_OBJECTIVE_FINDING_RECORDED", reason: null, metadata: sourceMetadata,
      createdAt: at("2026-08-20T15:59:00Z"),
    }, {
      id: 501, userId: "owner", ref: null, entityType: "work_order", entityId: "11",
      eventType: "RUNTIME_FINDING_OWNER_GATED", reason: "policy change", metadata: gateMetadata,
      createdAt: at("2026-08-20T16:00:00Z"),
    }],
    request,
    receipt: {
      id: 550, userId: "owner", ref: null, entityType: "work_order", entityId: "11",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", reason: "Owner denied", createdAt: at("2026-08-20T16:05:00Z"),
      metadata: { ...receiptPayload, receiptDigest: sha256(canonical(receiptPayload)), decisionId: 71, evidenceId: 81 },
    },
  }
}

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
  it("binds the canonical runtime finding request only into its owning authenticated Thread", async () => {
    const runtime = runtimeFindingFixture()
    const repo = repository({
      listRootBindings: vi.fn(async () => [{
        threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const,
      }]),
      listGovernanceEvents: vi.fn(async () => runtime.events),
    })
    const readRuntimeFindingDecision = vi.fn(async () => runtime.request)

    const result = await loadAuthenticatedWorkbenchThreads(7, {
      authenticate: async () => "owner", repository: repo, readRuntimeFindingDecision,
    })

    expect(readRuntimeFindingDecision).toHaveBeenCalledOnce()
    expect(result[0].items.filter((item) => item.kind === "DECISION")).toEqual([
      expect.objectContaining({ rawState: "ACTIONABLE", summary: "policy change" }),
    ])
    expect(result[0].coverage.conflicts).toEqual([])
  })

  it("projects a runtime finding only into the single direct work-order Thread, never a transitive goal Thread", async () => {
    const runtime = runtimeFindingFixture()
    const repo = repository({
      listThreads: vi.fn(async () => [{
        id: "thread-goal", userId: "owner", projectId: 7, title: "Goal Thread",
        createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-10T00:00:00Z"),
      }, {
        id: "thread-work-order", userId: "owner", projectId: 7, title: "Work Order Thread",
        createdAt: at("2026-08-02T00:00:00Z"), updatedAt: at("2026-08-11T00:00:00Z"),
      }]),
      listRootBindings: vi.fn(async () => [{
        threadId: "thread-goal", userId: "owner", sourceType: "goal" as const, sourceId: "4", role: "root" as const,
      }, {
        threadId: "thread-work-order", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const,
      }]),
      listGovernanceEvents: vi.fn(async () => runtime.events),
    })
    const readRuntimeFindingDecision = vi.fn(async () => runtime.request)

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo, readRuntimeFindingDecision })
    const goal = result.find((thread) => thread.id === "thread-goal")!
    const direct = result.find((thread) => thread.id === "thread-work-order")!

    expect(goal.items.some((item) => item.source.kind === "governance_event" && item.source.id === "501")).toBe(false)
    expect(direct.items.filter((item) => item.source.kind === "governance_event" && item.source.id === "501")).toHaveLength(1)
  })

  it("fails closed when more than one Thread directly claims the same work order", async () => {
    const runtime = runtimeFindingFixture()
    const repo = repository({
      listThreads: vi.fn(async () => ["a", "b"].map((suffix) => ({
        id: `thread-${suffix}`, userId: "owner", projectId: 7, title: `Thread ${suffix}`,
        createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-10T00:00:00Z"),
      }))),
      listRootBindings: vi.fn(async () => ["a", "b"].map((suffix) => ({
        threadId: `thread-${suffix}`, userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const,
      }))),
      listGovernanceEvents: vi.fn(async () => runtime.events),
    })
    const readRuntimeFindingDecision = vi.fn(async () => runtime.request)

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo, readRuntimeFindingDecision })

    expect(result.flatMap((thread) => thread.items).some((item) => (
      item.source.kind === "governance_event" && item.source.id === "501"
    ))).toBe(false)
  })

  it("keeps a historical owner receipt after the parent completed and the live grant is unavailable", async () => {
    const runtime = runtimeFindingFixture()
    const repo = repository({
      listRootBindings: vi.fn(async () => [{
        threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const,
      }]),
      listWorkOrders: vi.fn(async () => [{
        id: 11, userId: "owner", ref: "WO-11", title: "Implementation", description: "Build it",
        status: "complete", result: "Delivered", linkedDecisionId: null,
        createdAt: at("2026-08-03T00:00:00Z"), updatedAt: at("2026-08-20T17:00:00Z"),
      }]),
      listGovernanceEvents: vi.fn(async () => [...runtime.events, runtime.receipt]),
    })
    const readRuntimeFindingDecision = vi.fn(async () => {
      throw new Error("grant expired")
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, {
      authenticate: async () => "owner", repository: repo, readRuntimeFindingDecision,
    })

    expect(readRuntimeFindingDecision).not.toHaveBeenCalled()
    expect(result[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawState: "OWNER_DECIDED", source: expect.objectContaining({ id: "550" }) }),
    ]))
  })

  it("uses only a unique work-order root; a work-order member neither receives nor vetoes it", async () => {
    const runtime = runtimeFindingFixture()
    const repo = repository({
      listThreads: vi.fn(async () => ["goal", "member", "root"].map((suffix) => ({
        id: `thread-${suffix}`, userId: "owner", projectId: 7, title: `Thread ${suffix}`,
        createdAt: at("2026-08-01T00:00:00Z"), updatedAt: at("2026-08-10T00:00:00Z"),
      }))),
      listRootBindings: vi.fn(async () => [{
        threadId: "thread-goal", userId: "owner", sourceType: "goal" as const, sourceId: "4", role: "root" as const,
      }, {
        threadId: "thread-root", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const,
      }]),
      listMemberBindings: vi.fn(async () => [{
        threadId: "thread-member", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "member" as const,
      }]),
      listGovernanceEvents: vi.fn(async () => runtime.events),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, {
      authenticate: async () => "owner", repository: repo, readRuntimeFindingDecision: vi.fn(async () => runtime.request),
    })
    const runtimeItems = (threadId: string) => result.find((thread) => thread.id === threadId)!.items
      .filter((item) => item.source.kind === "governance_event" && item.source.id === "501")

    expect(runtimeItems("thread-goal")).toHaveLength(0)
    expect(runtimeItems("thread-member")).toHaveLength(0)
    expect(runtimeItems("thread-root")).toHaveLength(1)
  })

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

  it("loads the recorded history of a work_order-rooted Thread", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11], 501)
    expect(repo.listEvidence).toHaveBeenCalledWith("owner", [11], [], 501)
    expect(result).toHaveLength(1)
    expect(result[0].coverage.conflicts).toEqual([])
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "work_order:11", "evidence_record:21", "governance_event:31",
    ]))
    expect(result[0].items.find((item) => item.source.kind === "work_order")?.source.drilldown).toEqual({
      mode: "EXACT",
      href: "/work-orders#work-order-11",
    })
    // The root is the work order itself, so unreachable neighbours stay out rather than being
    // mislabelled as the root's own content.
    expect(result[0].items.some((item) => ["goal", "outcome_queue_item"].includes(item.source.kind))).toBe(false)
    expect(result[0].items.some((item) => item.source.kind === "work_order" && item.source.id !== "11")).toBe(false)
    expect(result[0].items.some((item) => item.source.kind === "decision")).toBe(false)
    expect(result[0].coverage.missingSources).not.toContain("outcome_queue_item:11")
  })

  it("follows the explicit durable edges a work_order root owns", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "12", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [12], 501)
    expect(repo.listDecisions).toHaveBeenCalledWith("owner", [5], 501)
    expect(result[0].coverage.conflicts).toEqual([])
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "work_order:12", "decision:5",
    ]))
    // Evidence, governance, and audit rows belong to work order 11; they are not this root's history.
    expect(result[0].items.some((item) => (
      ["evidence_record", "governance_event", "event_log"].includes(item.source.kind)
    ))).toBe(false)
  })

  it("names a work_order root's members in the persisted vocabulary the table actually carries", async () => {
    // The objective flow hangs governance_event members beneath a work_order root, and their
    // sourceIds are the entity keys that flow wrote -- not governance event row ids.
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const },
      ]),
      listMemberBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "governance_event" as const, sourceId: "resource_verification:PACS", role: "member" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "work_order:11", "evidence_record:21", "governance_event:31",
    ]))
    // The unreachable member is reported under its own kind. A binding the loader cannot name is a
    // binding it cannot honestly report as missing either.
    expect(result[0].coverage.missingSources).toContain("governance_event:resource_verification:PACS")
    expect(result[0].coverage.missingSources.some((key) => key.startsWith("undefined:"))).toBe(false)
    expect(result[0].coverage.conflicts).toEqual([])
  })

  it("leaves a persisted type the projection has no kind for out of the Thread entirely", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "11", role: "root" as const },
      ]),
      listMemberBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "resource" as const, sourceId: "PACS", role: "member" as const },
        { threadId: "thread-a", userId: "owner", sourceType: "reconciliation" as const, sourceId: "PACS", role: "member" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "work_order:11", "evidence_record:21",
    ]))
    // Neither an invented source kind nor a missing-source claim the projection cannot express.
    expect(result[0].coverage.missingSources).toEqual(["conversation"])
    expect(result[0].coverage.conflicts).toEqual([])
  })

  it("fails a Thread closed when its root is a type the projection has no kind for", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "reconciliation" as const, sourceId: "PACS", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(result).toHaveLength(1)
    expect(result[0].items).toEqual([])
    expect(result[0].coverage.conflicts).toContain("ROOT_BINDING_MISSING:thread-a")
  })

  it("reads the table's newer outcome_queue_item spelling as the same outcome as outcome", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "outcome_queue_item" as const, sourceId: "OUT-7", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listOutcomes).toHaveBeenCalledWith("owner", { sourceIds: ["OUT-7"], goalIds: [] }, 501)
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "outcome_queue_item:OUT-7", "goal:4", "work_order:11",
    ]))
    expect(result[0].coverage.missingSources).not.toContain("outcome_queue_item:OUT-7")
  })

  it("loads the recorded history of a work_order-rooted Thread bound by its work order ref", async () => {
    // An objective thread binds its root by ref, which is how every work_order root is written.
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "WO-11", role: "root" as const },
      ]),
      listWorkOrdersByRef: vi.fn(async () => [
        { id: 11, userId: "owner", ref: "WO-11", title: "Implementation", description: "Build it", status: "active", result: null, linkedDecisionId: null, createdAt: at("2026-08-03T00:00:00Z"), updatedAt: at("2026-08-08T00:00:00Z") },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrdersByRef).toHaveBeenCalledWith("owner", ["WO-11"], 501)
    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [11], 501)
    expect(repo.listEvidence).toHaveBeenCalledWith("owner", [11], [], 501)
    expect(result).toHaveLength(1)
    expect(result[0].coverage.conflicts).toEqual([])
    expect(result[0].items.map((item) => `${item.source.kind}:${item.source.id}`)).toEqual(expect.arrayContaining([
      "work_order:11", "evidence_record:21", "governance_event:31",
    ]))
    // The ref resolves to the row identity the rest of the projection already speaks, so the
    // binding is satisfied rather than reported missing, and the drilldown lands on the record.
    expect(result[0].coverage.missingSources).not.toContain("work_order:WO-11")
    expect(result[0].items.find((item) => item.source.kind === "work_order")?.source.drilldown).toEqual({
      mode: "EXACT",
      href: "/work-orders#work-order-11",
    })
  })

  it("never reads a row id out of a work order ref's digits", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "WO-0011", role: "root" as const },
      ]),
      listWorkOrdersByRef: vi.fn(async () => []),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [], 501)
    expect(result).toHaveLength(1)
    expect(result[0].items).toEqual([])
    expect(result[0].coverage.missingSources).toContain("work_order:WO-0011")
  })

  it("leaves an ambiguous work order ref unresolved rather than attaching either row", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "WO-11", role: "root" as const },
      ]),
      listWorkOrdersByRef: vi.fn(async () => [
        { id: 11, userId: "owner", ref: "WO-11", title: "Implementation", description: "Build it", status: "active", result: null, linkedDecisionId: null, createdAt: at("2026-08-03T00:00:00Z"), updatedAt: at("2026-08-08T00:00:00Z") },
        { id: 12, userId: "owner", ref: "WO-11", title: "Governance", description: "Review it", status: "review", result: null, linkedDecisionId: 5, createdAt: at("2026-08-03T01:00:00Z"), updatedAt: at("2026-08-08T01:00:00Z") },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrders).toHaveBeenCalledWith("owner", [], 501)
    expect(result[0].items).toEqual([])
    expect(result[0].coverage.missingSources).toContain("work_order:WO-11")
  })

  it("does not ask a repository that cannot resolve refs, and keeps the ref-bound Thread visible", async () => {
    const repo = repository({
      listRootBindings: vi.fn(async () => [
        { threadId: "thread-a", userId: "owner", sourceType: "work_order" as const, sourceId: "WO-11", role: "root" as const },
      ]),
    })

    const result = await loadAuthenticatedWorkbenchThreads(7, { authenticate: async () => "owner", repository: repo })

    expect(repo.listWorkOrdersByRef).toBeUndefined()
    expect(result).toHaveLength(1)
    expect(result[0].coverage.missingSources).toContain("work_order:WO-11")
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
