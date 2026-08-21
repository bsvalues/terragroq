import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  exactDerivedWorkContract,
  isProtectedRuntimeFindingDecision,
  readPendingRuntimeFindingDecisionRequest,
  recordRuntimeFindingDecision,
  RUNTIME_FINDING_DECISION_PROTECTED_TAG,
} from "@/scripts/hermes-bridge/runtime-finding-decision.mjs"
import {
  buildPrimaryDecisionRequestPrompt,
  PRIMARY_DECISION_OWNER_EMAIL,
  verifyPrimaryDecisionResponse,
} from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"
import { consumePrimaryDecisionIntake } from "@/scripts/hermes-bridge/primary-decision-intake.mjs"

const issuedAt = "2026-08-20T16:00:00.000Z"
const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)
const canonicalDigest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex")
const sourceMetadata = {
  schemaVersion: 1,
  findingId: "FINDING-911-REPIN",
  objectiveWorkOrderId: "WO-0031",
  sequence: 2,
  summary: "repin service paths",
  task: "repin service paths",
  paths: ["scripts/runtime-operator/owner-gate-policy.mjs"],
  effects: {
    changesReviewedPolicy: true, competesWithPriority: false, destroys: [], irreversible: false,
    mutatesProductionData: false, outsideObjectiveScope: false, protectedResource: false,
    releaseOrCutover: false, spendsMoney: false, touchesCredentials: false,
    unresolvedLegalPrivacyOrSecurityRisk: false,
  },
  sourceCheckpointId: 400,
  sourceCheckpointKey: "hermes-outcome:31:attempt:1:checkpoint:7",
  sourceCheckpointSequence: 7,
  sourceCheckpointState: "CODEX_TURN_COMPLETED",
  sourceExecutionEpochDigest: "e".repeat(64),
  findingsSetDigest: "f".repeat(64),
  workContractId: "issue-911-runtime-reliability-evidence.v1",
  workContractDigest: "c".repeat(64),
  workContractVersion: "hermes-work-contract.v1",
  authorizationDecisionId: 17,
  executionGrantRef: "EXEC-GRANT-17",
  implementationGrantId: 18,
  implementationGrantRef: "GRANT-0018",
  sourceCheckpointDigest: "",
  workContractRepository: "bsvalues/terragroq",
  workContractLane: "operator-objective",
  projectionIssueNumber: 911,
  projectionCompletionOwned: false,
  deliveryAuthorityLevel: "A2_WRITE_OWN",
  deliveryAllowedActions: ["implement"],
  commitAllowed: true,
  tagAllowed: false,
  pushAllowed: true,
  idempotencyKey: "hermes-outcome:31:finding:FINDING-911-REPIN",
  payloadDigest: "",
}
const sourceCheckpointPayload = {
  idempotencyKey: sourceMetadata.sourceCheckpointKey,
  outcomeId: 31,
  workOrderRef: "WO-0031",
  attempt: 1,
  checkpointSequence: 7,
  checkpointState: "CODEX_TURN_COMPLETED",
  checkpointDetail: "recorded findings",
  executionBinding: "execution-binding-31",
  acquisitionKey: "acquisition-key-31",
  acquisitionFencingToken: 1,
  executionEpochDigest: sourceMetadata.sourceExecutionEpochDigest,
  findingsSetDigest: "f".repeat(64),
  workContractId: sourceMetadata.workContractId,
  workContractDigest: sourceMetadata.workContractDigest,
  workContractVersion: sourceMetadata.workContractVersion,
  workContractRepository: "bsvalues/terragroq",
  workContractLane: "operator-objective",
  authorizationDecisionId: sourceMetadata.authorizationDecisionId,
  executionGrantRef: sourceMetadata.executionGrantRef,
  implementationGrantId: sourceMetadata.implementationGrantId,
  implementationGrantRef: sourceMetadata.implementationGrantRef,
}
const sourceCheckpointMetadata = {
  ...sourceCheckpointPayload,
  payloadDigest: createHash("sha256").update(JSON.stringify(sourceCheckpointPayload)).digest("hex"),
}
sourceMetadata.sourceCheckpointDigest = sourceCheckpointMetadata.payloadDigest
sourceMetadata.payloadDigest = createHash("sha256").update(JSON.stringify({
  schemaVersion: sourceMetadata.schemaVersion,
  findingId: sourceMetadata.findingId,
  objectiveWorkOrderId: sourceMetadata.objectiveWorkOrderId,
  sequence: sourceMetadata.sequence,
  summary: sourceMetadata.summary,
  task: sourceMetadata.task,
  paths: sourceMetadata.paths,
  effects: sourceMetadata.effects,
  sourceCheckpointId: sourceMetadata.sourceCheckpointId,
  sourceCheckpointKey: sourceMetadata.sourceCheckpointKey,
  sourceCheckpointSequence: sourceMetadata.sourceCheckpointSequence,
  sourceCheckpointState: sourceMetadata.sourceCheckpointState,
  sourceCheckpointDigest: sourceMetadata.sourceCheckpointDigest,
  sourceExecutionEpochDigest: sourceMetadata.sourceExecutionEpochDigest,
  findingsSetDigest: sourceMetadata.findingsSetDigest,
  workContractId: sourceMetadata.workContractId,
  workContractDigest: sourceMetadata.workContractDigest,
  workContractVersion: sourceMetadata.workContractVersion,
  workContractRepository: sourceMetadata.workContractRepository,
  workContractLane: sourceMetadata.workContractLane,
  projectionIssueNumber: sourceMetadata.projectionIssueNumber,
  projectionCompletionOwned: sourceMetadata.projectionCompletionOwned,
  authorizationDecisionId: sourceMetadata.authorizationDecisionId,
  executionGrantRef: sourceMetadata.executionGrantRef,
  implementationGrantId: sourceMetadata.implementationGrantId,
  implementationGrantRef: sourceMetadata.implementationGrantRef,
  deliveryAuthorityLevel: sourceMetadata.deliveryAuthorityLevel,
  deliveryAllowedActions: sourceMetadata.deliveryAllowedActions,
  commitAllowed: sourceMetadata.commitAllowed,
  tagAllowed: sourceMetadata.tagAllowed,
  pushAllowed: sourceMetadata.pushAllowed,
  idempotencyKey: sourceMetadata.idempotencyKey,
})).digest("hex")
const gateCanonicalMetadata = {
  sourceFindingEventId: 442,
  sourceUserId: "owner-1",
  findingId: sourceMetadata.findingId,
  objectiveWorkOrderId: "WO-0031",
  issueNumber: 911,
  gate: "POLICY",
  gates: ["POLICY"],
  reason: "changes reviewed policy",
  contractId: sourceMetadata.workContractId,
  contractDigest: sourceMetadata.workContractDigest,
  authorizationDecisionId: sourceMetadata.authorizationDecisionId,
  implementationGrantId: sourceMetadata.implementationGrantId,
  grantRef: sourceMetadata.implementationGrantRef,
  projectionCompletionOwned: false,
  sourceCheckpointId: sourceMetadata.sourceCheckpointId,
  sourceCheckpointDigest: sourceMetadata.sourceCheckpointDigest,
  contractVersion: sourceMetadata.workContractVersion,
  contractRepository: "bsvalues/terragroq",
  contractLane: "operator-objective",
  deliveryAuthorityLevel: "A2_WRITE_OWN",
  deliveryAllowedActions: ["implement"],
  commitAllowed: true,
  tagAllowed: false,
  pushAllowed: true,
}
const gatePayloadDigest = createHash("sha256").update(JSON.stringify(gateCanonicalMetadata)).digest("hex")
const gateMetadata = {
  ...gateCanonicalMetadata,
  parentGrantRef: gateCanonicalMetadata.grantRef,
  payloadDigest: gatePayloadDigest,
}
const candidate = {
  gateSettlementEventId: 501,
  issuedAt,
  ownerUserId: "owner-1",
  gateMetadata,
  gatePayloadDigest,
  findingId: sourceMetadata.findingId,
  gate: "POLICY",
  gates: ["POLICY"],
  sourceFindingEventId: 442,
  sourceMetadata,
  sourceCheckpointId: sourceMetadata.sourceCheckpointId,
  sourceCheckpointDigest: sourceMetadata.sourceCheckpointDigest,
  sourceCheckpointMetadata,
  parentStatus: "active",
  parentCompletionCheckpointId: null,
  parentCompletionCheckpointDigest: null,
  parentCompleteMetadata: null,
  childCompleteMetadata: [],
  parentWorkOrderRowId: 31,
  parentWorkOrderRef: "WO-0031",
  authorityGrantId: 18,
  authorityGrantRef: "GRANT-0018",
  authorityGrantLevel: "A2_WRITE_OWN",
  sequence: 2,
}

