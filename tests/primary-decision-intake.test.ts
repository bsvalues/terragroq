import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { CodexAppServerClient } from "@/scripts/hermes-bridge/app-server-client.mjs"
import { consumePrimaryDecisionIntake } from "@/scripts/hermes-bridge/primary-decision-intake.mjs"
import {
  readPendingPrimaryDecisionRequest,
  recordOwnerAuthorityDecision,
} from "@/scripts/hermes-bridge/outcome-source.mjs"
import {
  buildPrimaryDecisionRequestPrompt,
  primaryDecisionRequestMarker,
  primaryDecisionRequestDigest,
  PRIMARY_DECISION_OWNER_EMAIL,
  verifyPrimaryDecisionResponse,
} from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

const repository = process.cwd()
const issuedAt = "2026-08-07T16:00:00.000Z"
const decisionPacket = {
  blockedAction: "Change the Primary Home density",
  authorityBoundary: "Founder product direction",
  minimumChoice: "APPROVE_OR_DENY",
  approveConsequence: "Apply the bounded product change",
  denyConsequence: "Keep the current Home",
}

const request = {
  outcomeId: 77,
  queueItemId: 33,
  workOrderId: 91,
  terminalEventId: 120,
  ownerUserId: "owner-1",
  goalRef: "GOAL-0077",
  workOrderRef: "WO-HERMES-OUTCOME-77",
  outcomeKey: "williamos:primary-home-density",
  queueVersion: 7,
  riskClass: "R1",
  expectedNextState: "RESUME_PRODUCT_DELIVERY",
  issuedAt,
  decisionPacket,
  decisionPacketDigest: createHash("sha256").update(JSON.stringify(decisionPacket)).digest("hex"),
  goalCommand: "Change the WilliamOS Primary Home density",
  goalLane: "ui",
  goalVerdict: "requires_approval",
  goalRequiresApproval: true,
  queueTitle: "Primary Home density",
  queueObjective: "Apply the approved WilliamOS display density",
  authorityLevel: "A2_WRITE_OWN",
  authoritySubject: "operator",
  authorityAction: "outcome:execute",
  approvalDecisionId: 44,
  authorityGrantRef: "AUTH-WILLIAMOS-R1-77",
  recommendation: "DENY",
  recommendationRationale: "Default-deny: WilliamOS reached a Primary authority boundary and cannot infer approval.",
  allowedChoices: ["APPROVE", "DENY"],
}

function fakeClient(responseOverrides: Record<string, unknown> = {}) {
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
      cwd: repository,
      parentThreadId: null,
      agentRole: null,
      requestTurnId: "turn-request",
      requestMessageId: "request-message",
      requestPresentedAt: Date.parse(issuedAt) / 1000 + 5,
      turnId: "turn-owner",
      turnStartedAt: Date.parse(issuedAt) / 1000 + 10,
      turnCompletedAt: Date.parse(issuedAt) / 1000 + 11,
      messageId: "message-owner",
      messageSha256: "b".repeat(64),
      choice: "APPROVE",
      ...responseOverrides,
    })),
  }
}

