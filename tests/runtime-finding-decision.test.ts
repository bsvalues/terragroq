import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
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
const sourceMetadata = {
  schemaVersion: 1,
  findingId: "FINDING-911-REPIN",
  objectiveWorkOrderId: "WO-0031",
  sequence: 2,
  summary: "repin service paths",
  task: "repin service paths",
  paths: ["scripts/runtime-operator/owner-gate-policy.mjs"],
  effects: { changesReviewedPolicy: true },
}
const gateMetadata = {
  sourceFindingEventId: 442,
  sourceUserId: "owner-1",
  findingId: sourceMetadata.findingId,
  objectiveWorkOrderId: "WO-0031",
  issueNumber: 911,
  gate: "POLICY",
  gates: ["POLICY"],
  reason: "changes reviewed policy",
}
const candidate = {
  gateSettlementEventId: 501,
  issuedAt,
  ownerUserId: "owner-1",
  gateMetadata,
  gatePayloadDigest: createHash("sha256").update(JSON.stringify(gateMetadata)).digest("hex"),
  findingId: sourceMetadata.findingId,
  gate: "POLICY",
  gates: ["POLICY"],
  sourceFindingEventId: 442,
  sourceMetadata,
  parentWorkOrderRowId: 31,
  parentWorkOrderRef: "WO-0031",
  authorityGrantId: 18,
  authorityGrantRef: "GRANT-0018",
  authorityGrantLevel: "A2_WRITE_OWN",
  sequence: 2,
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
      sourcePayloadDigest: createHash("sha256").update(JSON.stringify(sourceMetadata)).digest("hex"),
      gateSettlementEventId: 501,
      gatePayloadDigest: createHash("sha256").update(JSON.stringify(gateMetadata)).digest("hex"),
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
    expect(sql).toContain("child.status <> 'completed'")
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
      .rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_REVALIDATION_WALL" })
    expect(query.mock.calls.map(([sql]) => sql).join("\n")).toContain("FOR UPDATE")
  })

  it("revalidates the exact requested gate while independently enforcing oldest actionable order", async () => {
    const requestB = await requestFrom({
      ...candidate,
      gateSettlementEventId: 502,
      findingId: "FINDING-911-B",
      sourceFindingEventId: 443,
      sequence: 3,
      sourceMetadata: { ...sourceMetadata, findingId: "FINDING-911-B", sequence: 3 },
      gateMetadata: {
        ...gateMetadata,
        sourceFindingEventId: 443,
        findingId: "FINDING-911-B",
      },
      gatePayloadDigest: createHash("sha256").update(JSON.stringify({
        ...gateMetadata,
        sourceFindingEventId: 443,
        findingId: "FINDING-911-B",
      })).digest("hex"),
    })
    const verified = await provenance(requestB)
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT gate.id")) {
        return { rows: [params.includes(502) ? {
          ...candidate,
          gateSettlementEventId: 502,
          findingId: "FINDING-911-B",
          sourceFindingEventId: 443,
          sequence: 3,
          sourceMetadata: { ...sourceMetadata, findingId: "FINDING-911-B", sequence: 3 },
          gateMetadata: {
            ...gateMetadata,
            sourceFindingEventId: 443,
            findingId: "FINDING-911-B",
          },
          gatePayloadDigest: requestB.gatePayloadDigest,
        } : candidate] }
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
