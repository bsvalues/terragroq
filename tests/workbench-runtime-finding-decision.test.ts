import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { projectRuntimeFindingDecisionSources } from "@/lib/workbench/runtime-finding-decision-projection"
import { primaryDecisionRequestDigest } from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

const occurredAt = new Date("2026-08-20T16:00:00.000Z")
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
const gateBinding = {
  sourceFindingEventId: 442,
  sourceUserId: "owner-1",
  findingId: "FINDING-911-REPIN",
  objectiveWorkOrderId: "WO-0031",
  gate: "POLICY",
  gates: ["POLICY"],
  reason: "changes reviewed policy",
}
const gate = {
  id: 501,
  userId: "owner-1",
  entityType: "work_order",
  entityId: "31",
  eventType: "RUNTIME_FINDING_OWNER_GATED",
  createdAt: occurredAt,
  metadata: { ...gateBinding, payloadDigest: sha256(JSON.stringify(gateBinding)) },
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
const decisionPacket = {
  blockedAction: "Authorize materialization of the gated runtime finding.",
  authorityBoundary: "This finding requires owner authority before bounded work may be materialized.",
  approveConsequence: "Record authority materialization as required without executing gated work.",
  denyConsequence: "Resolve the gated finding as denied without executing gated work.",
  minimumChoice: "APPROVE_OR_DENY",
}
const actionableProjection = {
  id: "RUNTIME_FINDING_ACTIONABILITY_V1",
  version: 1,
  parentWorkOrderRowId: 31,
  parentWorkOrderRef: "WO-0031",
  authorityGrantId: 18,
  authorityGrantRef: "GRANT-0018",
  authorityGrantLevel: "A2_WRITE_OWN",
  sourceFindingEventId: 442,
  gateSettlementEventId: 501,
  findingId: "FINDING-911-REPIN",
  sequence: 2,
  gates: ["POLICY"],
  routineSiblingState: "SETTLED",
}
const request = {
  sourceKind: "RUNTIME_FINDING",
  ownerUserId: "owner-1",
  parentWorkOrderRowId: 31,
  parentWorkOrderRef: "WO-0031",
  authorityGrantId: 18,
  authorityGrantRef: "GRANT-0018",
  authorityGrantLevel: "A2_WRITE_OWN",
  sourceFindingEventId: 442,
  sourcePayloadDigest: sha256(JSON.stringify(source.metadata)),
  gateSettlementEventId: 501,
  gatePayloadDigest: gate.metadata.payloadDigest,
  actionableProjectionId: "RUNTIME_FINDING_ACTIONABILITY_V1",
  actionableProjectionVersion: 1,
  actionableProjectionDigest: sha256(canonical(actionableProjection)),
  findingId: "FINDING-911-REPIN",
  sequence: 2,
  gate: "POLICY",
  gates: ["POLICY"],
  allowedChoices: ["APPROVE", "DENY"],
  recommendation: "DENY",
  recommendationRationale: "Default-deny: WilliamOS cannot infer authority for gated runtime work.",
  decisionPacket,
  decisionPacketDigest: sha256(JSON.stringify(decisionPacket)),
}

function receiptMetadata(
  boundRequest: Record<string, unknown> = request,
  choice: "APPROVE" | "DENY" = "DENY",
  overrides: Record<string, unknown> = {},
) {
  const bindingKeys = [
    "sourceKind", "ownerUserId", "parentWorkOrderRowId", "parentWorkOrderRef",
    "authorityGrantId", "authorityGrantRef", "authorityGrantLevel", "sourceFindingEventId",
    "sourcePayloadDigest", "gateSettlementEventId", "gatePayloadDigest", "actionableProjectionId",
    "actionableProjectionVersion", "actionableProjectionDigest", "findingId", "sequence", "gate",
    "gates", "decisionPacketDigest",
  ]
  const binding = Object.fromEntries(bindingKeys.map((key) => [key, boundRequest[key]]))
  const payload = {
    ...binding,
    choice,
    requestDigest: primaryDecisionRequestDigest(boundRequest),
    responseDigest: "e".repeat(64),
    accountEmail: "bsvalues@gmail.com",
    disposition: choice === "APPROVE" ? "AUTHORITY_MATERIALIZATION_REQUIRED" : "DENIED_RESOLVED",
    resumeReleased: false,
    ...overrides,
  }
  return {
    ...payload,
    receiptDigest: sha256(canonical(payload)),
    decisionId: 71,
    evidenceId: 81,
  }
}

describe("runtime finding Workbench decision projection", () => {
  it("projects only the exact authenticated actionable gate through a closed safe field set", () => {
    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1",
      projectId: 7,
      thread: { id: "thread-31", workOrderId: 31 },
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
        userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 },
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
      metadata: receiptMetadata(),
    }
    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 },
      workOrder: { id: 31, ref: "WO-0031" }, events: [source, gate, receipt], actionableRequest: [request],
    })

    expect(result.sources[0]).toMatchObject({
      id: "550",
      truth: { state: "RECORDED" },
      data: { decision: { state: "OWNER_DECIDED", choice: "DENY", disposition: "DENIED_RESOLVED", resumeReleased: false } },
    })
    expect(result.sources[0].data.decision).not.toHaveProperty("decisionId")
    expect(result.sources[0].data.decision).not.toHaveProperty("evidenceId")
  })

  it("verifies an exact historical receipt without a live actionable request", () => {
    const receipt = {
      id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: new Date("2026-08-20T16:05:00.000Z"),
      metadata: receiptMetadata(),
    }
    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 },
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
      metadata: receiptMetadata(request, "APPROVE", { findingId: "WRONG" }),
    }
    for (const receipts of [[receipt], [receipt, { ...receipt, id: 551 }]]) {
      const result = projectRuntimeFindingDecisionSources({
        userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 },
        workOrder: { id: 31, ref: "WO-0031" }, events: [source, gate, ...receipts], actionableRequest: request,
      })
      expect(result.sources).toHaveLength(1)
      expect(result.sources[0].truth).toMatchObject({ state: "CONFLICTING" })
      expect(result.sources[0].data.decision).toMatchObject({ state: "CONFLICTING" })
    }
  })

  it("walls every repeated request, provenance digest, and persisted identity mismatch", () => {
    const mutations: Array<[string, unknown]> = [
      ["authorityGrantId", 99], ["authorityGrantRef", "GRANT-WRONG"], ["authorityGrantLevel", "A3_INTEGRATE"],
      ["sequence", 99], ["sourcePayloadDigest", "0".repeat(64)], ["gatePayloadDigest", "1".repeat(64)],
      ["actionableProjectionId", "WRONG"], ["actionableProjectionVersion", 2], ["actionableProjectionDigest", "2".repeat(64)],
      ["decisionPacketDigest", "3".repeat(64)], ["requestDigest", "bad"], ["responseDigest", "bad"],
      ["receiptDigest", "bad"], ["decisionId", 0], ["evidenceId", 0],
      ["accountEmail", "other@example.test"], ["unexpectedSecret", "do-not-accept"],
    ]
    for (const [field, value] of mutations) {
      const metadata = field === "receiptDigest" || field === "decisionId" || field === "evidenceId"
        ? { ...receiptMetadata(), [field]: value }
        : receiptMetadata(request, "DENY", { [field]: value })
      const receipt = {
        id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
        eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: occurredAt,
        metadata,
      }
      const result = projectRuntimeFindingDecisionSources({
        userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 }, workOrder: { id: 31, ref: "WO-0031" },
        events: [source, gate, receipt], actionableRequest: [request],
      })
      expect(result.sources[0]?.data.decision, field).toMatchObject({ state: "CONFLICTING" })
    }
    expect(JSON.stringify(projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 }, workOrder: { id: 31, ref: "WO-0031" },
      events: [source, gate], actionableRequest: [request],
    }))).not.toMatch(/accountEmail|requestDigest|responseDigest|receiptDigest|payloadDigest/i)
  })

  it("keeps each exact historical owner receipt in the durable Thread", () => {
    const firstReceipt = {
      id: 550, userId: "owner-1", entityType: "work_order", entityId: "31",
      eventType: "RUNTIME_FINDING_OWNER_DECIDED", createdAt: occurredAt,
      metadata: receiptMetadata(),
    }
    const secondSource = { ...source, id: 443, metadata: { ...source.metadata, findingId: "FINDING-911-HOST", sequence: 3 } }
    const secondGateBinding = {
      ...gateBinding, sourceFindingEventId: 443, findingId: "FINDING-911-HOST", gate: "HOST", gates: ["HOST"],
    }
    const secondGate = {
      ...gate, id: 502,
      metadata: { ...secondGateBinding, payloadDigest: sha256(JSON.stringify(secondGateBinding)) },
    }
    const secondProjection = {
      ...actionableProjection,
      sourceFindingEventId: 443,
      gateSettlementEventId: 502,
      findingId: "FINDING-911-HOST",
      sequence: 3,
      gates: ["HOST"],
    }
    const secondRequest = {
      ...request,
      sourceFindingEventId: 443,
      sourcePayloadDigest: sha256(JSON.stringify(secondSource.metadata)),
      gateSettlementEventId: 502,
      gatePayloadDigest: secondGate.metadata.payloadDigest,
      actionableProjectionDigest: sha256(canonical(secondProjection)),
      findingId: "FINDING-911-HOST",
      sequence: 3,
      gate: "HOST",
      gates: ["HOST"],
    }
    const secondReceipt = {
      ...firstReceipt, id: 551,
      metadata: { ...receiptMetadata(secondRequest, "APPROVE"), decisionId: 72, evidenceId: 82 },
    }

    const result = projectRuntimeFindingDecisionSources({
      userId: "owner-1", projectId: 7, thread: { id: "thread-31", workOrderId: 31 }, workOrder: { id: 31, ref: "WO-0031" },
      events: [source, gate, firstReceipt, secondSource, secondGate, secondReceipt], actionableRequest: [request, secondRequest],
    })

    expect(result.sources.map((entry) => entry.id)).toEqual(["550", "551"])
    expect(result.sources.map((entry) => entry.data.decision)).toEqual([
      expect.objectContaining({ state: "OWNER_DECIDED", choice: "DENY" }),
      expect.objectContaining({ state: "OWNER_DECIDED", choice: "APPROVE" }),
    ])
    expect(JSON.stringify(result.sources.map((entry) => entry.data.decision))).not.toMatch(/decisionId|evidenceId|71|72|81|82/)
  })
})
