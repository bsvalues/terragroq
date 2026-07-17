import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluatePrCreationPacketLinkage,
  loadCanonicalPrCreationPacketLinkagePlan,
  prCreationPacketLinkagePlanContentHash,
  PrCreationPacketLinkageError,
  runCanonicalPrCreationPacketLinkage,
  verifyCanonicalPrCreationPacketLinkagePlan,
} from "../scripts/multi-agent-operator/pr-creation-packet-linkage.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected PR packet wall")
  } catch (error) {
    expect(error).toBeInstanceOf(PrCreationPacketLinkageError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-038 PR creation and packet linkage", () => {
  it("proves a sealed PR packet linkage plan without creating a pull request", () => {
    const result = runCanonicalPrCreationPacketLinkage()

    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "PR_CREATION_PACKET_LINKAGE_RESULT",
      workOrderId: "WO-MAO-038",
      status: "PR_CREATION_PACKET_LINKAGE_PROVEN",
      packetId: "packet-wo-mao-038-pr-creation-linkage-v1",
      planContentHash: "63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756",
      repository: "bsvalues/terragroq",
      sourceBranch: "codex/wo-mao-038-pr-packet-linkage",
      baseRef: "refs/heads/main",
      baseCommitSha: "bae305e63ab3b73d88e34fb8ddcac5cc738763ed",
      baseTreeHash: "0bce0bedea159dfb3057fac63e9389525610da3a",
      dependencyWorkOrders: ["WO-MAO-022", "WO-MAO-037"],
      requiredPrBodySectionCount: 7,
      packetLinkCount: 4,
      reservedPathCount: 15,
      changedPathCount: 15,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      githubWritePerformed: false,
      pullRequestCreated: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      productionWriteAllowed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
      resultHash: "bd1d18403625d149586d6fa9b6f89c5db464eb71b42fbd3fbe0cf51c3e0c3c30",
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_ACTIVE_PROGRAM_GRANT",
      "VERIFY_OWNER_TOUCH_METER_EVIDENCE",
      "VERIFY_BRANCH_DELIVERY_EVIDENCE",
      "GENERATE_PR_BODY_FROM_VERIFIED_RECORDS",
      "LINK_WORK_ORDER_AUTHORITY_VALIDATION_EVIDENCE",
      "SELECT_DRAFT_OR_READY_MODE_FROM_AUTHORITY",
      "RECORD_PR_PACKET_HASH_FOR_CI_REVIEW_INGESTION",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied PR packet input and pins the canonical plan", () => {
    expect(runCanonicalPrCreationPacketLinkage()).toEqual(runCanonicalPrCreationPacketLinkage())
    expectWall(() => evaluatePrCreationPacketLinkage({
      workOrderId: "WO-MAO-038",
      token: "caller-supplied",
    }), "PR_PACKET_HOST_TRUST_WALL")
    expect(verifyCanonicalPrCreationPacketLinkagePlan()).toMatchObject({
      ok: true,
      code: "PR_PACKET_LINKAGE_PLAN_VERIFIED",
      contentHash: "63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756",
      githubWritePerformed: false,
      pullRequestCreated: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, body, path, secret, authority, delivery, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.repository = "attacker/repository" },
      (value: any) => { value.sourceBranch = "main" },
      (value: any) => { value.dependencyEvidence[1].recordContentHash = "bad" },
      (value: any) => { value.requiredPrBodySections = ["Summary"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.foreignChanges.push("components/unreserved.ts") },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.branchDeliveryEvidenceVerified = false },
      (value: any) => { value.authority.authorityScope = "ALL_REPOSITORY_PATHS" },
      (value: any) => { value.delivery.packetLinkRequired = false },
      (value: any) => { value.delivery.mergePolicy = "MERGE_IMMEDIATELY" },
      (value: any) => { value.safety.pullRequestCreated = true },
      (value: any) => { value.safety.productionWriteAllowed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalPrCreationPacketLinkagePlan())
      mutate(plan)
      expect(prCreationPacketLinkagePlanContentHash(plan)).not.toBe("63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756")
      expectWall(() => verifyCanonicalPrCreationPacketLinkagePlan(plan), "PR_PACKET_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/pr-creation-packet-linkage-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "PR_CREATION_PACKET_LINKAGE_PROVEN",
      resultHash: "bd1d18403625d149586d6fa9b6f89c5db464eb71b42fbd3fbe0cf51c3e0c3c30",
      githubWritePerformed: false,
      pullRequestCreated: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--pr", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/pr-creation-packet-linkage-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "PR_PACKET_CLI_ARGUMENT_WALL",
        githubWritePerformed: false,
        pullRequestCreated: false,
        reviewThreadResolved: false,
        mergePerformed: false,
        authorityGranted: false,
      })
    }
  })
})
