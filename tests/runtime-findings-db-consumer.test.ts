import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

import { createRuntimeFindingDbConsumer } from "../scripts/runtime-findings/db-consumer.mjs"

const effects = {
  changesReviewedPolicy: false, competesWithPriority: false, destroys: [],
  irreversible: false, mutatesProductionData: false, outsideObjectiveScope: false,
  protectedResource: false, releaseOrCutover: false, spendsMoney: false,
  touchesCredentials: false, unresolvedLegalPrivacyOrSecurityRisk: false,
}

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const canonical = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  : JSON.stringify(value)
const canonicalSha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex")
const findingPayload = (value: any) => Object.fromEntries([
  "schemaVersion", "findingId", "objectiveWorkOrderId", "sequence", "summary", "task", "paths",
  "effects", "sourceCheckpointId", "sourceCheckpointKey", "sourceCheckpointSequence",
  "sourceCheckpointState", "sourceCheckpointDigest", "sourceExecutionEpochDigest", "findingsSetDigest",
  "workContractId", "workContractDigest", "workContractVersion", "workContractRepository",
  "workContractLane", "projectionIssueNumber", "projectionCompletionOwned", "authorizationDecisionId",
  "executionGrantRef", "implementationGrantId", "implementationGrantRef", "deliveryAuthorityLevel",
  "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed", "idempotencyKey",
].map((key) => [key, value[key]]))
const normalizedFinding = (value: any) => Object.fromEntries([
  "findingId", "sequence", "summary", "task", "paths", "effects",
].map((key) => [key, value[key]]))

