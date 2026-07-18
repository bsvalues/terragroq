import { describe, expect, it } from "vitest"

import {
  RELEASE_ENGINEERING_PROGRAM_MODEL,
  getReleaseEngineeringWorkOrder,
  isVerifiedReleaseEngineeringProgramModel,
} from "@/components/operator/release-engineering-program"
import { hashRecord } from "@/lib/governance/hash"

const cloneModel = () => JSON.parse(JSON.stringify(RELEASE_ENGINEERING_PROGRAM_MODEL))
const rehash = (model: any) => {
  const { recordContentHash, ...claims } = model
  model.recordContentHash = hashRecord(claims)
  return model
}

describe("Release Engineering static program model", () => {
  it("publishes WO-RELEASE-002 through WO-RELEASE-006 in order", () => {
    expect(isVerifiedReleaseEngineeringProgramModel()).toBe(true)
    expect(RELEASE_ENGINEERING_PROGRAM_MODEL).toMatchObject({
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
      goalId: "GOAL-RELEASE-ENGINEERING-001",
      loopId: "LOOP-RELEASE-ENGINEERING-001",
      laneId: "codex-release-engineering-foundation",
      authorityMode: "CODEX_ELIGIBLE",
      riskCeiling: "R1",
      modelKind: "STATIC_READ_ONLY_RELEASE_ENGINEERING_MODEL",
    })
    expect(RELEASE_ENGINEERING_PROGRAM_MODEL.workOrders.map((workOrder) => workOrder.workOrderId)).toEqual([
      "WO-RELEASE-002",
      "WO-RELEASE-003",
      "WO-RELEASE-004",
      "WO-RELEASE-005",
      "WO-RELEASE-006",
    ])
    expect(RELEASE_ENGINEERING_PROGRAM_MODEL.recordContentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("keeps every work order static, report-backed, and release-action blocked", () => {
    for (const workOrder of RELEASE_ENGINEERING_PROGRAM_MODEL.workOrders) {
      expect(workOrder.reportPath).toMatch(/^docs\/reports\/release-engineering\/WO-RELEASE-00[2-6]-/)
      expect(workOrder.requiredInputs.length).toBeGreaterThanOrEqual(5)
      expect(workOrder.acceptanceGates.length).toBeGreaterThanOrEqual(3)
      expect(workOrder.forbiddenActions).toEqual([
        "release execution",
        "deployment",
        "tag creation",
        "rollback execution",
        "production write",
        "GitHub API mutation",
        "secret or credential access",
        "environment, package, Vercel, auth, database, schema, or data change",
        "command runner, worker, scheduler, runtime, or autonomy activation",
      ])
    }
  })

  it("models the release operator surface as read-only evidence", () => {
    expect(getReleaseEngineeringWorkOrder("WO-RELEASE-005")).toMatchObject({
      status: "READ_ONLY_SURFACE_MODELED",
      purpose: expect.stringContaining("display evidence without acting on it"),
      acceptanceGates: expect.arrayContaining([
        "surface exposes no release, deploy, tag, rollback, or mutation command",
        "unknown evidence is displayed as blocking",
      ]),
      downstreamState: "READY_FOR_WO_RELEASE_006",
    })
  })

  it("fails closed when safety or work-order content is mutated", () => {
    const unsafeRelease = cloneModel()
    unsafeRelease.safety.releaseOrDeploymentExecuted = true
    expect(isVerifiedReleaseEngineeringProgramModel(rehash(unsafeRelease))).toBe(false)

    const missingWorkOrder = cloneModel()
    missingWorkOrder.workOrders.pop()
    expect(isVerifiedReleaseEngineeringProgramModel(rehash(missingWorkOrder))).toBe(false)

    const scopeEscape = cloneModel()
    scopeEscape.workOrders[0].reportPath = "docs/reports/WO-RELEASE-002.md"
    expect(isVerifiedReleaseEngineeringProgramModel(rehash(scopeEscape))).toBe(false)

    for (const mutate of [
      (model: any) => { model.workOrders[1].acceptanceGates.push("release can proceed with stale evidence") },
      (model: any) => { model.workOrders[2].status = "READ_ONLY_SURFACE_MODELED" },
      (model: any) => { model.workOrders[3].title = "Release Execution Surface" },
      (model: any) => { model.workOrders[4].downstreamState = "READY_FOR_RELEASE_EXECUTION" },
    ]) {
      const changed = cloneModel()
      mutate(changed)
      expect(isVerifiedReleaseEngineeringProgramModel(rehash(changed))).toBe(false)
    }
  })
})