function findingPayloadForTest(metadata: Record<string, unknown>) {
  return Object.fromEntries([
    "schemaVersion", "findingId", "objectiveWorkOrderId", "sequence", "summary", "task", "paths",
    "effects", "sourceCheckpointId", "sourceCheckpointKey", "sourceCheckpointSequence",
    "sourceCheckpointState", "sourceCheckpointDigest", "sourceExecutionEpochDigest", "findingsSetDigest",
    "workContractId", "workContractDigest", "workContractVersion", "workContractRepository",
    "workContractLane", "projectionIssueNumber", "projectionCompletionOwned", "authorizationDecisionId",
    "executionGrantRef", "implementationGrantId", "implementationGrantRef", "deliveryAuthorityLevel",
    "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed", "idempotencyKey",
  ].map((key) => [key, metadata[key]]))
}

function candidateVariant() {
  const variantSource = {
    ...sourceMetadata,
    findingId: "FINDING-911-B",
    sequence: 3,
    idempotencyKey: "hermes-outcome:31:finding:FINDING-911-B",
  }
  variantSource.payloadDigest = createHash("sha256")
    .update(JSON.stringify(findingPayloadForTest(variantSource))).digest("hex")
  const variantGateCanonical = {
    ...gateCanonicalMetadata,
    sourceFindingEventId: 443,
    findingId: "FINDING-911-B",
  }
  const variantGateDigest = createHash("sha256")
    .update(JSON.stringify(variantGateCanonical)).digest("hex")
  return {
    ...candidate,
    gateSettlementEventId: 502,
    findingId: "FINDING-911-B",
    sourceFindingEventId: 443,
    sequence: 3,
    sourceMetadata: variantSource,
    gateMetadata: {
      ...variantGateCanonical,
      parentGrantRef: variantGateCanonical.grantRef,
      payloadDigest: variantGateDigest,
    },
    gatePayloadDigest: variantGateDigest,
  }
}

