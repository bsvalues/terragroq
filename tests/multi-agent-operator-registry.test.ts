import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"

import {
  MULTI_AGENT_OPERATOR_PROGRAM,
  MULTI_AGENT_OPERATOR_WORK_ORDERS,
  MULTI_AGENT_OWNER_COUNTER_NAMES,
  resolveMultiAgentWorkOrders,
} from "@/components/operator/multi-agent-operator-registry"
import {
  MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
  isVerifiedWoMao034ProviderSettlement,
  type MultiAgentProviderSettlementRecord,
} from "@/components/operator/multi-agent-provider-settlement-registry"

const workOrderId = (number: number) => `WO-MAO-${String(number).padStart(3, "0")}`

describe("multi-agent operator registry", () => {
  it("registers the exact 62-record executable program", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS).toHaveLength(62)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).toEqual(
      Array.from({ length: 62 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`),
    )
    expect(new Set(MULTI_AGENT_OPERATOR_WORK_ORDERS.map((record) => record.workOrderId)).size).toBe(62)
  })

  it("projects evidenced provider outcomes without bypassing Phase 4 dependencies", () => {
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 28).every(({ status }) => status === "COMPLETE")).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.slice(0, 28).every(({ evidencePath }) => existsSync(evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[22]).toMatchObject({
      workOrderId: "WO-MAO-023",
      dependsOn: ["WO-MAO-017", "WO-MAO-018", "WO-MAO-019", "WO-MAO-020", "WO-MAO-021", "WO-MAO-022"],
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-023-eligible-set-scheduler-worker-pool.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[23]).toMatchObject({
      workOrderId: "WO-MAO-024",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-024-team-topology-fan-out-fan-in.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[24]).toMatchObject({
      workOrderId: "WO-MAO-025",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-025-isolated-workspace-manager.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[25]).toMatchObject({
      workOrderId: "WO-MAO-026",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-026-reservation-aware-handoff.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[26]).toMatchObject({
      workOrderId: "WO-MAO-027",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-027-concurrency-budgets-priority-fairness.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[27]).toMatchObject({
      workOrderId: "WO-MAO-028",
      status: "COMPLETE",
      riskClass: "R3",
      evidencePath: "docs/reports/WO-MAO-028-scheduler-simulation-model-checking.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "READY")
      .map(({ workOrderId }) => workOrderId)).toEqual(["WO-MAO-043"])
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[28]).toMatchObject({
      workOrderId: "WO-MAO-029",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-029-supported-codex-capability-conformance.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[29]).toMatchObject({
      workOrderId: "WO-MAO-030",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-030-hosted-codex-coordinator-adapter.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[30]).toMatchObject({
      workOrderId: "WO-MAO-031",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[31]).toMatchObject({
      workOrderId: "WO-MAO-032",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[32]).toMatchObject({
      workOrderId: "WO-MAO-033",
      status: "DEFERRED_PROVIDER_UNAVAILABLE",
      resumable: true,
      evidencePath: "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[33]).toMatchObject({
      workOrderId: "WO-MAO-034",
      status: "COMPLETE",
      resumable: false,
      evidencePath: "docs/reports/WO-MAO-034-cross-provider-routing-review.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[34]).toMatchObject({
      workOrderId: "WO-MAO-035",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-020", "WO-MAO-021", "WO-MAO-022", "WO-MAO-030", "WO-MAO-031", "WO-MAO-032", "WO-MAO-034"],
      evidencePath: "docs/reports/WO-MAO-035-provider-health-reroute.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[35]).toMatchObject({
      workOrderId: "WO-MAO-036",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-028", "WO-MAO-029", "WO-MAO-030", "WO-MAO-031", "WO-MAO-032", "WO-MAO-034", "WO-MAO-035"],
      evidencePath: "docs/reports/WO-MAO-036-provider-conformance-suite.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[36]).toMatchObject({
      workOrderId: "WO-MAO-037",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-007", "WO-MAO-025", "WO-MAO-026", "WO-MAO-036"],
      evidencePath: "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[37]).toMatchObject({
      workOrderId: "WO-MAO-038",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-022", "WO-MAO-037"],
      evidencePath: "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[38]).toMatchObject({
      workOrderId: "WO-MAO-039",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-020", "WO-MAO-022", "WO-MAO-038"],
      evidencePath: "docs/reports/WO-MAO-039-ci-review-ingestion.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[39]).toMatchObject({
      workOrderId: "WO-MAO-040",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-026", "WO-MAO-031", "WO-MAO-039"],
      evidencePath: "docs/reports/WO-MAO-040-remediation-rereview.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[40]).toMatchObject({
      workOrderId: "WO-MAO-041",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-007", "WO-MAO-020", "WO-MAO-039", "WO-MAO-040"],
      evidencePath: "docs/reports/WO-MAO-041-bounded-merge-controller.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[41]).toMatchObject({
      workOrderId: "WO-MAO-042",
      status: "COMPLETE",
      resumable: false,
      dependsOn: ["WO-MAO-022", "WO-MAO-025", "WO-MAO-041"],
      evidencePath: "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md",
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[42]).toMatchObject({
      workOrderId: "WO-MAO-043",
      status: "READY",
      resumable: false,
      dependsOn: ["WO-MAO-017", "WO-MAO-020", "WO-MAO-042"],
    })
    expect([30, 31, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43].map((number) => MULTI_AGENT_OPERATOR_WORK_ORDERS[number - 1].status))
      .toEqual(["COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "COMPLETE", "READY"])
    expect([23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42].every((number) => existsSync(MULTI_AGENT_OPERATOR_WORK_ORDERS[number - 1].evidencePath))).toBe(true)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS[53]).toMatchObject({ workOrderId: "WO-MAO-054", riskClass: "R2" })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "PENDING")).toHaveLength(19)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "COMPLETE")).toHaveLength(41)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "DEFERRED_PROVIDER_UNAVAILABLE")).toHaveLength(1)
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.filter(({ status }) => status === "BLOCKED")).toHaveLength(0)

    const afterSixteen = resolveMultiAgentWorkOrders(
      new Set(Array.from({ length: 16 }, (_, index) => `WO-MAO-${String(index + 1).padStart(3, "0")}`)),
    )
    expect(afterSixteen[16].status).toBe("READY")
    expect(afterSixteen[17].status).toBe("READY")
    expect(afterSixteen[18].status).toBe("READY")
  })

  it("keeps the WO-MAO-034 settlement exact while later corrected dependencies resolve normally", () => {
    const completed = new Set([...Array.from({ length: 32 }, (_, index) => workOrderId(index + 1))])
    const deferred = new Set(["WO-MAO-033"])
    const workOrders = resolveMultiAgentWorkOrders(completed, new Set(), deferred)
    expect(workOrders[32]).toMatchObject({ status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(workOrders[33]).toMatchObject({ workOrderId: "WO-MAO-034", status: "PENDING" })

    const settled = resolveMultiAgentWorkOrders(
      completed, new Set(), deferred, MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
    )
    expect(settled[32]).toMatchObject({ status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(settled[33]).toMatchObject({ workOrderId: "WO-MAO-034", status: "READY" })
    expect(settled[34]).toMatchObject({ workOrderId: "WO-MAO-035", status: "PENDING" })
    expect(settled[35]).toMatchObject({ workOrderId: "WO-MAO-036", status: "PENDING" })

    const wrongLifecycle = resolveMultiAgentWorkOrders(
      completed, new Set(), new Set(), MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
    )
    expect(wrongLifecycle[33]).toMatchObject({ workOrderId: "WO-MAO-034", status: "PENDING" })

    const incompleteAssessment = new Set(Array.from({ length: 31 }, (_, index) => workOrderId(index + 1)))
    const missingAssessmentCompletion = resolveMultiAgentWorkOrders(
      incompleteAssessment,
      new Set(),
      deferred,
      MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
    )
    expect(missingAssessmentCompletion[31]).toMatchObject({
      workOrderId: "WO-MAO-032",
      status: "READY",
    })
    expect(missingAssessmentCompletion[33]).toMatchObject({
      workOrderId: "WO-MAO-034",
      status: "PENDING",
    })

    const afterThirtyFour = resolveMultiAgentWorkOrders(
      new Set([...completed, "WO-MAO-034"]), new Set(), deferred,
    )
    expect(afterThirtyFour[32]).toMatchObject({ workOrderId: "WO-MAO-033", status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(afterThirtyFour[34]).toMatchObject({ workOrderId: "WO-MAO-035", status: "READY" })
    expect(afterThirtyFour[35]).toMatchObject({ workOrderId: "WO-MAO-036", status: "PENDING" })
    const afterThirtyFive = resolveMultiAgentWorkOrders(
      new Set([...completed, "WO-MAO-034", "WO-MAO-035"]), new Set(), deferred,
    )
    expect(afterThirtyFive[32]).toMatchObject({ workOrderId: "WO-MAO-033", status: "DEFERRED_PROVIDER_UNAVAILABLE", resumable: true })
    expect(afterThirtyFive[35]).toMatchObject({ workOrderId: "WO-MAO-036", status: "READY" })

    for (const [consumerWorkOrderId, consumerIndex, prerequisiteIds, laterCompletedIds] of [
      ["WO-MAO-035", 34, [20, 21, 22, 30, 31, 32, 34], ["WO-MAO-034"]],
      ["WO-MAO-036", 35, [28, 29, 30, 31, 32, 34, 35], ["WO-MAO-034", "WO-MAO-035"]],
    ] as const) {
      const completePrerequisites = new Set([...completed, ...laterCompletedIds])
      const forgedSettlement = {
        ...MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
        consumerWorkOrderId,
      } as MultiAgentProviderSettlementRecord
      expect(isVerifiedWoMao034ProviderSettlement(forgedSettlement)).toBe(false)
      expect(resolveMultiAgentWorkOrders(
        completePrerequisites, new Set(), deferred, forgedSettlement,
      )[consumerIndex]).toMatchObject({ status: "READY" })

      for (const omitted of prerequisiteIds) {
        const withoutOneRetainedDependency = new Set(completePrerequisites)
        withoutOneRetainedDependency.delete(workOrderId(omitted))
        expect(resolveMultiAgentWorkOrders(
          withoutOneRetainedDependency, new Set(), deferred, forgedSettlement,
        )[consumerIndex]).toMatchObject({ status: "PENDING" })
      }
    }
  })

  it("does not treat an unrelated deferred dependency as satisfied", () => {
    const completed = new Set(Array.from({ length: 19 }, (_, index) => workOrderId(index + 1)))
    completed.delete("WO-MAO-017")
    const workOrders = resolveMultiAgentWorkOrders(completed, new Set(), new Set(["WO-MAO-017"]))
    expect(workOrders[16]).toMatchObject({ workOrderId: "WO-MAO-017", status: "DEFERRED_PROVIDER_UNAVAILABLE" })
    expect(workOrders[19]).toMatchObject({ workOrderId: "WO-MAO-020", status: "PENDING" })
  })

  it("has only known, acyclic, backward dependencies", () => {
    const known = new Set(MULTI_AGENT_OPERATOR_WORK_ORDERS.map(({ workOrderId }) => workOrderId))
    for (const record of MULTI_AGENT_OPERATOR_WORK_ORDERS) {
      expect(record.dependsOn.every((dependency) => known.has(dependency))).toBe(true)
      expect(record.dependsOn.every((dependency) => dependency < record.workOrderId)).toBe(true)
      expect(new Set(record.dependsOn).size).toBe(record.dependsOn.length)
    }
  })

  it("forbids owner operations and binds final-only communication with five zero counters", () => {
    expect(MULTI_AGENT_OPERATOR_PROGRAM).toMatchObject({
      executionMode: "DEPENDENCY_RESERVATION_ELIGIBLE_SET",
      communicationMode: "FINAL_OUTCOME_OR_GENUINE_AUTHORITY_WALL_ONLY",
      ownerRole: "AUTHORITY_ONLY",
      ownerOperationsAllowed: false,
    })
    expect(MULTI_AGENT_OPERATOR_WORK_ORDERS.every(({ ownerOperationsAllowed }) => ownerOperationsAllowed === false)).toBe(true)
    expect(MULTI_AGENT_OWNER_COUNTER_NAMES).toEqual([
      "OWNER_OPERATION_TOUCH_COUNT",
      "OWNER_CREDENTIAL_TOUCH_COUNT",
      "OWNER_DIAGNOSTIC_TOUCH_COUNT",
      "OWNER_ROUTINE_DECISION_COUNT",
      "OWNER_ROUTINE_CONTACT_COUNT",
    ])
    expect(Object.values(MULTI_AGENT_OPERATOR_PROGRAM.ownerCounters)).toEqual([0, 0, 0, 0, 0])
  })
})
