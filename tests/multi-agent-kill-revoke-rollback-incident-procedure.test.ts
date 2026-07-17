import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao052IncidentProcedureEvidence,
  MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE,
} from "@/components/operator/multi-agent-incident-procedure-registry"
import {
  evaluateKillRevokeRollbackIncidentProcedure,
  IncidentProcedureError,
  killRevokeRollbackIncidentProcedurePlanContentHash,
  loadCanonicalKillRevokeRollbackIncidentProcedure,
  runCanonicalKillRevokeRollbackIncidentProcedure,
  verifyCanonicalKillRevokeRollbackIncidentProcedure,
} from "../scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure.mjs"

const PLAN_HASH = "20eb61ed04b933c8a6fed6be377130eff40eb5dc6f2a74ee27a6b4f52a926e5c"
const RESULT_HASH = "6887a88544ee3aba208c7c1348402492752028ae1d43ef76a334e3551de58bb5"
const EVIDENCE_HASH = "e3a60ca23bafaff20d33304fdc965600e000f0245822416cb560b46829075b45"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected incident procedure wall")
  } catch (error) {
    expect(error).toBeInstanceOf(IncidentProcedureError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-052 kill, revoke, rollback, and incident procedure", () => {
  it("proves the static incident procedure without executing incident operations", () => {
    const result = runCanonicalKillRevokeRollbackIncidentProcedure()
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_RESULT",
      workOrderId: "WO-MAO-052",
      status: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_PROVEN",
      procedureId: "kill-revoke-rollback-incident-procedure-wo-mao-052-v1",
      planContentHash: PLAN_HASH,
      baseCommitSha: "8de0b73bcfd13055de7d3ffc86bc42a1a178f0a1",
      baseTreeHash: "3310d65b8bc96f57c78cd660b4f715eefddee335",
      dependencyWorkOrders: ["WO-MAO-045", "WO-MAO-046", "WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-051"],
      dependencyCount: 7,
      incidentClassCount: 6,
      procedureStepCount: 6,
      rollbackRuleCount: 4,
      ownerDecisionRuleCount: 3,
      ownerDecisionRequiredClassCount: 1,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      revokeExecuted: false,
      rollbackExecuted: false,
      cleanupExecuted: false,
      productionWritePerformed: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      stateMutationPerformed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_PHASE_SIX_DEPENDENCY_EVIDENCE",
      "CLASSIFY_WORKER_PROVIDER_SECRET_ROLLBACK_CLEANUP_AND_AUTHORITY_INCIDENTS",
      "MODEL_QUARANTINE_REVOKE_CHECKPOINT_AND_OWNED_ROLLBACK_DECISIONS",
      "DENY_FOREIGN_CLEANUP_PRODUCTION_MUTATION_AND_AUTHORITY_BYPASS",
      "CONTINUE_ONLY_UNAFFECTED_DEPENDENCY_CLEARED_LANES",
      "RECORD_STATIC_INCIDENT_PROCEDURE_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId|token/i)
  })

  it("rejects caller-supplied incident input and pins the canonical plan", () => {
    expect(runCanonicalKillRevokeRollbackIncidentProcedure()).toEqual(runCanonicalKillRevokeRollbackIncidentProcedure())
    expectWall(() => evaluateKillRevokeRollbackIncidentProcedure({ rollbackNow: true }), "INCIDENT_PROCEDURE_HOST_TRUST_WALL")
    expect(verifyCanonicalKillRevokeRollbackIncidentProcedure()).toMatchObject({
      ok: true,
      code: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      revokeExecuted: false,
      rollbackExecuted: false,
      cleanupExecuted: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, incident, rollback, owner-contact, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.incidentClasses.pop() },
      (value: any) => { value.incidentClasses[0].terminal = false },
      (value: any) => { value.incidentClasses[0].ownerDecisionRequired = true },
      (value: any) => { value.procedureSteps[0].allowed = false },
      (value: any) => { value.rollbackRules[1].decision = "ROLLBACK_FOREIGN_PATH" },
      (value: any) => { value.ownerDecisionRules[0].ownerContact = "REQUIRED" },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.statusUxVerified = false },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.rollbackExecuted = true },
      (value: any) => { value.safety.cleanupExecuted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalKillRevokeRollbackIncidentProcedure())
      mutate(plan)
      expect(killRevokeRollbackIncidentProcedurePlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalKillRevokeRollbackIncidentProcedure(plan), "INCIDENT_PROCEDURE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_PROVEN",
      resultHash: RESULT_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      revokeExecuted: false,
      rollbackExecuted: false,
      cleanupExecuted: false,
      stateMutationPerformed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--rollback-now", JSON.stringify({ marker: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "INCIDENT_PROCEDURE_CLI_ARGUMENT_WALL",
        providerExecutionPerformed: false,
        githubApiCalled: false,
        revokeExecuted: false,
        rollbackExecuted: false,
        cleanupExecuted: false,
        stateMutationPerformed: false,
        ownerOperationRequired: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes typed static evidence for the incident procedure", () => {
    expect(MULTI_AGENT_INCIDENT_PROCEDURE_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-052-KILL-REVOKE-ROLLBACK-INCIDENT-PROCEDURE-V1",
      status: "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_VERIFIED",
      workOrderId: "WO-MAO-052",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      recordContentHash: EVIDENCE_HASH,
      revokeExecuted: false,
      rollbackExecuted: false,
      cleanupExecuted: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(isVerifiedWoMao052IncidentProcedureEvidence()).toBe(true)
  })
})