function sourceRow(overrides: Record<string, unknown> = {}) {
  const parentOutcomeKey = "goal:GOAL-0004"
  const parentExecutionBinding = "execution-binding-4"
  const parentAcquisitionKey = "acquisition-key-4"
  const executionEpochDigest = sha([
    "owner", parentOutcomeKey, parentExecutionBinding, parentAcquisitionKey,
  ])
  const workContractBody = {
    version: "hermes-work-contract.v1",
    id: "issue-911-runtime-reliability-evidence.v1",
    repository: "bsvalues/terragroq",
    lane: "operator-objective",
    reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
    validationCommands: [{ command: "git", args: ["diff", "--check"], timeoutMs: 300_000 }],
    projection: { issueNumber: 911, completionOwned: false },
    delivery: {
      authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
      commitAllowed: true, tagAllowed: false, pushAllowed: true,
    },
  }
  const workContract = { ...workContractBody, digest: sha(workContractBody) }
  const parentReceiptRequestBinding = {
    projectId: 7, threadId: "thread-7", outcomeKey: parentOutcomeKey,
    idempotencyKey: "workbench-execution:stable-0004", confirmation: "START_WORK",
  }
  const parentReceiptResultBinding = {
    decisionId: 74, decisionRef: "WB-EXEC-DECISION-911", grantId: 80,
    grantRef: "WB-EXEC-GRANT-911", implementationGrantId: 81,
    implementationGrantRef: "WB-EXEC-IMPL-GRANT-911", queueVersion: 1,
    authorizedAt: "2026-08-20T17:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    workContract,
  }
  const parentApprovalEvidence = [
    "project:7", "thread:thread-7", "repo:bsvalues/terragroq",
    `work-contract:${workContract.id}`, `work-contract-digest:${workContract.digest}`,
    `work-contract-json:${JSON.stringify(workContract)}`,
    ...workContract.reservations.map((reservation) => `reservation:${reservation}`),
    ...workContract.validationCommands.map((validator) => (
      `validator:${validator.command}:${validator.args.join(" ")}`
    )),
  ]
  const findingCore = {
    findingId: "FINDING-COMPOSE", sequence: 1, summary: "Reconcile compose drift",
    task: "Reconcile compose drift",
    paths: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"], effects,
  }
  const checkpointBase = {
    idempotencyKey: "hermes-outcome:4:attempt:1:checkpoint:7", outcomeId: 4,
    workOrderRef: "WO-HERMES-OUTCOME-4", attempt: 1, checkpointSequence: 7,
    checkpointState: "CODEX_TURN_COMPLETED", checkpointDetail: null,
    executionBinding: parentExecutionBinding, acquisitionKey: parentAcquisitionKey,
    acquisitionFencingToken: 2,
    executionEpochDigest, findingsSetDigest: sha([findingCore]),
    workContractId: workContract.id, workContractDigest: workContract.digest,
    workContractVersion: workContract.version, workContractRepository: workContract.repository,
    workContractLane: workContract.lane, authorizationDecisionId: 74,
    executionGrantRef: "WB-EXEC-GRANT-911",
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    deliveryAuthorityLevel: "A2_WRITE_OWN", deliveryAllowedActions: ["implement"],
    commitAllowed: true, tagAllowed: false, pushAllowed: true,
  }
  const checkpointMetadata = { ...checkpointBase, payloadDigest: sha(checkpointBase) }
  const findingMetadata: Record<string, unknown> = {
    schemaVersion: 1, ...findingCore, objectiveWorkOrderId: "WO-HERMES-OUTCOME-4",
    sourceCheckpointId: 91, sourceCheckpointDigest: checkpointMetadata.payloadDigest,
    sourceCheckpointKey: checkpointMetadata.idempotencyKey, sourceCheckpointSequence: 7,
    workContractId: workContract.id, workContractDigest: workContract.digest,
    workContractVersion: workContract.version, workContractRepository: workContract.repository,
    workContractLane: workContract.lane, projectionIssueNumber: 911,
    projectionCompletionOwned: false, authorizationDecisionId: 74,
    executionGrantRef: "WB-EXEC-GRANT-911",
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    deliveryAuthorityLevel: "A2_WRITE_OWN", deliveryAllowedActions: ["implement"],
    commitAllowed: true, tagAllowed: false, pushAllowed: true,
    findingsSetDigest: checkpointMetadata.findingsSetDigest,
    sourceExecutionEpochDigest: checkpointMetadata.executionEpochDigest,
    sourceCheckpointState: "CODEX_TURN_COMPLETED",
    idempotencyKey: "hermes-outcome:4:finding:FINDING-COMPOSE",
  }
  findingMetadata.payloadDigest = sha(findingPayload(findingMetadata))
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
    checkpointId: 91, checkpointMetadata, checkpointFindings: [findingMetadata], workContract,
    parentOutcomeKey, parentQueueApprovalDecisionId: 74,
    parentQueueAuthorityGrantRef: "WB-EXEC-GRANT-911",
    parentQueueExecutionBinding: parentExecutionBinding, parentQueueAcquisitionKey: parentAcquisitionKey,
    parentQueueLeaseToken: "lease-token-4", parentQueueLeaseHolder: "hermes-runtime-4",
    parentQueueLeaseExpiresAt: "2099-01-01T00:00:00.000Z", parentQueueFencingToken: 2,
    parentAcquisitionKey, parentAcquisitionFencingToken: 2, parentAcquisitionCount: 1,
    parentReceiptOperation: "workbench_execution.authorize", parentReceiptConfirmation: "START_WORK",
    parentReceiptOutcomeKey: "goal:GOAL-0004",
    parentReceiptCount: 1,
    parentReceiptRequestHash: canonicalSha({
      contract: "workbench-execution-authorization.v1", ...parentReceiptRequestBinding,
    }),
    parentReceiptRequestBinding, parentReceiptResultBinding,
    parentReceiptDecisionId: 74, parentReceiptImplementationGrantId: 81,
    parentReceiptImplementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    parentApprovalDecisionId: 74, parentApprovalDecisionRef: "WB-EXEC-DECISION-911",
    parentApprovalStatus: "accepted", parentApprovalLocked: true,
    parentApprovalScope: "goal:GOAL-0004",
    parentApprovalAuthority: "binding", parentApprovalDecision: "APPROVE",
    parentApprovalOwner: "owner", parentApprovalEvidence,
    parentApprovalTags: ["workbench", "outcome", "explicit-start-work"],
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911",
    implementationGrantStatus: "active", implementationGrantRevokedAt: null,
    implementationGrantExpiresAt: new Date(2099, 0, 1, 0, 0, 0, 0),
    implementationGrantAuthorityLevel: "A2_WRITE_OWN", implementationGrantGrantedTo: "operator",
    implementationGrantScope: "WO-HERMES-OUTCOME-4", implementationGrantAllowedActions: ["implement"],
    implementationGrantBlockedActions: ["host-storage-mutation"],
    parentExecutionGrantId: 80, parentExecutionGrantRef: "WB-EXEC-GRANT-911",
    parentExecutionGrantStatus: "active", parentExecutionGrantRevokedAt: null,
    parentExecutionGrantExpiresAt: new Date(2099, 0, 1, 0, 0, 0, 0),
    parentExecutionGrantAuthorityLevel: "A2_WRITE_OWN", parentExecutionGrantGrantedTo: "operator",
    parentExecutionGrantScope: "goal:GOAL-0004", parentExecutionGrantWorkOrderId: null,
    parentExecutionGrantAllowedActions: ["outcome:execute"],
    parentExecutionGrantBlockedActions: ["host-storage-mutation"],
    settlementId: 501, settlementCount: 1, settlementEventType: "RUNTIME_FINDING_DERIVED",
    settlementMetadata: {},
    ...overrides,
  }
}

