import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

import { createRuntimeFindingDbConsumer } from "../scripts/runtime-findings/db-consumer.mjs"

const effects = {
  spendsMoney: false, irreversible: false, mutatesProductionData: false,
  releaseOrCutover: false, protectedResource: false,
  unresolvedLegalPrivacyOrSecurityRisk: false, touchesCredentials: false,
  changesReviewedPolicy: false, outsideObjectiveScope: false,
  competesWithPriority: false, destroys: [],
}

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

function sourceRow(overrides: Record<string, unknown> = {}) {
  const workContract = {
    version: "hermes-work-contract.v1",
    id: "issue-911-runtime-reliability-evidence.v1",
    digest: "b".repeat(64),
    repository: "bsvalues/terragroq",
    lane: "operator-objective",
    reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
    validationCommands: [{ command: "git", args: ["diff", "--check"], timeoutMs: 300_000 }],
    delivery: {
      authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
      commitAllowed: true, tagAllowed: false, pushAllowed: true,
    },
  }
  const checkpointMetadata = {
    payloadDigest: "a".repeat(64), workOrderRef: "WO-HERMES-OUTCOME-4",
    workContractId: workContract.id, workContractDigest: workContract.digest,
    workContractVersion: workContract.version, workContractRepository: workContract.repository,
    workContractLane: workContract.lane, authorizationDecisionId: 74,
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    deliveryAuthorityLevel: "A2_WRITE_OWN", deliveryAllowedActions: ["implement"],
    commitAllowed: true, tagAllowed: false, pushAllowed: true,
    findingsSetDigest: "c".repeat(64), executionEpochDigest: "d".repeat(64),
  }
  const findingMetadata: Record<string, unknown> = {
    schemaVersion: 1, findingId: "FINDING-COMPOSE", objectiveWorkOrderId: "WO-HERMES-OUTCOME-4",
    sequence: 1, summary: "Reconcile compose drift", task: "Reconcile compose drift",
    paths: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"], effects,
    sourceCheckpointId: 91, sourceCheckpointDigest: checkpointMetadata.payloadDigest,
    workContractId: workContract.id, workContractDigest: workContract.digest,
    workContractVersion: workContract.version, workContractRepository: workContract.repository,
    workContractLane: workContract.lane, projectionIssueNumber: 911,
    projectionCompletionOwned: false, authorizationDecisionId: 74,
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    deliveryAuthorityLevel: "A2_WRITE_OWN", deliveryAllowedActions: ["implement"],
    commitAllowed: true, tagAllowed: false, pushAllowed: true,
    findingsSetDigest: checkpointMetadata.findingsSetDigest,
    sourceExecutionEpochDigest: checkpointMetadata.executionEpochDigest,
    sourceCheckpointState: "CODEX_TURN_COMPLETED",
  }
  findingMetadata.payloadDigest = sha(findingMetadata)
  return {
    sourceFindingEventId: 101, userId: "owner", findingMetadata,
    parentWorkOrderId: 4, parentWorkOrderRef: "WO-HERMES-OUTCOME-4",
    parentAssignee: "hermes-codex-bridge", parentStatus: "closed",
    parentGoal: "GOAL-0004", parentLoop: "deliver", parentScope: "#911",
    parentNonGoals: [], parentAllowedFiles: workContract.reservations,
    parentForbiddenFiles: [], parentValidators: ["git diff --check"],
    parentStopConditions: [], parentPriority: "high", parentAuthorityLevel: "A2_WRITE_OWN",
    parentAuthorityGranted: "A2_WRITE_OWN", parentAuthorityGrantId: 81,
    parentCommitAllowed: true, parentTagAllowed: false, parentPushAllowed: true,
    checkpointId: 91, checkpointMetadata, workContract,
    parentApprovalDecisionId: 74, parentApprovalStatus: "accepted",
    parentApprovalAuthority: "binding", parentApprovalDecision: "APPROVE",
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    implementationGrantStatus: "active", implementationGrantRevokedAt: null,
    implementationGrantExpiresAt: "2099-01-01T00:00:00.000Z",
    implementationGrantAuthorityLevel: "A2_WRITE_OWN", implementationGrantGrantedTo: "operator",
    implementationGrantScope: "WO-HERMES-OUTCOME-4", implementationGrantAllowedActions: ["implement"],
    implementationGrantBlockedActions: ["host-storage-mutation"],
    settlementId: 501, settlementCount: 1, settlementEventType: "RUNTIME_FINDING_DERIVED",
    settlementMetadata: {},
    ...overrides,
  }
}

