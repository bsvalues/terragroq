import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
  isVerifiedWoMao034ProviderSettlement,
  type MultiAgentProviderSettlementRecord,
} from "@/components/operator/multi-agent-provider-settlement-registry"
import {
  runWoMao034ProviderSettlement,
} from "../scripts/multi-agent-operator/wo-mao-034-provider-settlement.mjs"

describe("WO-MAO-034 canonical provider settlement", () => {
  it("releases only WO-MAO-034 to READY while preserving the unavailable provider outcome", () => {
    const result = runWoMao034ProviderSettlement()

    expect(result).toMatchObject({
      status: "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED",
      readiness: {
        workOrderId: "WO-MAO-034",
        state: "READY",
        completed: false,
        dependencyWorkOrderId: "WO-MAO-033",
        dependencyState: "DEFERRED_PROVIDER_UNAVAILABLE",
        assessmentWorkOrderId: "WO-MAO-032",
        assessmentState: "COMPLETE",
      },
      binding: {
        assessmentEnvelopeHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.assessmentEnvelopeHash,
        subjectEnvelopeHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.subjectEnvelopeHash,
        consumerEnvelopeHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.consumerEnvelopeHash,
        sourceAssessmentContentHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.sourceAssessmentContentHash,
        trustRegistryId: "williamos-provider-assessment-pins",
        trustRegistryVersion: 2,
        assessmentArtifactId: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.assessmentArtifactId,
        assessmentContentHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.assessmentContentHash,
        trustRootFingerprint: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.trustRootFingerprint,
        trustBundleContentHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.trustBundleContentHash,
        trustStatusHeadHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.trustStatusHeadHash,
        trustRegistryRecordContentHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.trustRegistryRecordContentHash,
        trustRegistryContentHash: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.trustRegistryContentHash,
        sourceCommitSha: MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.sourceCommitSha,
      },
      provider: {
        providerId: "claude-code",
        status: "UNAVAILABLE",
        enabled: false,
        reasonCode: "PROVIDER_UNAVAILABLE",
      },
      downstream: { woMao035State: "PENDING", woMao036State: "PENDING" },
      dispatchPerformed: false,
      providerContractDispatchAllowed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
    expect(result.resultHash).toBe(MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD.settlementResultHash)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE KEY|BEGIN PRIVATE|publicKeyPem|signature/i)
    expect(Object.values(result.ownerOperationCounters)).toEqual([0, 0, 0, 0, 0])
  })

  it("keeps the browser-safe projection fail-closed on every canonical binding and nonclaim", () => {
    expect(isVerifiedWoMao034ProviderSettlement()).toBe(true)
    for (const mutation of [
      { consumerEnvelopeHash: "f".repeat(64) },
      { sourceAssessmentContentHash: "f".repeat(64) },
      { assessmentContentHash: "f".repeat(64) },
      { trustRootFingerprint: "f".repeat(64) },
      { trustBundleContentHash: "f".repeat(64) },
      { trustStatusHeadHash: "f".repeat(64) },
      { trustRegistryRecordContentHash: "f".repeat(64) },
      { trustRegistryContentHash: "f".repeat(64) },
      { settlementResultHash: "f".repeat(64) },
      { subjectState: "COMPLETE" },
      { consumerCompleted: true },
      { providerEnabled: true },
      { dispatchPerformed: true },
      { runtimeActivationAllowed: true },
      { authorityGranted: true },
      { ownerRelayRequired: true },
    ]) {
      expect(isVerifiedWoMao034ProviderSettlement({
        ...MULTI_AGENT_PROVIDER_SETTLEMENT_RECORD,
        ...mutation,
      } as MultiAgentProviderSettlementRecord)).toBe(false)
    }
  })

  it("exposes a zero-input CLI and rejects caller-supplied trust material", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/wo-mao-034-provider-settlement-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED",
      readiness: { workOrderId: "WO-MAO-034", state: "READY", completed: false },
      dispatchPerformed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
    })

    const rejected = spawnSync(process.execPath, [
      "scripts/multi-agent-operator/wo-mao-034-provider-settlement-cli.mjs",
      JSON.stringify({ privateKey: "caller-controlled" }),
    ], { encoding: "utf8" })
    expect(rejected.status).toBe(2)
    expect(JSON.parse(rejected.stdout)).toEqual({
      ok: false,
      code: "WO_MAO_034_CLI_ARGUMENT_WALL",
      dispatchPerformed: false,
      providerContractDispatchAllowed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
  })
})