async function requestFrom(row = candidate) {
  return readPendingRuntimeFindingDecisionRequest({
    ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    query: vi.fn(async () => ({ rows: [row] })),
  })
}

function fakeClient(choice = "APPROVE", overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn(),
    close: vi.fn(),
    readAccount: vi.fn(async () => ({
      authType: "chatgpt",
      email: PRIMARY_DECISION_OWNER_EMAIL,
      requiresOpenaiAuth: true,
    })),
    readLatestDirectUserChoice: vi.fn(async () => ({
      threadId: "thread-owner",
      threadSource: "user",
      source: "vscode",
      cwd: process.cwd(),
      parentThreadId: null,
      agentRole: null,
      requestTurnId: "request-turn",
      requestMessageId: "request-message",
      requestPresentedAt: Date.parse(issuedAt) / 1000 + 5,
      turnId: "owner-turn",
      turnStartedAt: Date.parse(issuedAt) / 1000 + 6,
      turnCompletedAt: Date.parse(issuedAt) / 1000 + 7,
      messageId: "owner-message",
      messageSha256: "b".repeat(64),
      threadSnapshotSha256: "c".repeat(64),
      choice,
      ...overrides,
    })),
  }
}

async function provenance(request: NonNullable<Awaited<ReturnType<typeof requestFrom>>>, choice = "APPROVE") {
  return verifyPrimaryDecisionResponse({
    request,
    repositoryPath: process.cwd(),
    environment: { CODEX_THREAD_ID: "thread-owner" },
    now: Date.parse(issuedAt) + 30_000,
    createClient: () => fakeClient(choice) as never,
  })
}

