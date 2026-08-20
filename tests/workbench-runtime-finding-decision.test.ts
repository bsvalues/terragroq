import { describe, expect, it } from "vitest"

import { projectRuntimeFindingDecisionSources } from "@/lib/workbench/runtime-finding-decision-projection"

const occurredAt = new Date("2026-08-20T16:00:00.000Z")
const gate = {
  id: 501,
  userId: "owner-1",
  entityType: "work_order",
  entityId: "31",
  eventType: "RUNTIME_FINDING_OWNER_GATED",
  createdAt: occurredAt,
  metadata: {
    sourceFindingEventId: 442,
    sourceUserId: "owner-1",
    findingId: "FINDING-911-REPIN",
    objectiveWorkOrderId: "WO-0031",
    gate: "POLICY",
    gates: ["POLICY"],
    reason: "changes reviewed policy",
    payloadDigest: "a".repeat(64),
  },
}
const source = {
  id: 442,
  userId: "owner-1",
  entityType: "work_order",
  entityId: "31",
  eventType: "RUNTIME_OBJECTIVE_FINDING_RECORDED",
  createdAt: new Date("2026-08-20T15:59:00.000Z"),
  metadata: {
    findingId: "FINDING-911-REPIN",
    objectiveWorkOrderId: "WO-0031",
    sequence: 2,
  },
}
const request = {
  sourceKind: "RUNTIME_FINDING",
  ownerUserId: "owner-1",
  parentWorkOrderRowId: 31,
  parentWorkOrderRef: "WO-0031",
  sourceFindingEventId: 442,
  gateSettlementEventId: 501,
  findingId: "FINDING-911-REPIN",
  gate: "POLICY",
  gates: ["POLICY"],
  allowedChoices: ["APPROVE", "DENY"],
  recommendation: "DENY",
  recommendationRationale: "Default-deny: WilliamOS cannot infer authority for gated runtime work.",
  decisionPacket: {
    blockedAction: "Authorize materialization of the gated runtime finding.",
    authorityBoundary: "This finding requires owner authority before bounded work may be materialized.",
    approveConsequence: "Record authority materialization as required without executing gated work.",
    denyConsequence: "Resolve the gated finding as denied without executing gated work.",
  },
}