function decisionBinding(
  decisionPacket = request.decisionPacket,
  overrides: Record<string, unknown> = {},
) {
  return {
    goalId: request.outcomeId,
    goalUserId: request.ownerUserId,
    goalStatus: "dismissed",
    goalCommand: request.goalCommand,
    goalLane: request.goalLane,
    goalVerdict: request.goalVerdict,
    goalRequiresApproval: request.goalRequiresApproval,
    workOrderId: request.workOrderId,
    workOrderUserId: request.ownerUserId,
    latestTerminalId: request.terminalEventId,
    latestTerminalMetadata: {
      result: "OWNER_DECISION_REQUIRED",
      nextState: request.expectedNextState,
      ...decisionPacket,
    },
    requestedTerminalId: request.terminalEventId,
    requestedTerminalUserId: request.ownerUserId,
    requestedTerminalMetadata: {
      result: "OWNER_DECISION_REQUIRED",
      nextState: request.expectedNextState,
      ...decisionPacket,
    },
    terminalUserId: request.ownerUserId,
    latestLeaseMetadata: { leaseStatus: "RELEASED" },
    transactionNow: new Date(Date.parse(issuedAt) + 30_000).toISOString(),
    queueItemId: 33,
    outcomeKey: request.outcomeKey,
    queueVersion: request.queueVersion,
    queueTitle: request.queueTitle,
    queueObjective: request.queueObjective,
    riskClass: request.riskClass,
    approvalState: "approved",
    authorityState: "matched",
    authorityLevel: request.authorityLevel,
    authoritySubject: request.authoritySubject,
    authorityAction: request.authorityAction,
    approvalDecisionId: request.approvalDecisionId,
    authorityGrantRef: request.authorityGrantRef,
    lifecycleState: "blocked",
    activeWorkOrderId: request.workOrderId,
    liveApprovalId: 44,
    liveGrantId: 55,
    liveGrantRef: request.authorityGrantRef,
    ...overrides,
  }
}