describe("runtime finding Primary decisions", () => {
  it("accepts an exact derived work contract with optional projection omitted", () => {
    const body = {
      version: "hermes-work-contract.v1",
      id: "runtime-finding.442.v1",
      repository: "bsvalues/terragroq",
      lane: "docs",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: [{
        args: ["diff", "--check"], command: "git", timeoutMs: 60_000,
      }],
      delivery: {
        authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
        commitAllowed: true, tagAllowed: false, pushAllowed: true,
      },
    }
    const withoutProjection = {
      ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    }
    expect(exactDerivedWorkContract(withoutProjection)).toBe(true)
    expect(exactDerivedWorkContract({ ...withoutProjection, projection: undefined })).toBe(false)
  })

  it("exposes the exact protected Decision row contract for the separate action guard", () => {
    expect(RUNTIME_FINDING_DECISION_PROTECTED_TAG).toBe("RUNTIME_FINDING_OWNER_DECISION")
    expect(isProtectedRuntimeFindingDecision({
      ref: "RUNTIME-FINDING-DECISION-501",
      scope: "runtime-finding:501",
      locked: true,
      tags: [RUNTIME_FINDING_DECISION_PROTECTED_TAG, "APPROVE"],
      decision: "APPROVE",
    })).toBe(true)
    expect(isProtectedRuntimeFindingDecision({
      ref: "RUNTIME-FINDING-DECISION-501",
      scope: "runtime-finding:501",
      locked: false,
      tags: [RUNTIME_FINDING_DECISION_PROTECTED_TAG, "APPROVE"],
      decision: "APPROVE",
    })).toBe(false)
  })

  it("reads only the oldest exact settled gate after ordinary sibling and child settlement", async () => {
    const query = vi.fn(async () => ({ rows: [candidate] }))
    const request = await readPendingRuntimeFindingDecisionRequest({
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      query,
    })

    expect(request).toMatchObject({
      sourceKind: "RUNTIME_FINDING",
      parentWorkOrderRowId: 31,
      parentWorkOrderRef: "WO-0031",
      authorityGrantId: 18,
      authorityGrantRef: "GRANT-0018",
      authorityGrantLevel: "A2_WRITE_OWN",
      sourceFindingEventId: 442,
      sourcePayloadDigest: sourceMetadata.payloadDigest,
      gateSettlementEventId: 501,
      gatePayloadDigest,
      actionableProjectionId: "RUNTIME_FINDING_ACTIONABILITY_V1",
      actionableProjectionVersion: 1,
      actionableProjectionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      findingId: "FINDING-911-REPIN",
      sequence: 2,
      gates: ["POLICY"],
      allowedChoices: ["APPROVE", "DENY"],
    })
    const sql = query.mock.calls[0][0]
    expect(sql).toContain("RUNTIME_FINDING_OWNER_GATED")
    expect(sql).toContain("RUNTIME_OBJECTIVE_FINDING_RECORDED")
    expect(sql).toContain("source.actor IN ('hermes', 'williamos-runtime-operator')")
    expect(sql).toContain("gate.actor = 'williamos-runtime-operator'")
    expect(sql).toContain("RUNTIME_FINDING_DERIVED")
    expect(sql).toContain("child.status = 'closed' AND child.result = 'PASS'")
    expect(sql).toContain("child_queue.\"lifecycleState\" = 'completed'")
    expect(sql).toContain("child_queue.\"terminalResult\" = 'COMPLETE'")
    expect(sql).toContain('JOIN authority_grant grant_row')
    expect(sql).toContain("grant_row.status = 'active'")
    expect(sql).toContain('grant_row."revokedAt" IS NULL')
    expect(sql).toContain('grant_row."authorityLevel" = parent."authorityLevel"')
    expect(sql).toContain("'implement' = ANY(grant_row.\"allowedActions\")")
    expect(sql).toContain("parent.status IN ('active', 'approved')")
    expect(sql).toContain("parent.\"authorityGranted\" IN ('A2_WRITE_OWN', 'A3_INTEGRATE')")
    expect(sql).toContain('parent."authorityGranted" = parent."authorityLevel"')
    expect(sql).toContain("ORDER BY gate.id ASC LIMIT 1")
  })

  it("renders and authenticates the discriminated exact request without terminal Goal state", async () => {
    const request = await requestFrom()
    const prompt = buildPrimaryDecisionRequestPrompt(request)
    expect(prompt).toMatch(/^WILLIAMOS_PRIMARY_DECISION_REQUEST:[a-f0-9]{64}/)
    expect(prompt).toContain('Parent Work Order: "WO-0031"')
    expect(prompt).not.toContain("Observed terminal event")
    await expect(provenance(request)).resolves.toMatchObject({
      choice: "APPROVE",
      requestSnapshot: expect.objectContaining({
        sourceKind: "RUNTIME_FINDING",
        sourceFindingEventId: 442,
        gateSettlementEventId: 501,
      }),
    })
  })

  it.each([
    ["wrong task", { threadId: "other" }, "PRIMARY_DECISION_RESPONSE_IDENTITY_WALL"],
    ["wrong repository", { cwd: "C:\\" }, "PRIMARY_DECISION_REPOSITORY_WALL"],
    ["expired", { requestPresentedAt: Date.parse(issuedAt) / 1000 - 4000 }, "PRIMARY_DECISION_EXPIRED"],
  ])("walls %s provenance", async (_label, overrides, code) => {
    const request = await requestFrom()
    await expect(verifyPrimaryDecisionResponse({
      request,
      repositoryPath: process.cwd(),
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient("APPROVE", overrides) as never,
    })).rejects.toMatchObject({ code })
  })

  it.each([
    ["APPROVE", "AUTHORITY_MATERIALIZATION_REQUIRED"],
    ["DENY", "DENIED_RESOLVED"],
  ])("records an immutable %s receipt without releasing or mutating execution state", async (choice, disposition) => {
    const request = await requestFrom()
    const verified = await provenance(request, choice)
    const calls: { sql: string, params: unknown[] }[] = []
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes("SELECT gate.id")) return { rows: [candidate] }
      if (sql.includes("SELECT id, metadata FROM governance_event")) return { rows: [] }
      if (sql.includes("INSERT INTO decision")) return { rows: [{ id: 701 }] }
      if (sql.includes("INSERT INTO evidence_record")) return { rows: [{ id: 702 }] }
      return { rows: [] }
    })
    await expect(recordRuntimeFindingDecision({
      query,
      request,
      primaryDecisionProvenance: verified,
    })).resolves.toMatchObject({ choice, status: disposition, resumeReleased: false, replayed: false })
    const sql = calls.map((call) => call.sql).join("\n")
    expect(sql).toContain("RUNTIME_FINDING_OWNER_DECIDED")
    expect(sql).toContain("runtime.finding.owner_decided")
    expect(sql).not.toMatch(/UPDATE\s+(goal|outcome_queue_item|work_order|authority_grant)/i)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+(work_order|authority_grant)/i)
  })

  it("routes the authenticated finding request through specialized intake with no resume", async () => {
    const request = await requestFrom()
    const recordDecision = vi.fn(async () => ({
      replayed: false,
      resumeReleased: false,
      decisionRef: "RUNTIME-FINDING-DECISION-501",
      status: "AUTHORITY_MATERIALIZATION_REQUIRED",
    }))
    await expect(consumePrimaryDecisionIntake({
      repositoryPath: process.cwd(),
      environment: { CODEX_THREAD_ID: "thread-owner" },
      readRequest: vi.fn(async () => request),
      verifyResponse: (input) => verifyPrimaryDecisionResponse({
        ...input,
        now: Date.parse(issuedAt) + 30_000,
        createClient: () => fakeClient() as never,
      }),
      recordDecision,
    })).resolves.toMatchObject({
      status: "PRIMARY_DECISION_RECORDED",
      sourceKind: "RUNTIME_FINDING",
      disposition: "AUTHORITY_MATERIALIZATION_REQUIRED",
      resumeReleased: false,
    })
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ request }))
  })

  it("replays one exact receipt and walls a conflicting durable receipt", async () => {
    const request = await requestFrom()
    const verified = await provenance(request)
    let storedMetadata: Record<string, unknown> | null = null
    let storedDecision: Record<string, unknown> | null = null
    let storedEvidence: Record<string, unknown> | null = null
    let storedAudit: Record<string, unknown> | null = null
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT gate.id")) return { rows: [candidate] }
      if (sql.includes('SELECT id, "evidenceId", metadata FROM governance_event')) {
        return { rows: storedMetadata ? [{ id: 900, evidenceId: 702, metadata: storedMetadata }] : [] }
      }
      if (sql.includes("FROM decision") && !sql.includes("INSERT INTO")) {
        return { rows: storedDecision ? [storedDecision] : [] }
      }
      if (sql.includes("FROM evidence_record") && !sql.includes("INSERT INTO")) {
        return { rows: storedEvidence ? [storedEvidence] : [] }
      }
      if (sql.includes("FROM event_log") && !sql.includes("INSERT INTO")) {
        return { rows: storedAudit ? [storedAudit] : [] }
      }
      if (sql.includes("INSERT INTO decision")) {
        storedDecision = {
          id: 701,
          authority: "binding",
          owner: params[0],
          title: params[2],
          rationale: params[5],
          status: params[6],
          decision: params[4],
          locked: true,
          scope: params[7],
          context: params[3],
          evidence: params[8],
          tags: params[9],
        }
        return { rows: [{ id: 701 }] }
      }
      if (sql.includes("INSERT INTO evidence_record")) {
        storedEvidence = {
          id: 702,
          workOrderId: params[2],
          result: params[3],
          repo: "bsvalues/terragroq",
          notes: params[4],
          contentHash: params[5],
        }
        return { rows: [{ id: 702 }] }
      }
      if (sql.includes("INSERT INTO governance_event")
        && sql.includes("'RUNTIME_FINDING_OWNER_DECIDED'")) {
        storedMetadata = JSON.parse(String(params[4]))
      }
      if (sql.includes("INSERT INTO event_log")) {
        storedAudit = { id: 703, metadata: JSON.parse(String(params[3])) }
      }
      return { rows: [] }
    })

    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .resolves.toMatchObject({ replayed: false })
    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .resolves.toMatchObject({ replayed: true, resumeReleased: false })
    for (const [field, drift] of [
      ["authority", "advisory"],
      ["owner", "other-owner"],
      ["title", "altered title"],
      ["rationale", "altered rationale"],
    ]) {
      const original = storedDecision?.[field]
      storedDecision = { ...storedDecision, [field]: drift }
      await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
        .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_CONFLICT" })
      storedDecision = { ...storedDecision, [field]: original }
    }
    storedEvidence = { ...storedEvidence, repo: "other/repository" }
    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_CONFLICT" })
    storedEvidence = { ...storedEvidence, repo: "bsvalues/terragroq" }
    storedMetadata = { ...storedMetadata, choice: "DENY" }
    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_CONFLICT" })
  })

  it("re-locks and walls a changed source, parent, grant, or actionability binding", async () => {
    const request = await requestFrom()
    const verified = await provenance(request)
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT gate.id")) {
        return { rows: [{ ...candidate, authorityGrantRef: "GRANT-REVOKED" }] }
      }
      return { rows: [] }
    })
    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    expect(query.mock.calls.map(([sql]) => sql).join("\n")).toContain("FOR UPDATE")
  })

  it("revalidates the exact requested gate while independently enforcing oldest actionable order", async () => {
    const variant = candidateVariant()
    const requestB = await requestFrom(variant)
    const verified = await provenance(requestB)
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT gate.id")) {
        return { rows: [params.includes(502) ? variant : candidate] }
      }
      return { rows: [] }
    })

    await expect(recordRuntimeFindingDecision({ query, request: requestB, primaryDecisionProvenance: verified }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_ORDER_WALL" })
    const candidateReads = query.mock.calls.filter(([sql]) => String(sql).includes("SELECT gate.id"))
    expect(candidateReads).toHaveLength(2)
    expect(candidateReads[0][1]).toContain(502)
  })

  it("requires exact durable decision, evidence, receipt, and audit cardinality on replay", async () => {
    const request = await requestFrom()
    const verified = await provenance(request)
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT gate.id")) return { rows: [candidate] }
      if (sql.includes("SELECT id, metadata FROM governance_event")) {
        return { rows: [{ id: 900, evidenceId: 702, metadata: { conflicting: true } }] }
      }
      if (sql.includes("FROM decision")) return { rows: [{ id: 701 }, { id: 703 }] }
      if (sql.includes("FROM evidence_record")) return { rows: [{ id: 702 }] }
      if (sql.includes("FROM event_log")) return { rows: [{ id: 704 }] }
      return { rows: [] }
    })
    await expect(recordRuntimeFindingDecision({ query, request, primaryDecisionProvenance: verified }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_CONFLICT" })
  })

  it("walls altered source and gate digests before presentation", async () => {
    await expect(requestFrom({ ...candidate, sourcePayloadDigest: "d".repeat(64) }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    await expect(requestFrom({ ...candidate, gatePayloadDigest: "not-a-digest" }))
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
  })
})