function bindCheckpointFindings(...rows: any[]) {
  const findingsSetDigest = sha(rows.map((row) => normalizedFinding(row.findingMetadata))
    .sort((left, right) => left.sequence - right.sequence))
  const checkpointBase = { ...rows[0].checkpointMetadata, findingsSetDigest }
  delete checkpointBase.payloadDigest
  const checkpointMetadata = { ...checkpointBase, payloadDigest: sha(checkpointBase) }
  const checkpointFindings = rows.map((row) => {
    const metadata = {
      ...row.findingMetadata,
      findingsSetDigest,
      sourceCheckpointDigest: checkpointMetadata.payloadDigest,
    }
    delete metadata.payloadDigest
    metadata.payloadDigest = sha(findingPayload(metadata))
    return metadata
  })
  rows.forEach((row, index) => {
    row.checkpointMetadata = checkpointMetadata
    row.findingMetadata = checkpointFindings[index]
    row.checkpointFindings = checkpointFindings
  })
  return rows
}

describe("native runtime finding database consumer", () => {
  it("verifies producer digests after PostgreSQL jsonb reorders nested finding effects", async () => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    const jsonbEffects = Object.fromEntries(Object.entries(row.findingMetadata.effects).reverse())
    row.findingMetadata.effects = jsonbEffects
    row.checkpointFindings[0].effects = jsonbEffects
    let nextId = 700
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [row] }
      if (sql.startsWith("SELECT child.id")) return { rows: [] }
      if (sql.includes("INSERT INTO")) return { rows: [{ id: ++nextId }] }
      if (sql.startsWith("UPDATE work_order")) return { rows: [{ id: nextId }] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })

    await expect(consume()).resolves.toMatchObject({ derived: 1, queuedChildren: 1 })
  })

  it.each([
    ["completed lease-cleared parent", "execution-binding-4", "acquisition-key-4"],
    ["later reacquisition drift", "execution-binding-later", "acquisition-key-later"],
  ])("retries backlog from the immutable historical epoch after %s", async (_label, currentExecution, currentAcquisition) => {
    const row = sourceRow({
      settlementId: null, settlementCount: null, settlementEventType: null, settlementMetadata: null,
      parentQueueExecutionBinding: currentExecution, parentQueueAcquisitionKey: currentAcquisition,
      parentQueueLeaseToken: null, parentQueueLeaseHolder: null, parentQueueLeaseExpiresAt: null,
      parentQueueFencingToken: currentExecution ? 3 : 2,
    }) as any
    let nextId = 600
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [row] }
      if (sql.startsWith("SELECT child.id")) return { rows: [] }
      if (sql.includes("INSERT INTO")) return { rows: [{ id: ++nextId }] }
      if (sql.startsWith("UPDATE work_order")) return { rows: [{ id: nextId }] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).resolves.toMatchObject({ derived: 1, queuedChildren: 1 })
  })

  it("rolls back the whole mixed wave on a settlement failure and recovers on the next invocation", async () => {
    const ordinary = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null })
    const gated = sourceRow({
      sourceFindingEventId: 102,
      findingMetadata: (() => {
        const value: any = {
        ...ordinary.findingMetadata, findingId: "FINDING-POLICY", sequence: 2,
        effects: { ...effects, changesReviewedPolicy: true },
        idempotencyKey: "hermes-outcome:4:finding:FINDING-POLICY",
        }
        delete value.payloadDigest
        value.payloadDigest = sha(findingPayload(value))
        return value
      })(),
      settlementId: null, settlementCount: null, settlementEventType: null, settlementMetadata: null,
    })
    bindCheckpointFindings(ordinary, gated)
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
    ordinary.workContract = Object.fromEntries(Object.entries(ordinary.workContract).reverse())
    ordinary.workContract.validationCommands = ordinary.workContract.validationCommands.map(
      (validator: Record<string, unknown>) => Object.fromEntries(Object.entries(validator).reverse()),
    )
    ordinary.parentReceiptResultBinding.workContract = ordinary.workContract
    const gatedMetadata: any = {
      ...ordinary.findingMetadata, findingId: "FINDING-POLICY", sequence: 2,
      summary: "Change reviewed pin", task: "Change reviewed pin",
      effects: { ...effects, changesReviewedPolicy: true },
      idempotencyKey: "hermes-outcome:4:finding:FINDING-POLICY",
    }
    delete gatedMetadata.payloadDigest
    gatedMetadata.payloadDigest = sha(findingPayload(gatedMetadata))
    const gated = sourceRow({
      sourceFindingEventId: 102, findingMetadata: gatedMetadata,
      settlementId: null, settlementCount: null, settlementEventType: null, settlementMetadata: null,
    })
    bindCheckpointFindings(ordinary, gated)
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
    expect(insertedSql.filter((sql) => sql.includes("INSERT INTO authority_grant"))).toHaveLength(2)
    expect(insertedSql.filter((sql) => sql.includes("'RUNTIME_FINDING_OWNER_GATED'"))).toHaveLength(1)
    const workOrderInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO work_order"))!
    const goalInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO goal"))!
    const queueInsert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO outcome_queue_item"))!
    expect(workOrderInsert[1]?.[12]).toBe("docs")
    expect(goalInsert[1]?.[3]).toBe("docs")
    expect(queueInsert[1]?.[11]).toBe("RUNTIME-FINDING-QUEUE-GRANT-101")
    expect(query.mock.calls.map(([sql]) => sql)).toContain("COMMIT")
  })

  it("replays one exact canonical gated settlement without duplicating it", async () => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    row.findingMetadata.effects = { ...effects, changesReviewedPolicy: true }
    delete row.findingMetadata.payloadDigest
    row.findingMetadata.payloadDigest = sha(findingPayload(row.findingMetadata))
    bindCheckpointFindings(row)
    const gateInserts: string[] = []
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [row] }
      if (sql.includes("'RUNTIME_FINDING_OWNER_GATED'")) {
        gateInserts.push(sql)
        row.settlementId = 601
        row.settlementCount = 1
        row.settlementEventType = "RUNTIME_FINDING_OWNER_GATED"
        row.settlementMetadata = JSON.parse(String(values?.[3]))
        return { rows: [{ id: 601 }] }
      }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })

    await expect(consume()).resolves.toMatchObject({ gated: 1, results: [{ replayed: false }] })
    await expect(consume()).resolves.toMatchObject({ gated: 1, results: [{ replayed: true }] })
    expect(gateInserts).toHaveLength(1)
    expect(gateInserts[0]).toContain("'williamos-runtime-operator'")
  })

  it.each([
    ["checkpoint payload digest", (row: any) => { row.checkpointMetadata.payloadDigest = "e".repeat(64) }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["finding payload digest", (row: any) => { row.findingMetadata.payloadDigest = "e".repeat(64) }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["extra finding field", (row: any) => { row.findingMetadata.unexpected = true }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["checkpoint state", (row: any) => { row.checkpointMetadata.checkpointState = "COMMIT_CREATED" }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["finding checkpoint state", (row: any) => { row.findingMetadata.sourceCheckpointState = "COMMIT_CREATED" }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["approval mismatch", (row: any) => { row.parentQueueApprovalDecisionId = 75 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["receipt decision mismatch", (row: any) => { row.parentReceiptDecisionId = 75 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["unlocked parent approval", (row: any) => { row.parentApprovalLocked = false }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent approval owner", (row: any) => { row.parentApprovalOwner = "other" }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent approval evidence order", (row: any) => { row.parentApprovalEvidence.reverse() }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent approval contract JSON", (row: any) => { row.parentApprovalEvidence[5] = "work-contract-json:{}" }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent approval tags", (row: any) => { row.parentApprovalTags = ["workbench", "outcome"] }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["contract command timeout drift", (row: any) => { row.workContract.validationCommands[0].timeoutMs = 1 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent receipt hash", (row: any) => { row.parentReceiptRequestHash = "e".repeat(64) }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent receipt shape", (row: any) => { row.parentReceiptRequestBinding.extra = true }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent receipt result shape", (row: any) => { row.parentReceiptResultBinding.extra = true }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent execution grant", (row: any) => { row.parentExecutionGrantId = 999 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent queue blocked action", (row: any) => { row.parentExecutionGrantBlockedActions = ["OUTCOME:EXECUTE"] }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent implementation blocked action", (row: any) => { row.implementationGrantBlockedActions = ["IMPLEMENT"] }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["parent receipt cardinality", (row: any) => { row.parentReceiptCount = 2 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["historical acquisition cardinality", (row: any) => { row.parentAcquisitionCount = 2 }, "FINDING_SOURCE_LINEAGE_WALL"],
    ["duplicate settlement", (row: any) => { row.settlementId = 501; row.settlementCount = 2 }, "FINDING_SETTLEMENT_CARDINALITY_WALL"],
  ])("walls %s corruption before child creation", async (_label, mutate, reasonCode) => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    mutate(row)
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes("FROM governance_event finding")) return { rows: [row] }
      return { rows: [] }
    })
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).rejects.toMatchObject({ code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode })
    expect(statements.some((sql) => /INSERT INTO (?:work_order|goal|outcome_queue_item|authority_grant)/.test(sql)))
      .toBe(false)
  })

  it.each([
    ["checkpoint key", (row: any) => { row.findingMetadata.sourceCheckpointKey = "drifted-key" }],
    ["checkpoint sequence", (row: any) => { row.findingMetadata.sourceCheckpointSequence = 99 }],
    ["execution grant ref", (row: any) => { row.findingMetadata.executionGrantRef = "DRIFTED-GRANT" }],
  ])("walls a digest-valid %s lineage drift", async (_label, mutate) => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    mutate(row)
    delete row.findingMetadata.payloadDigest
    row.findingMetadata.payloadDigest = sha(findingPayload(row.findingMetadata))
    row.checkpointFindings = [row.findingMetadata]
    const query = vi.fn(async (sql: string) => (
      sql.includes("FROM governance_event finding") ? { rows: [row] } : { rows: [] }
    ))
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode: "FINDING_SOURCE_LINEAGE_WALL",
    })
  })

  it("walls a digest-valid execution epoch that does not match the historical acquisition fence", async () => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    row.checkpointMetadata.executionEpochDigest = "e".repeat(64)
    delete row.checkpointMetadata.payloadDigest
    row.checkpointMetadata.payloadDigest = sha(row.checkpointMetadata)
    row.findingMetadata.sourceExecutionEpochDigest = row.checkpointMetadata.executionEpochDigest
    row.findingMetadata.sourceCheckpointDigest = row.checkpointMetadata.payloadDigest
    delete row.findingMetadata.payloadDigest
    row.findingMetadata.payloadDigest = sha(findingPayload(row.findingMetadata))
    row.checkpointFindings = [row.findingMetadata]
    const query = vi.fn(async (sql: string) => (
      sql.includes("FROM governance_event finding") ? { rows: [row] } : { rows: [] }
    ))
    const consume = createRuntimeFindingDbConsumer({
      withPool: async (action: (pool: unknown) => Promise<unknown>) => action({ query }),
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    })
    await expect(consume()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode: "FINDING_SOURCE_LINEAGE_WALL",
    })
  })

  it("walls when the checkpoint findings-set digest does not cover the exact persisted sibling set", async () => {
    const row = sourceRow({ settlementId: null, settlementCount: null,
      settlementEventType: null, settlementMetadata: null }) as any
    row.checkpointFindings = []
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes("FROM governance_event finding")) return { rows: [row] }
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
  })

  it("validates and replays an exact ordinary child graph instead of deriving a duplicate", async () => {
    const source = sourceRow()
    const sourcePayloadDigest = source.findingMetadata.payloadDigest
    const workContractBody = {
      version: "hermes-work-contract.v1",
      id: "runtime-finding.101.v1",
      repository: "bsvalues/terragroq", lane: "docs",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: source.workContract.validationCommands,
      projection: source.workContract.projection,
      delivery: source.workContract.delivery,
    }
    const workContract = { ...workContractBody, digest: sha(workContractBody) }
    const requestBinding = {
      sourceFindingEventId: 101, sourcePayloadDigest, sourceCheckpointId: 91,
      sourceCheckpointDigest: source.checkpointMetadata.payloadDigest, parentWorkOrderId: 4,
      parentWorkOrderRef: "WO-HERMES-OUTCOME-4",
      parentContractId: "issue-911-runtime-reliability-evidence.v1",
      parentContractDigest: source.workContract.digest, parentAuthorizationDecisionId: 74,
      parentImplementationGrantId: 81, operation: "runtime_finding.derive",
    }
    const resultBinding = {
      workOrderId: 201, workOrderRef: "WO-HERMES-OUTCOME-4-R01-F101",
      goalId: 202, goalRef: "GOAL-RUNTIME-FINDING-101", queueId: 203,
      outcomeKey: `runtime-finding:101:${sourcePayloadDigest}`,
      decisionId: 204, approvalDecisionId: 204,
      grantId: 207, grantRef: "RUNTIME-FINDING-QUEUE-GRANT-101",
      queueGrantId: 207, queueGrantRef: "RUNTIME-FINDING-QUEUE-GRANT-101",
      implementationGrantId: 205,
      implementationGrantRef: "RUNTIME-FINDING-IMPL-GRANT-101", workContract,
    }
    const settlementCanonical = {
      sourceFindingEventId: 101, sourceUserId: "owner", findingId: "FINDING-COMPOSE",
      objectiveWorkOrderId: "WO-HERMES-OUTCOME-4", childWorkOrderRef: resultBinding.workOrderRef,
      issueNumber: 911, allowedPaths: workContract.reservations,
      requiredValidation: ["git diff --check"], task: "Reconcile compose drift",
      grantRef: "WB-EXEC-IMPL-GRANT-911",
      contractId: "issue-911-runtime-reliability-evidence.v1", contractDigest: source.workContract.digest,
      authorizationDecisionId: 74, implementationGrantId: 81, projectionCompletionOwned: false,
      sourceCheckpointId: 91, sourceCheckpointDigest: source.checkpointMetadata.payloadDigest,
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
      workOrderId: 201, goalId: 202, queueId: 203, decisionId: 204, grantId: 205,
      queueGrantId: 207, receiptId: 206,
      task: "Reconcile compose drift", parentGrantRef: "WB-EXEC-IMPL-GRANT-911",
    }
    source.settlementMetadata = { ...settlementBase, payloadDigest: sha(settlementCanonical) }
    const replayArtifact: any = {
      workOrderId: 201, goalId: 202, queueId: 203, decisionId: 204, grantId: 205,
      queueGrantId: 207, receiptId: 206,
      workOrderRef: resultBinding.workOrderRef, workOrderStatus: "approved",
      workOrderTitle: "Reconcile compose drift",
      workOrderDescription: "Derived from WO-HERMES-OUTCOME-4 finding FINDING-COMPOSE.",
      workOrderGoal: resultBinding.goalRef, workOrderLoop: "deliver", workOrderScope: "#911",
      workOrderNonGoals: [], workOrderLane: "docs", workOrderForbiddenFiles: [],
      workOrderStopConditions: [], workOrderPriority: "high", workOrderAssignee: "hermes-codex-bridge",
      workOrderAgent: "codex", workOrderApprovedBy: "williamos-runtime-policy",
      workOrderLinkedDecisionId: 204,
      workOrderAuthorityLevel: "A2_WRITE_OWN", workOrderAuthorityGranted: "A2_WRITE_OWN",
      workOrderCommitAllowed: true, workOrderTagAllowed: false, workOrderPushAllowed: true,
      allowedFiles: workContract.reservations, validators: ["git diff --check"], authorityGrantId: 205,
      goalRef: resultBinding.goalRef, goalStatus: "classified", linkedWorkOrderId: 201,
      goalCommand: "Reconcile compose drift", goalLane: "docs", goalMode: "implementation",
      goalRisk: "R1", goalAuthority: "A2_WRITE_OWN", goalVerdict: "allow",
      goalRequiresApproval: false, goalMatchedRules: ["runtime_finding.derive"],
      outcomeKey: resultBinding.outcomeKey, approvalState: "approved", authorityState: "matched",
      lifecycleState: "approved", activeWorkOrderId: 201, approvalDecisionId: 204,
      authorityGrantRef: resultBinding.queueGrantRef,
      decisionRef: "DEC-RUNTIME-FINDING-101", decisionStatus: "accepted",
      decisionAuthority: "binding", decisionChoice: "APPROVE", decisionScope: resultBinding.outcomeKey,
      decisionLocked: true, decisionEvidence: ["runtime-finding:101"],
      grantRef: resultBinding.implementationGrantRef, grantStatus: "active", grantRevokedAt: null,
      grantAuthorityLevel: "A2_WRITE_OWN", grantScope: resultBinding.workOrderRef,
      grantExpiresAt: new Date(2099, 0, 1, 0, 0, 0, 0), grantGrantedTo: "operator", grantWorkOrderId: 201,
      grantAllowedActions: ["implement"], grantBlockedActions: ["host-storage-mutation"],
      queueGrantRef: resultBinding.queueGrantRef, queueGrantStatus: "active", queueGrantRevokedAt: null,
      queueGrantExpiresAt: new Date(2099, 0, 1, 0, 0, 0, 0), queueGrantAuthorityLevel: "A2_WRITE_OWN",
      queueGrantScope: resultBinding.outcomeKey, queueGrantGrantedTo: "operator",
      queueGrantWorkOrderId: 201, queueGrantAllowedActions: ["outcome:execute"],
      queueGrantBlockedActions: ["host-storage-mutation"],
      authoritySubject: "operator", authorityAction: "outcome:execute", queueVersion: 0,
      requestHash: canonicalSha(requestBinding), requestBinding, resultBinding,
    }
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM governance_event finding")) return { rows: [source] }
      if (sql.startsWith("SELECT child.id")) return { rows: [replayArtifact] }
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

    replayArtifact.goalCommand = "tampered executable command"
    await expect(consume()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL", reasonCode: "FINDING_CHILD_REPLAY_ARTIFACT_WALL",
    })
  })
})
