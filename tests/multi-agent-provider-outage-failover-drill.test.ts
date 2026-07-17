import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao048ProviderFailoverEvidence,
  MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE,
} from "@/components/operator/multi-agent-provider-failover-registry"
import {
  evaluateProviderOutageFailoverDrill,
  loadCanonicalProviderOutageFailoverDrillPlan,
  ProviderOutageFailoverDrillError,
  providerOutageFailoverDrillPlanContentHash,
  runCanonicalProviderOutageFailoverDrill,
  verifyCanonicalProviderOutageFailoverDrillPlan,
} from "../scripts/multi-agent-operator/provider-outage-failover-drill.mjs"

const PLAN_HASH = "54533fcda642c669d7a60663d5f12a67036623e43a3c6d66e4ec5313350a4a76"
const RESULT_HASH = "d834bf4fe7677dbd86f1d6d930c0d0041b8c183cdc63a5f8391a697610b2001e"
const EVIDENCE_HASH = "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected provider outage wall")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderOutageFailoverDrillError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-048 provider outage and failover drill", () => {
  it("proves provider outage handling without providers, network injection, or owner diagnostics", () => {
    const result = runCanonicalProviderOutageFailoverDrill()
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "PROVIDER_OUTAGE_FAILOVER_DRILL_RESULT",
      workOrderId: "WO-MAO-048",
      status: "PROVIDER_OUTAGE_FAILOVER_DRILL_PROVEN",
      drillId: "provider-outage-failover-drill-wo-mao-048-v1",
      planContentHash: PLAN_HASH,
      baseCommitSha: "1379318899672e059959da09b9b1d886243167f4",
      baseTreeHash: "c1a278e9a1183829501ae0c07be2610828526b5a",
      dependencyWorkOrders: ["WO-MAO-035", "WO-MAO-036", "WO-MAO-046", "WO-MAO-047"],
      failureKinds: ["HTTP_401", "HTTP_403", "HTTP_429", "HTTP_5XX", "NETWORK", "STREAM_FAILURE", "TIMEOUT"],
      dependencyCount: 4,
      outageCaseCount: 7,
      failoverDecisionCount: 4,
      quarantineRuleCount: 2,
      retryableOutageCount: 5,
      maxAttempts: 3,
      maxReroutes: 1,
      maxBackoffMs: 60000,
      ownerDiagnosticBudget: 0,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      networkInjectionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      ownerDiagnosticsRequired: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_PROVIDER_HEALTH_CONFORMANCE_RETRY_AND_RECOVERY_EVIDENCE",
      "CLASSIFY_NETWORK_AUTH_RATE_LIMIT_5XX_TIMEOUT_AND_STREAM_FAILURES",
      "APPLY_BOUNDED_RETRY_AND_SINGLE_REROUTE_BUDGET",
      "QUARANTINE_AUTHORITY_AND_STREAM_AMBIGUITY",
      "FAIL_CLOSED_WITHOUT_OWNER_DIAGNOSTICS",
      "RECORD_STATIC_PROVIDER_OUTAGE_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId|token/i)
  })

  it("rejects caller-supplied outage input and pins the canonical plan", () => {
    expect(runCanonicalProviderOutageFailoverDrill()).toEqual(runCanonicalProviderOutageFailoverDrill())
    expectWall(() => evaluateProviderOutageFailoverDrill({ injectNetworkFailure: true }), "PROVIDER_OUTAGE_HOST_TRUST_WALL")
    expect(verifyCanonicalProviderOutageFailoverDrillPlan()).toMatchObject({
      ok: true,
      code: "PROVIDER_OUTAGE_FAILOVER_DRILL_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      providerExecutionPerformed: false,
      networkInjectionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      ownerDiagnosticsRequired: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, outage, failover, quarantine, budget, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.outageCases.pop() },
      (value: any) => { value.outageCases[1].ownerDiagnosticsRequired = true },
      (value: any) => { value.failoverDecisions[0].terminalIfNoFallback = "CONTINUE_ANYWAY" },
      (value: any) => { value.quarantineRules[0].providerState = "ACTIVE" },
      (value: any) => { value.budgets.ownerDiagnosticBudget = 1 },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.workerRecoveryVerified = false },
      (value: any) => { value.safety.providerExecutionPerformed = true },
      (value: any) => { value.safety.networkInjectionPerformed = true },
      (value: any) => { value.safety.ownerDiagnosticsRequired = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalProviderOutageFailoverDrillPlan())
      mutate(plan)
      expect(providerOutageFailoverDrillPlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalProviderOutageFailoverDrillPlan(plan), "PROVIDER_OUTAGE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/provider-outage-failover-drill-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "PROVIDER_OUTAGE_FAILOVER_DRILL_PROVEN",
      resultHash: RESULT_HASH,
      providerExecutionPerformed: false,
      networkInjectionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      ownerDiagnosticsRequired: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--inject-network-failure", JSON.stringify({ marker: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/provider-outage-failover-drill-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "PROVIDER_OUTAGE_CLI_ARGUMENT_WALL",
        providerExecutionPerformed: false,
        networkInjectionPerformed: false,
        githubApiCalled: false,
        stateMutationPerformed: false,
        ownerDiagnosticsRequired: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes typed static evidence for the failover drill", () => {
    expect(MULTI_AGENT_PROVIDER_FAILOVER_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1",
      status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED",
      workOrderId: "WO-MAO-048",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      recordContentHash: EVIDENCE_HASH,
      providerExecutionPerformed: false,
      networkInjectionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      ownerDiagnosticsRequired: false,
      authorityGranted: false,
    })
    expect(isVerifiedWoMao048ProviderFailoverEvidence()).toBe(true)
  })
})