describe("secure Primary decision intake", () => {
  it("binds one authenticated direct task response to the exact request without exposing text", async () => {
    const client = fakeClient()
    const response = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => client as never,
    })

    expect(response).toMatchObject({
      choice: "APPROVE",
      accountEmail: PRIMARY_DECISION_OWNER_EMAIL,
      identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestSnapshot: expect.objectContaining({
        outcomeKey: request.outcomeKey,
        queueVersion: request.queueVersion,
        approvalDecisionId: request.approvalDecisionId,
        authorityGrantRef: request.authorityGrantRef,
        recommendation: "DENY",
        recommendationRationale: request.recommendationRationale,
        allowedChoices: ["APPROVE", "DENY"],
      }),
    })
    expect(JSON.stringify(response)).not.toContain("message-owner")
    expect(client.close).toHaveBeenCalled()
    expect(client.readLatestDirectUserChoice).toHaveBeenCalledWith(expect.objectContaining({
      requestMarker: primaryDecisionRequestMarker(request),
    }))
  })

  it.each([
    ["future request", { request: { issuedAt: "2099-01-01T00:00:00.000Z" } }, "PRIMARY_DECISION_REQUEST_INVALID"],
    ["wrong task", { response: { threadId: "other" } }, "PRIMARY_DECISION_RESPONSE_IDENTITY_WALL"],
    ["subagent", { response: { parentThreadId: "parent" } }, "PRIMARY_DECISION_RESPONSE_IDENTITY_WALL"],
    ["wrong repository", { response: { cwd: "C:/other" } }, "PRIMARY_DECISION_REPOSITORY_WALL"],
  ])("rejects %s", async (_name, mutation, code) => {
    const response = (mutation as { response?: Record<string, unknown> }).response ?? {}
    const requestMutation = (mutation as { request?: Record<string, unknown> }).request ?? {}
    await expect(verifyPrimaryDecisionResponse({
      request: { ...request, ...requestMutation },
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: (mutation as { now?: number }).now ?? Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient(response) as never,
    })).rejects.toMatchObject({ code })
  })

  it("starts the response TTL when an old terminal request is presented", async () => {
    const now = Date.parse(issuedAt) + 2 * 60 * 60 * 1000
    const response = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now,
      createClient: () => fakeClient({ requestPresentedAt: now / 1000 - 5 }) as never,
    })

    expect(response.issuedAt).toBe(new Date(now - 5_000).toISOString())
    expect(response.expiresAt).toBe(new Date(now - 5_000 + 60 * 60 * 1000).toISOString())
  })

  it("remains inert for a resident cycle without an authenticated task", async () => {
    const recordDecision = vi.fn()
    await expect(consumePrimaryDecisionIntake({
      environment: {},
      readRequest: vi.fn(async () => request),
      recordDecision,
    })).resolves.toEqual({
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      queueItemId: 33,
      requestDigest: primaryDecisionRequestDigest(request),
      prompt: expect.stringContaining(primaryDecisionRequestMarker(request)),
    })
    expect(recordDecision).not.toHaveBeenCalled()
  })

  it("remains pending when an authenticated task has no response value", async () => {
    const recordDecision = vi.fn()
    await expect(consumePrimaryDecisionIntake({
      environment: { CODEX_THREAD_ID: "thread-owner" },
      readRequest: vi.fn(async () => request),
      verifyResponse: vi.fn(async () => null),
      recordDecision,
    })).resolves.toMatchObject({
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
    })
    expect(recordDecision).not.toHaveBeenCalled()
  })

  it("bounds App Server account reads and closes the client on timeout", async () => {
    const client = fakeClient()
    client.readAccount = vi.fn(() => new Promise(() => {}))
    await expect(verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      timeoutMs: 5,
      createClient: () => client as never,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_APP_SERVER_TIMEOUT" })
    expect(client.close).toHaveBeenCalledOnce()
  })

  it("rejects a verified denial provenance used for an approval", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient({ choice: "DENY" }) as never,
    })
    const query = vi.fn()
    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_PROVENANCE_WALL" })
    expect(query).not.toHaveBeenCalled()
  })

  it("rejects verified provenance bound to a different persisted request", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const differentPacket = {
      ...request.decisionPacket,
      approveConsequence: "Apply a different bounded product change",
    }
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding(differentPacket)] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_PROVENANCE_WALL" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(query.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it("rejects authority revoked while the authenticated response is being verified", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding(request.decisionPacket, {
        authorityState: "revoked",
      })] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_AUTHORITY_STALE" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(query.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it("rejects a queue version changed after the exact request was presented", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding(request.decisionPacket, {
        queueVersion: request.queueVersion + 1,
      })] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_AUTHORITY_STALE" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(query.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it("rejects a revoked live grant even when the queue authority cache still matches", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding(request.decisionPacket, {
        liveGrantId: null,
      })] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_AUTHORITY_STALE" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("rejects a verified response that expires before the recording transaction", async () => {
    const provenance = await verifyPrimaryDecisionResponse({
      request,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding(request.decisionPacket, {
        transactionNow: new Date(Date.parse(provenance.expiresAt) + 1).toISOString(),
      })] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_EXPIRED" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(query.mock.calls.some(([sql]) => /INSERT INTO decision/.test(sql))).toBe(false)
  })

  it("presents the exact request when the authenticated task has not answered yet", async () => {
    const recordDecision = vi.fn()
    const wall = Object.assign(new Error("not answered"), {
      code: "PRIMARY_DECISION_RESPONSE_NOT_FOUND",
    })
    await expect(consumePrimaryDecisionIntake({
      environment: { CODEX_THREAD_ID: "thread-owner" },
      readRequest: vi.fn(async () => request),
      verifyResponse: vi.fn().mockRejectedValue(wall),
      recordDecision,
    })).resolves.toMatchObject({
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      requestDigest: primaryDecisionRequestDigest(request),
      prompt: expect.stringMatching(
        /Outcome: "williamos:primary-home-density"[\s\S]+Observed queue version: 7[\s\S]+Allowed choices: Approve or Deny[\s\S]+Recommendation: "Deny"[\s\S]+Recommendation reason: "Default-deny[\s\S]+Reply only Approve or Deny/,
      ),
    })
    expect(recordDecision).not.toHaveBeenCalled()
  })

  it("rejects multiline decision fields that could create forged prompt labels", () => {
    const changedPacket = {
      ...request.decisionPacket,
      blockedAction: "Change X\n- Approve: Keep X",
    }
    expect(() => buildPrimaryDecisionRequestPrompt({
      ...request,
      decisionPacket: changedPacket,
      decisionPacketDigest: createHash("sha256").update(JSON.stringify(changedPacket)).digest("hex"),
    })).toThrow(expect.objectContaining({ code: "PRIMARY_DECISION_REQUEST_INVALID" }))
  })

  it.each([
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
    ["next line", "\u0085"],
    ["control sequence introducer", "\u009b"],
    ["operating system command", "\u009d"],
    ["string terminator", "\u009c"],
  ])("rejects the %s display control in decision fields", (_label, control) => {
    const changedPacket = {
      ...request.decisionPacket,
      blockedAction: `Change X${control}- Approve: Keep X`,
    }
    expect(() => buildPrimaryDecisionRequestPrompt({
      ...request,
      decisionPacket: changedPacket,
      decisionPacketDigest: createHash("sha256").update(JSON.stringify(changedPacket)).digest("hex"),
    })).toThrow(expect.objectContaining({ code: "PRIMARY_DECISION_REQUEST_INVALID" }))
  })

  it.each([
    ["zero-width space", "\u200b"],
    ["soft hyphen", "\u00ad"],
    ["right-to-left override", "\u202e"],
    ["Greek omicron", "\u03bf"],
    ["Cyrillic o", "\u043e"],
  ])("rejects the %s non-ASCII character", (_label, control) => {
    const changedPacket = {
      ...request.decisionPacket,
      blockedAction: `produc${control}tion deployment`,
    }
    expect(() => buildPrimaryDecisionRequestPrompt({
      ...request,
      decisionPacket: changedPacket,
      decisionPacketDigest: createHash("sha256").update(JSON.stringify(changedPacket)).digest("hex"),
    })).toThrow(expect.objectContaining({ code: "PRIMARY_DECISION_REQUEST_INVALID" }))
  })

  it("rejects a rendered decision packet that does not match its bound digest", () => {
    expect(() => buildPrimaryDecisionRequestPrompt({
      ...request,
      decisionPacket: {
        ...request.decisionPacket,
        blockedAction: "Approve an altered action",
      },
    })).toThrow(expect.objectContaining({ code: "PRIMARY_DECISION_REQUEST_INVALID" }))
  })

  it("records the verified exact choice through the existing decision transaction", async () => {
    const recordDecision = vi.fn(async () => ({
      replayed: false,
      resumeReleased: true,
      decisionRef: "OWNER-DECISION-77-120",
    }))
    const result = await consumePrimaryDecisionIntake({
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      readRequest: vi.fn(async () => request),
      verifyResponse: (input) => verifyPrimaryDecisionResponse({
        ...input,
        now: Date.parse(issuedAt) + 30_000,
        createClient: () => fakeClient() as never,
      }),
      recordDecision,
    })

    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      queueItemId: 33,
      workOrderId: 91,
      terminalEventId: 120,
      ownerUserId: "owner-1",
      choice: "APPROVE",
      expectedNextState: "RESUME_PRODUCT_DELIVERY",
      primaryDecisionProvenance: expect.objectContaining({
        identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
        responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }))
    expect(result).toEqual({
      status: "PRIMARY_DECISION_RECORDED",
      outcomeId: 77,
      queueItemId: 33,
      choice: "APPROVE",
      resumeReleased: true,
      decisionRef: "OWNER-DECISION-77-120",
    })
  })

  it("records a direct decline as a non-resuming denial", async () => {
    const recordDecision = vi.fn(async () => ({
      replayed: false,
      resumeReleased: false,
      decisionRef: "OWNER-DECISION-77-120",
    }))
    const result = await consumePrimaryDecisionIntake({
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      readRequest: vi.fn(async () => request),
      verifyResponse: (input) => verifyPrimaryDecisionResponse({
        ...input,
        now: Date.parse(issuedAt) + 30_000,
        createClient: () => fakeClient({ choice: "DENY" }) as never,
      }),
      recordDecision,
    })
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ choice: "DENY" }))
    expect(result).toMatchObject({ choice: "DENY", resumeReleased: false })
  })

  it("fails closed when more than one persisted request is actionable", async () => {
    const query = vi.fn(async () => ({ rows: [request, { ...request, outcomeId: 78 }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_AMBIGUOUS" })
    expect(query.mock.calls[0][0]).toContain('q."riskClass" IN (\'R0\', \'R1\')')
    expect(query.mock.calls[0][0]).toContain('q."authorityAction" = \'outcome:execute\'')
    expect(query.mock.calls[0][0]).toContain('q."lifecycleState" = \'blocked\'')
    expect(query.mock.calls[0][0]).toContain('q."approvalState" = \'approved\'')
    expect(query.mock.calls[0][0]).toContain('q."authorityState" = \'matched\'')
    expect(query.mock.calls[0][0]).toContain('JOIN decision approval')
    expect(query.mock.calls[0][0]).toContain('JOIN authority_grant grant_row')
    expect(query.mock.calls[0][0]).toContain('grant_row."revokedAt" IS NULL')
    expect(query.mock.calls[0][0]).toContain('grant_row."expiresAt" AT TIME ZONE \'UTC\' > clock_timestamp()')
    expect(query.mock.calls[0][0]).toContain(
      'terminal."createdAt" AT TIME ZONE current_setting(\'TimeZone\') AS "issuedAt"',
    )
    expect(query.mock.calls[0][1]).toEqual([PRIMARY_DECISION_OWNER_EMAIL])
  })

  it("uses one database wall clock for the binding expiry fence and decidedAt", async () => {
    const validRequest = {
      ...request,
      decisionPacketDigest: createHash("sha256")
        .update(JSON.stringify(request.decisionPacket))
        .digest("hex"),
    }
    const provenance = await verifyPrimaryDecisionResponse({
      request: validRequest,
      repositoryPath: repository,
      environment: { CODEX_THREAD_ID: "thread-owner" },
      now: Date.parse(issuedAt) + 30_000,
      createClient: () => fakeClient() as never,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [decisionBinding()] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(recordOwnerAuthorityDecision({
      query,
      outcomeId: request.outcomeId,
      queueItemId: request.queueItemId,
      workOrderId: request.workOrderId,
      terminalEventId: request.terminalEventId,
      ownerUserId: request.ownerUserId,
      choice: "APPROVE",
      expectedNextState: request.expectedNextState,
      primaryDecisionProvenance: provenance,
    })).rejects.toMatchObject({ code: "OWNER_DECISION_RECORD_WALL" })

    const insertCall = query.mock.calls.find(([sql]) => /WITH write_clock AS/.test(sql))
    const bindingCall = query.mock.calls.find(([sql]) => /queue_item AS/.test(sql))
    expect(bindingCall?.[0]).toContain('AND ($7::integer IS NULL OR id = $7::integer)')
    expect(bindingCall?.[0]).toContain('AND "activeWorkOrderId" = $2::integer')
    expect(bindingCall?.[0]).toContain('ORDER BY id DESC')
    expect(bindingCall?.[1].at(-1)).toBe(request.queueItemId)
    expect(insertCall?.[0]).toContain('write_clock.recorded_at <= $11::timestamptz')
    expect(insertCall?.[0]).toContain('grant_row."expiresAt" AT TIME ZONE \'UTC\' > write_clock.recorded_at')
    expect(insertCall?.[0]).toContain("timezone('UTC', write_clock.recorded_at)")
    expect(insertCall?.[0]).toContain('"decidedAt" AT TIME ZONE \'UTC\' AS "decidedAt"')
    expect(insertCall?.[1].at(-2)).toBe(provenance.expiresAt)
    expect(insertCall?.[1].at(-1)).toBe(55)
  })

  it("rejects a terminal packet that crosses the canonical bridge policy", async () => {
    const query = vi.fn(async () => ({ rows: [{
      ...request,
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
        blockedAction: "Deploy this change to production",
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({
      code: "PRIMARY_DECISION_POLICY_WALL",
      reasonCode: "PROTECTED_SCOPE",
    })

    const protectedKeyQuery = vi.fn(async () => ({ rows: [{
      ...request,
      outcomeKey: "williamos:delete-database",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: protectedKeyQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({
      code: "PRIMARY_DECISION_POLICY_WALL",
      reasonCode: "PROTECTED_SCOPE",
    })

    const invisibleScopeQuery = vi.fn(async () => ({ rows: [{
      ...request,
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
        blockedAction: "produc\u200btion deployment",
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: invisibleScopeQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })

    for (const control of ["\u0085", "\u009b", "\u2028", "\u2029"]) {
      const controlScopeQuery = vi.fn(async () => ({ rows: [{
        ...request,
        terminalMetadata: {
          result: "OWNER_DECISION_REQUIRED",
          nextState: request.expectedNextState,
          ...request.decisionPacket,
          blockedAction: `produc${control}tion deployment`,
        },
      }] }))
      await expect(readPendingPrimaryDecisionRequest({
        query: controlScopeQuery,
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })
    }

    for (const confusable of ["\u03bf", "\u043e"]) {
      const homoglyphScopeQuery = vi.fn(async () => ({ rows: [{
        ...request,
        terminalMetadata: {
          result: "OWNER_DECISION_REQUIRED",
          nextState: request.expectedNextState,
          ...request.decisionPacket,
          blockedAction: `pr${confusable}duction deployment`,
        },
      }] }))
      await expect(readPendingPrimaryDecisionRequest({
        query: homoglyphScopeQuery,
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })
    }

    for (const obfuscatedScope of [
      "pr0duction deployment",
      "production dep1oyment",
      "de1ete database",
      "produc-tion deployment",
      "property-workbench",
      "produc+ion deployment",
      "secre+ access",
    ]) {
      const asciiScopeQuery = vi.fn(async () => ({ rows: [{
        ...request,
        terminalMetadata: {
          result: "OWNER_DECISION_REQUIRED",
          nextState: request.expectedNextState,
          ...request.decisionPacket,
          blockedAction: obfuscatedScope,
        },
      }] }))
      await expect(readPendingPrimaryDecisionRequest({
        query: asciiScopeQuery,
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })
    }

    for (const splitScope of [
      "produc tion deployment",
      "pro duc tion deployment",
      "pro duc Tion deployment",
      "p r o d u ction deployment",
      "de lete database",
      "de le te database",
      "Change par cel records",
      "Change pro perty work bench",
      "Change pro tected da ta",
      "in crease the spend",
      "Use to ken value",
      "in crease the sp end",
      "In Crease the spend",
      "a PiKey access",
    ]) {
      const splitScopeQuery = vi.fn(async () => ({ rows: [{
        ...request,
        terminalMetadata: {
          result: "OWNER_DECISION_REQUIRED",
          nextState: request.expectedNextState,
          ...request.decisionPacket,
          blockedAction: splitScope,
        },
      }] }))
      await expect(readPendingPrimaryDecisionRequest({
        query: splitScopeQuery,
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      })).rejects.toMatchObject({
        code: "PRIMARY_DECISION_POLICY_WALL",
        reasonCode: "PROTECTED_SCOPE",
      })
    }

    const benignAdjacentWordsQuery = vi.fn(async () => ({ rows: [{
      ...request,
      queueObjective: "Send update to Ken",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: benignAdjacentWordsQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).resolves.toMatchObject({ outcomeId: request.outcomeId })

    const benignCapitalizedAdjacentWordsQuery = vi.fn(async () => ({ rows: [{
      ...request,
      queueObjective: "Send update To Ken",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: benignCapitalizedAdjacentWordsQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).resolves.toMatchObject({ outcomeId: request.outcomeId })

    const benignSplitDatabaseQuery = vi.fn(async () => ({ rows: [{
      ...request,
      queueObjective: "Change the data base value",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: benignSplitDatabaseQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).resolves.toMatchObject({ outcomeId: request.outcomeId })

    const mixedOutcomeKeyQuery = vi.fn(async () => ({ rows: [{
      ...request,
      outcomeKey: "williamos:product1on-deployment",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: mixedOutcomeKeyQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })

    for (const separatedDigitScope of [
      { outcomeKey: "williamos:product-1-on-deployment" },
      { queueObjective: "Product 1 on deployment" },
    ]) {
      const separatedDigitQuery = vi.fn(async () => ({ rows: [{
        ...request,
        ...separatedDigitScope,
        terminalMetadata: {
          result: "OWNER_DECISION_REQUIRED",
          nextState: request.expectedNextState,
          ...request.decisionPacket,
        },
      }] }))
      await expect(readPendingPrimaryDecisionRequest({
        query: separatedDigitQuery,
        ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
      })).rejects.toMatchObject({ code: "PRIMARY_DECISION_REQUEST_INVALID" })
    }

    const foldedSplitOutcomeKeyQuery = vi.fn(async () => ({ rows: [{
      ...request,
      outcomeKey: "williamos:pr0-duc-tion-deployment",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: foldedSplitOutcomeKeyQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({
      code: "PRIMARY_DECISION_POLICY_WALL",
      reasonCode: "PROTECTED_SCOPE",
    })

    const mixedCaseFoldedOutcomeKeyQuery = vi.fn(async () => ({ rows: [{
      ...request,
      outcomeKey: "williamos:pr0-Duc-tion-deployment",
      terminalMetadata: {
        result: "OWNER_DECISION_REQUIRED",
        nextState: request.expectedNextState,
        ...request.decisionPacket,
      },
    }] }))
    await expect(readPendingPrimaryDecisionRequest({
      query: mixedCaseFoldedOutcomeKeyQuery,
      ownerEmail: PRIMARY_DECISION_OWNER_EMAIL,
    })).rejects.toMatchObject({
      code: "PRIMARY_DECISION_POLICY_WALL",
      reasonCode: "PROTECTED_SCOPE",
    })
  })
})

class FakeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  writes: string[] = []
  stdin = new Writable({
    write: (chunk, _encoding, done) => {
      this.writes.push(String(chunk))
      done()
    },
  })
  send(message: unknown) { this.stdout.write(`${JSON.stringify(message)}\n`) }
  messages() { return this.writes.flatMap((value) => value.trim().split("\n")).map(JSON.parse) }
  kill() { return true }
}

it("projects exactly one allowed choice from the bounded response window", async () => {
  const child = new FakeProcess()
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: "2026-08-07T17:00:00.000Z",
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        threadSource: null,
        source: "vscode",
        cwd: repository,
        parentThreadId: null,
        agentRole: null,
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [{
            id: "request-progress",
            type: "agentMessage",
            text: "Preparing the exact request",
          }, {
            id: "request-message",
            type: "agentMessage",
            text: buildPrimaryDecisionRequestPrompt(request),
          }],
        }, {
          id: "turn-owner",
          status: "interrupted",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          items: [{
            id: "message-owner",
            type: "userMessage",
            content: [{ type: "text", text: " approve " }],
          }],
        }],
      },
    },
  })
  await expect(pending).resolves.toMatchObject({
    choice: "APPROVE",
    messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  client.close()
})

it("rejects a choice when the canonical request was not the final assistant message", async () => {
  const child = new FakeProcess()
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: "2026-08-07T17:00:00.000Z",
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [
            { type: "agentMessage", text: buildPrimaryDecisionRequestPrompt(request) },
            { type: "agentMessage", text: "Request withdrawn" },
          ],
        }, {
          id: "turn-owner",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          completedAt: Date.parse(issuedAt) / 1000 + 11,
          items: [{
            id: "message-owner",
            type: "userMessage",
            content: [{ type: "text", text: "APPROVE" }],
          }],
        }],
      },
    },
  })
  await expect(pending).resolves.toBeNull()
  client.close()
})

it("fails closed when two allowed decision responses exist in the same window", async () => {
  const child = new FakeProcess()
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: "2026-08-07T17:00:00.000Z",
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [{ type: "agentMessage", text: buildPrimaryDecisionRequestPrompt(request) }],
        }, {
          id: "turn-owner",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          completedAt: Date.parse(issuedAt) / 1000 + 11,
          items: ["APPROVE", "DENY"].map((text, index) => ({
            id: `message-${index}`,
            type: "userMessage",
            content: [{ type: "text", text }],
          })),
        }],
      },
    },
  })
  await expect(pending).resolves.toBeNull()
  client.close()
})

it("fails closed when the owner withdraws an earlier choice in the same turn", async () => {
  const child = new FakeProcess()
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: "2026-08-07T17:00:00.000Z",
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [{ type: "agentMessage", text: buildPrimaryDecisionRequestPrompt(request) }],
        }, {
          id: "turn-owner",
          status: "interrupted",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          items: [{
            id: "message-approve",
            type: "userMessage",
            content: [{ type: "text", text: "APPROVE" }],
          }, {
            id: "message-withdraw",
            type: "userMessage",
            content: [{ type: "text", text: "actually wait" }],
          }],
        }],
      },
    },
  })
  await expect(pending).resolves.toBeNull()
  client.close()
})

it("fails closed when a later owner turn withdraws an earlier choice", async () => {
  const child = new FakeProcess()
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: "2026-08-07T17:00:00.000Z",
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [{ type: "agentMessage", text: buildPrimaryDecisionRequestPrompt(request) }],
        }, {
          id: "turn-owner-approve",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          completedAt: Date.parse(issuedAt) / 1000 + 11,
          items: [{
            id: "message-approve",
            type: "userMessage",
            content: [{ type: "text", text: "APPROVE" }],
          }],
        }, {
          id: "turn-owner-withdraw",
          status: "failed",
          startedAt: Date.parse(issuedAt) / 1000 + 20,
          items: [{
            id: "message-withdraw",
            type: "userMessage",
            content: [{ type: "text", text: "actually wait" }],
          }],
        }],
      },
    },
  })
  await expect(pending).resolves.toBeNull()
  client.close()
})

it("fails closed when a withdrawal arrives while the response snapshot is being read", async () => {
  const child = new FakeProcess()
  const verificationStartedAt = "2026-08-07T17:00:00.000Z"
  const client = new CodexAppServerClient({
    spawn: vi.fn(() => child) as never,
    command: "codex",
    args: ["app-server", "--stdio"],
    now: () => Date.parse("2026-08-07T17:00:01.000Z"),
  })
  const connecting = client.connect()
  child.send({ id: child.messages()[0].id, result: { userAgent: "fake" } })
  await connecting
  const pending = client.readLatestDirectUserChoice({
    threadId: "thread-owner",
    requestCreatedAt: issuedAt,
    presentedAfter: issuedAt,
    presentedBefore: verificationStartedAt,
    requestMarker: primaryDecisionRequestMarker(request),
    requestPrompt: buildPrimaryDecisionRequestPrompt(request),
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        turns: [{
          id: "turn-request",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 1,
          completedAt: Date.parse(issuedAt) / 1000 + 2,
          items: [{ type: "agentMessage", text: buildPrimaryDecisionRequestPrompt(request) }],
        }, {
          id: "turn-owner-approve",
          status: "completed",
          startedAt: Date.parse(issuedAt) / 1000 + 10,
          completedAt: Date.parse(issuedAt) / 1000 + 11,
          items: [{
            id: "message-approve",
            type: "userMessage",
            content: [{ type: "text", text: "APPROVE" }],
          }],
        }, {
          id: "turn-owner-withdraw-during-read",
          status: "inProgress",
          startedAt: Date.parse(verificationStartedAt) / 1000 + 0.5,
          items: [{
            id: "message-withdraw-during-read",
            type: "userMessage",
            content: [{ type: "text", text: "actually wait" }],
          }],
        }],
      },
    },
  })
  await expect(pending).resolves.toBeNull()
  client.close()
})