describe("native runtime finding database consumer", () => {
  it("rolls back the whole mixed wave on a settlement failure and recovers on the next invocation", async () => {
    const ordinary = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null })
    const gated = sourceRow({
      sourceFindingEventId: 102,
      findingMetadata: {
        ...ordinary.findingMetadata, findingId: "FINDING-POLICY", sequence: 2,
        effects: { ...effects, changesReviewedPolicy: true },
      },
      settlementId: null, settlementCount: null, settlementEventType: null, settlementMetadata: null,
    })
    let sourceReads = 0
    let failGate = true
    let nextId = 300
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes("FROM governance_event finding")) {
        sourceReads += 1
        return { rows: [ordinary, gated] }
      }
      if (sql.startsWith("SELECT child.id")) return { rows: [] }
      if (sql.includes("'RUNTIME_FINDING_OWNER_GATED'") && failGate) {
        failGate = false
        throw Object.assign(new Error("write unavailable"), { code: "SERIALIZATION_FAILURE" })
      }
      if (sql.includes("INSERT INTO")) return { rows: [{ id: ++nextId }] }
      if (sql.startsWith("UPDATE work_order")) return { rows: [{ id: nextId }] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode: "SERIALIZATION_FAILURE",
    })
    expect(statements).toContain("ROLLBACK")
    expect(statements).not.toContain("COMMIT")

    statements.length = 0
    await expect(consume()).resolves.toMatchObject({ derived: 1, gated: 1, queuedChildren: 1 })
    expect(statements).toContain("COMMIT")
    expect(sourceReads).toBe(2)
  })

  it("walls authority or contract drift before creating any child artifact", async () => {
    const drifted = sourceRow({ implementationGrantStatus: "revoked", implementationGrantRevokedAt: new Date() })
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes("FROM governance_event finding")) return { rows: [drifted] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode: "FINDING_SOURCE_LINEAGE_WALL",
    })
    expect(statements.some((sql) => /INSERT INTO (?:work_order|goal|outcome_queue_item|authority_grant)/.test(sql)))
      .toBe(false)
    expect(statements).toContain("ROLLBACK")
  })

  it("admits an ordinary sibling and records a gated sibling in one atomic bounded wave", async () => {
    const ordinary = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null })
    const gatedMetadata = {
      ...ordinary.findingMetadata, findingId: "FINDING-POLICY", sequence: 2,
      summary: "Change reviewed pin", task: "Change reviewed pin",
      effects: { ...effects, changesReviewedPolicy: true },
    }
    const gated = sourceRow({
      sourceFindingEventId: 102, findingMetadata: gatedMetadata,
      settlementId: null, settlementCount: null, settlementEventType: null, settlementMetadata: null,
    })
    const insertedSql: string[] = []
    let nextId = 200
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [ordinary, gated] }
      if (sql.startsWith("SELECT child.id")) return { rows: [] }
      if (sql.includes("INSERT INTO")) {
        insertedSql.push(sql)
        nextId += 1
        return { rows: [{ id: nextId }] }
      }
      if (sql.startsWith("UPDATE work_order")) return { rows: [{ id: 202 }] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })

    await expect(consume()).resolves.toMatchObject({
      status: "RUNTIME_FINDINGS_CONSUMED", considered: 2, derived: 1, gated: 1,
      queuedChildren: 1,
      results: [{ disposition: "DERIVED" }, { disposition: "OWNER_GATED" }],
    })
    expect(insertedSql.filter((sql) => sql.includes("INSERT INTO work_order"))).toHaveLength(1)
    expect(insertedSql.filter((sql) => sql.includes("INSERT INTO goal"))).toHaveLength(1)
    expect(insertedSql.filter((sql) => sql.includes("INSERT INTO outcome_queue_item"))).toHaveLength(1)
    expect(insertedSql.filter((sql) => sql.includes("INSERT INTO authority_grant"))).toHaveLength(1)
    expect(insertedSql.filter((sql) => sql.includes("'RUNTIME_FINDING_OWNER_GATED'"))).toHaveLength(1)
    expect(query.mock.calls.map(([sql]) => sql)).toContain("COMMIT")
  })

  it("validates and replays an exact ordinary child graph instead of deriving a duplicate", async () => {
    const source = sourceRow()
    const sourcePayloadDigest = sha(source.findingMetadata)
    const workContractBody = {
      version: "hermes-work-contract.v1",
      id: "issue-911-runtime-reliability-evidence.v1:finding:FINDING-COMPOSE",
      repository: "bsvalues/terragroq", lane: "operator-objective",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: source.workContract.validationCommands,
      delivery: source.workContract.delivery,
    }
    const workContract = { ...workContractBody, digest: sha(workContractBody) }
    const requestBinding = {
      sourceFindingEventId: 101, sourcePayloadDigest, sourceCheckpointId: 91,
      sourceCheckpointDigest: "a".repeat(64), parentWorkOrderId: 4,
      parentWorkOrderRef: "WO-HERMES-OUTCOME-4",
      parentContractId: "issue-911-runtime-reliability-evidence.v1",
      parentContractDigest: "b".repeat(64), parentAuthorizationDecisionId: 74,
      parentImplementationGrantId: 81,
    }
    const resultBinding = {
      workOrderId: 201, workOrderRef: "WO-HERMES-OUTCOME-4-R01-F101",
      goalId: 202, goalRef: "GOAL-RUNTIME-FINDING-101", queueId: 203,
      outcomeKey: `runtime-finding:101:${sourcePayloadDigest}`,
      approvalDecisionId: 204, implementationGrantId: 205,
      implementationGrantRef: "RUNTIME-FINDING-IMPL-GRANT-101", workContract,
    }
    const settlementCanonical = {
      sourceFindingEventId: 101, sourceUserId: "owner", findingId: "FINDING-COMPOSE",
      objectiveWorkOrderId: "WO-HERMES-OUTCOME-4", childWorkOrderRef: resultBinding.workOrderRef,
      issueNumber: 911, allowedPaths: workContract.reservations,
      requiredValidation: ["git diff --check"], task: "Reconcile compose drift",
      grantRef: "WB-EXEC-IMPL-GRANT-911",
      contractId: "issue-911-runtime-reliability-evidence.v1", contractDigest: "b".repeat(64),
      authorizationDecisionId: 74, implementationGrantId: 81, projectionCompletionOwned: false,
      sourceCheckpointId: 91, sourceCheckpointDigest: "a".repeat(64),
      contractVersion: "hermes-work-contract.v1", contractRepository: "bsvalues/terragroq",
      contractLane: "operator-objective", deliveryAuthorityLevel: "A2_WRITE_OWN",
      deliveryAllowedActions: ["implement"], commitAllowed: true, tagAllowed: false, pushAllowed: true,
    }
    const settlementBase = {
      ...settlementCanonical,
      childWorkOrderRef: resultBinding.workOrderRef, childGoalRef: resultBinding.goalRef,
      childOutcomeKey: resultBinding.outcomeKey, childDecisionRef: "DEC-RUNTIME-FINDING-101",
      childImplementationGrantRef: resultBinding.implementationGrantRef,
      childWorkContract: workContract, authorizationReceiptKey: "runtime-finding.derive:101",
      workOrderId: 201, goalId: 202, queueId: 203, decisionId: 204, grantId: 205, receiptId: 206,
      task: "Reconcile compose drift", parentGrantRef: "WB-EXEC-IMPL-GRANT-911",
    }
    source.settlementMetadata = { ...settlementBase, payloadDigest: sha(settlementCanonical) }
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [source] }
      if (sql.startsWith("SELECT child.id")) return { rows: [{
        workOrderId: 201, goalId: 202, queueId: 203, decisionId: 204, grantId: 205, receiptId: 206,
        workOrderRef: resultBinding.workOrderRef, workOrderStatus: "approved",
        allowedFiles: workContract.reservations, validators: ["git diff --check"], authorityGrantId: 205,
        goalRef: resultBinding.goalRef, goalStatus: "classified", linkedWorkOrderId: 201,
        outcomeKey: resultBinding.outcomeKey, approvalState: "approved", authorityState: "matched",
        lifecycleState: "approved", activeWorkOrderId: 201, approvalDecisionId: 204,
        authorityGrantRef: resultBinding.implementationGrantRef,
        decisionRef: "DEC-RUNTIME-FINDING-101", decisionStatus: "accepted",
        decisionAuthority: "binding", decisionChoice: "APPROVE", decisionScope: resultBinding.outcomeKey,
        grantRef: resultBinding.implementationGrantRef, grantStatus: "active", grantRevokedAt: null,
        grantAuthorityLevel: "A2_WRITE_OWN", grantScope: resultBinding.workOrderRef,
        grantAllowedActions: ["implement"], grantBlockedActions: ["host-storage-mutation"],
        requestHash: sha(requestBinding), requestBinding, resultBinding,
      }] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })

    await expect(consume()).resolves.toMatchObject({
      status: "RUNTIME_FINDINGS_CONSUMED", derived: 1, queuedChildren: 0,
      results: [{ disposition: "DERIVED", replayed: true }],
    })
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(false)
  })
})
