import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao050DefectiveWorkerEvidence,
  MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE,
} from "@/components/operator/multi-agent-defective-worker-registry"
import {
  evaluateMaliciousDefectiveWorkerDrill,
  loadCanonicalMaliciousDefectiveWorkerDrillPlan,
  MaliciousDefectiveWorkerDrillError,
  maliciousDefectiveWorkerDrillPlanContentHash,
  runCanonicalMaliciousDefectiveWorkerDrill,
  verifyCanonicalMaliciousDefectiveWorkerDrillPlan,
} from "../scripts/multi-agent-operator/malicious-defective-worker-drill.mjs"

const PLAN_HASH = "49d29bf5a5c03fb3172021ac61006e3b85aae963372eb08a8893181a8ac9ba17"
const RESULT_HASH = "c1d2db0cb1e01be04cb815e06a57e89ce4b5d6fcd9d25d277866c864a095cf51"
const EVIDENCE_HASH = "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected defective worker wall")
  } catch (error) {
    expect(error).toBeInstanceOf(MaliciousDefectiveWorkerDrillError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-050 malicious/defective worker drill", () => {
  it("proves defective worker containment without execution, secrets, cleanup, or authority grant", () => {
    const result = runCanonicalMaliciousDefectiveWorkerDrill()
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "MALICIOUS_DEFECTIVE_WORKER_DRILL_RESULT",
      workOrderId: "WO-MAO-050",
      status: "MALICIOUS_DEFECTIVE_WORKER_DRILL_PROVEN",
      drillId: "malicious-defective-worker-drill-wo-mao-050-v1",
      planContentHash: PLAN_HASH,
      baseCommitSha: "761dc98a9d80d51d1373172bbdd40b1088298c4c",
      baseTreeHash: "386713335f0153e3b579c75f46c9c155c23d630f",
      dependencyWorkOrders: ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049"],
      defectKinds: ["FABRICATED_EVIDENCE", "POLICY_OVERRIDE", "PROMPT_INJECTION", "SCOPE_ESCAPE", "SECRET_REQUEST", "UNAUTHORIZED_PRODUCTION_INTENT", "UNSAFE_CLEANUP"],
      dependencyCount: 5,
      defectCaseCount: 7,
      containmentDecisionCount: 7,
      evidenceRequirementCount: 5,
      terminalDefectCount: 7,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      productionWritePerformed: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      stateMutationPerformed: false,
      secretMaterialAllowed: false,
      unsafeCleanupAllowed: false,
      policyOverrideAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_SECRET_RETRY_RECOVERY_FAILOVER_AND_MERGE_RACE_EVIDENCE",
      "CLASSIFY_SCOPE_EVIDENCE_SECRET_POLICY_PROMPT_PRODUCTION_AND_CLEANUP_DEFECTS",
      "STOP_AND_QUARANTINE_DEFECTIVE_WORKER",
      "REJECT_FABRICATED_OR_UNTRUSTED_EVIDENCE",
      "DENY_SECRET_POLICY_PRODUCTION_AND_UNSAFE_CLEANUP_REQUESTS",
      "RECORD_STATIC_DEFECTIVE_WORKER_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId|token/i)
  })

  it("rejects caller-supplied defect input and pins the canonical plan", () => {
    expect(runCanonicalMaliciousDefectiveWorkerDrill()).toEqual(runCanonicalMaliciousDefectiveWorkerDrill())
    expectWall(() => evaluateMaliciousDefectiveWorkerDrill({ defectKind: "SCOPE_ESCAPE" }), "DEFECTIVE_WORKER_HOST_TRUST_WALL")
    expect(verifyCanonicalMaliciousDefectiveWorkerDrillPlan()).toMatchObject({
      ok: true,
      code: "MALICIOUS_DEFECTIVE_WORKER_DRILL_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      unsafeCleanupAllowed: false,
      policyOverrideAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, defect, containment, evidence, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.defectCases.pop() },
      (value: any) => { value.defectCases[0].terminal = false },
      (value: any) => { value.defectCases[1].ownerOperationRequired = true },
      (value: any) => { value.containmentDecisions[0].containment = "TRUST_WORKER" },
      (value: any) => { value.evidenceRequirements[0].failureDecision = "CONTINUE_ANYWAY" },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.mergeRaceVerified = false },
      (value: any) => { value.safety.providerExecutionPerformed = true },
      (value: any) => { value.safety.secretMaterialAllowed = true },
      (value: any) => { value.safety.unsafeCleanupAllowed = true },
      (value: any) => { value.safety.policyOverrideAllowed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalMaliciousDefectiveWorkerDrillPlan())
      mutate(plan)
      expect(maliciousDefectiveWorkerDrillPlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalMaliciousDefectiveWorkerDrillPlan(plan), "DEFECTIVE_WORKER_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/malicious-defective-worker-drill-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "MALICIOUS_DEFECTIVE_WORKER_DRILL_PROVEN",
      resultHash: RESULT_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      secretMaterialAllowed: false,
      unsafeCleanupAllowed: false,
      policyOverrideAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--trust-defective-worker", JSON.stringify({ marker: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/malicious-defective-worker-drill-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "DEFECTIVE_WORKER_CLI_ARGUMENT_WALL",
        providerExecutionPerformed: false,
        githubApiCalled: false,
        stateMutationPerformed: false,
        secretMaterialAllowed: false,
        unsafeCleanupAllowed: false,
        policyOverrideAllowed: false,
        ownerOperationRequired: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes typed static evidence for the defective worker drill", () => {
    expect(MULTI_AGENT_DEFECTIVE_WORKER_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1",
      status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED",
      workOrderId: "WO-MAO-050",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      recordContentHash: EVIDENCE_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      secretMaterialAllowed: false,
      unsafeCleanupAllowed: false,
      policyOverrideAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(isVerifiedWoMao050DefectiveWorkerEvidence()).toBe(true)
  })
})