describe("runtime finding Workbench decision projection", () => {
  it("projects only the exact authenticated actionable gate through a closed safe field set", () => {
    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1",
      projectId: 7,
      threadId: "thread-31",
      workOrder: { id: 31, ref: "WO-0031" },
      events: [source, gate],
      actionableRequest: request,
    })

    expect(result.bindings).toEqual([{
      threadId: "thread-31", userId: "owner-1", projectId: 7,
      sourceKind: "governance_event", sourceId: "501", role: "member",
    }])
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      kind: "governance_event",
      id: "501",
      userId: "owner-1",
      truth: { basis: "PERSISTED", state: "CURRENT" },
      data: {
        eventType: "RUNTIME_FINDING_OWNER_GATED",
        decision: {
          state: "ACTIONABLE",
          why: "changes reviewed policy",
          blockedAction: "Authorize materialization of the gated runtime finding.",
          gates: ["POLICY"],
          recommendation: "DENY",
          choices: ["APPROVE", "DENY"],
          consequences: {
            APPROVE: "Record authority materialization as required without executing gated work.",
            DENY: "Resolve the gated finding as denied without executing gated work.",
          },
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/accountEmail|responseDigest|payloadDigest|secret/i)
  })

  it("isolates foreign, unbound, wrong-project, and wrong-thread requests", () => {
    const cases = [
      { ownerUserId: "owner-2" },
      { parentWorkOrderRowId: 99 },
      { parentWorkOrderRef: "WO-OTHER" },
      { sourceFindingEventId: 999 },
    ]
    for (const change of cases) {
      const result = projectRuntimeFindingDecisionSources({
        userId: "owner-1", projectId: 7, threadId: "thread-31",
        workOrder: { id: 31, ref: "WO-0031" }, events: [source, gate],
        actionableRequest: { ...request, ...change },
      })
      expect(result).toEqual({ bindings: [], sources: [] })
    }
  })

  it("projects an exact receipt as owner-decided without releasing execution", () => {
    const receipt = {
      id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: new Date("2026-08-20T16:05:00.000Z"),
      metadata: {
        sourceKind: "RUNTIME_FINDING", ownerUserId: "owner-1",
        parentWorkOrderRowId: 31, parentWorkOrderRef: "WO-0031",
        sourceFindingEventId: 442, gateSettlementEventId: 501,
        findingId: "FINDING-911-REPIN", gate: "POLICY", gates: ["POLICY"],
        choice: "DENY", disposition: "DENIED_RESOLVED", resumeReleased: false,
      },
    }
    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, threadId: "thread-31",
      workOrder: { id: 31, ref: "WO-0031" }, events: [source, gate, receipt], actionableRequest: null,
    })

    expect(result.sources[0]).toMatchObject({
      id: "550",
      truth: { state: "RECORDED" },
      data: { decision: { state: "OWNER_DECIDED", choice: "DENY", disposition: "DENIED_RESOLVED", resumeReleased: false } },
    })
  })

  it("marks duplicate or mismatched receipts conflicting and never presents them as actionable", () => {
    const receipt = {
      id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: occurredAt,
      metadata: {
        sourceKind: "RUNTIME_FINDING", ownerUserId: "owner-1",
        parentWorkOrderRowId: 31, parentWorkOrderRef: "WO-0031",
        sourceFindingEventId: 442, gateSettlementEventId: 501,
        findingId: "WRONG", gate: "POLICY", gates: ["POLICY"],
        choice: "APPROVE", disposition: "AUTHORITY_MATERIALIZATION_REQUIRED", resumeReleased: false,
      },
    }
    for (const receipts of [[receipt], [receipt, { ...receipt, id: 551 }]]) {
      const result = projectRuntimeFindingDecisionSources({
        userId: "owner-1", projectId: 7, threadId: "thread-31",
        workOrder: { id: 31, ref: "WO-0031" }, events: [source, gate, ...receipts], actionableRequest: request,
      })
      expect(result.sources).toHaveLength(1)
      expect(result.sources[0].truth).toMatchObject({ state: "CONFLICTING" })
      expect(result.sources[0].data.decision).toMatchObject({ state: "CONFLICTING" })
    }
  })

  it("keeps each exact historical owner receipt in the durable Thread", () => {
    const firstReceipt = {
      id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: occurredAt,
      metadata: {
        sourceKind: "RUNTIME_FINDING", ownerUserId: "owner-1",
        parentWorkOrderRowId: 31, parentWorkOrderRef: "WO-0031",
        sourceFindingEventId: 442, gateSettlementEventId: 501,
        findingId: "FINDING-911-REPIN", gate: "POLICY", gates: ["POLICY"],
        choice: "DENY", disposition: "DENIED_RESOLVED", resumeReleased: false,
      },
    }
    const secondSource = { ...source, id: 443, metadata: { ...source.metadata, findingId: "FINDING-911-HOST", sequence: 3 } }
    const secondGate = {
      ...gate, id: 502,
      metadata: { ...gate.metadata, sourceFindingEventId: 443, findingId: "FINDING-911-HOST", gate: "HOST", gates: ["HOST"] },
    }
    const secondReceipt = {
      ...firstReceipt, id: 551,
      metadata: {
        ...firstReceipt.metadata, sourceFindingEventId: 443, gateSettlementEventId: 502,
        findingId: "FINDING-911-HOST", gate: "HOST", gates: ["HOST"],
        choice: "APPROVE", disposition: "AUTHORITY_MATERIALIZATION_REQUIRED",
      },
    }

    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, threadId: "thread-31", workOrder: { id: 31, ref: "WO-0031" },
      events: [source, gate, firstReceipt, secondSource, secondGate, secondReceipt], actionableRequest: null,
    })

    expect(result.sources.map((entry) => entry.id)).toEqual(["550", "551"])
    expect(result.sources.map((entry) => entry.data.decision)).toEqual([
      expect.objectContaining({ state: "OWNER_DECIDED", choice: "DENY" }),
      expect.objectContaining({ state: "OWNER_DECIDED", choice: "APPROVE" }),
    ])
  })
})
