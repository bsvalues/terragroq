import { describe, expect, it } from "vitest"

import {
  DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE,
  isDevexHookToolingPathAllowed,
  isVerifiedDevexHookToolingProgramEvidence,
} from "@/components/operator/devex-hook-tooling-registry"

const cloneEvidence = () => JSON.parse(JSON.stringify(DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE))

describe("DevEx Hook Tooling static program evidence", () => {
  it("records WO-DEVEX-HOOK-TOOLING-001 through 003 as complete static work", () => {
    expect(isVerifiedDevexHookToolingProgramEvidence()).toBe(true)
    expect(DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-DEVEX-HOOK-TOOLING-PROGRAM-V1",
      status: "STATIC_DEVEX_HOOK_TOOLING_PROGRAM_VERIFIED",
      programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
      laneId: "codex-devex-hook-tooling-foundation",
      completedWorkOrderCount: 3,
      completionState: "COMPLETE",
      certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE",
    })
    expect(DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE.workOrders.map((workOrder) => workOrder.workOrderId)).toEqual([
      "WO-DEVEX-HOOK-TOOLING-001",
      "WO-DEVEX-HOOK-TOOLING-002",
      "WO-DEVEX-HOOK-TOOLING-003",
    ])
  })

  it("keeps the DevEx reservation path-confined", () => {
    for (const path of [
      "docs/governance/devex-hook-tooling-program.md",
      "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-003-safety-rollup.md",
      "components/operator/devex-hook-tooling-registry.ts",
      "tests/devex-hook-tooling-registry.test.ts",
    ]) {
      expect(isDevexHookToolingPathAllowed(path)).toBe(true)
    }

    for (const path of [
      "components/operator/multi-agent-capability-registry.ts",
      "components/operator/portfolio-operator-registry.ts",
      ".obsidian/private.md",
      "package.json",
      ".github/workflows/devex.yml",
      "runtime-operator/native/authority-registry.json",
    ]) {
      expect(isDevexHookToolingPathAllowed(path)).toBe(false)
    }
  })

  it("fails verification if runtime, hook, package, secret, GitHub, or owner safety is changed", () => {
    for (const mutate of [
      (value: any) => { value.safety.runtimeExecutionAdded = true },
      (value: any) => { value.safety.gitHookInstalled = true },
      (value: any) => { value.safety.githubCallPerformed = true },
      (value: any) => { value.safety.commandRunnerAdded = true },
      (value: any) => { value.safety.backgroundWorkerAdded = true },
      (value: any) => { value.safety.authOrSecretTouched = true },
      (value: any) => { value.safety.dbOrEnvOrPackageChanged = true },
      (value: any) => { value.safety.productionWritePerformed = true },
      (value: any) => { value.safety.ownerOperationRequired = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.secretLikeFindings = 1 },
      (value: any) => { value.ownerTouchCount = 1 },
    ]) {
      const changed = cloneEvidence()
      mutate(changed)
      expect(isVerifiedDevexHookToolingProgramEvidence(changed)).toBe(false)
    }
  })

  it("fails verification when the canonical work-order sequence or evidence path is changed", () => {
    const missingWorkOrder = cloneEvidence()
    missingWorkOrder.workOrders.pop()
    missingWorkOrder.completedWorkOrderCount = 2
    expect(isVerifiedDevexHookToolingProgramEvidence(missingWorkOrder)).toBe(false)

    const escapedEvidencePath = cloneEvidence()
    escapedEvidencePath.workOrders[1].evidencePath = "docs/reports/WO-MAO-999.md"
    expect(isVerifiedDevexHookToolingProgramEvidence(escapedEvidencePath)).toBe(false)
  })
})
