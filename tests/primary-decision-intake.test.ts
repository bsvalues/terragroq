import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"

import { CodexAppServerClient } from "@/scripts/hermes-bridge/app-server-client.mjs"
import { consumePrimaryDecisionIntake } from "@/scripts/hermes-bridge/primary-decision-intake.mjs"
import {
  readPendingPrimaryDecisionRequest,
  recordOwnerAuthorityDecision,
} from "@/scripts/hermes-bridge/outcome-source.mjs"
import {
  primaryDecisionRequestMarker,
  primaryDecisionRequestDigest,
  PRIMARY_DECISION_OWNER_EMAIL,
  verifyPrimaryDecisionResponse,
} from "@/scripts/hermes-bridge/primary-decision-provenance.mjs"

const repository = process.cwd()
const issuedAt = "2026-08-07T16:00:00.000Z"

const request = {
  outcomeId: 77,
  workOrderId: 91,
  terminalEventId: 120,
  ownerUserId: "owner-1",
  goalRef: "GOAL-0077",
  workOrderRef: "WO-HERMES-OUTCOME-77",
  outcomeKey: "williamos:primary-home-density",
  riskClass: "R1",
  expectedNextState: "RESUME_PRODUCT_DELIVERY",
  issuedAt,
  decisionPacket: {
    blockedAction: "Change the Primary Home density",
    authorityBoundary: "Founder product direction",
    minimumChoice: "APPROVE_OR_DENY",
    approveConsequence: "Apply the bounded product change",
    denyConsequence: "Keep the current Home",
  },
  decisionPacketDigest: "a".repeat(64),
  goalCommand: "Change the WilliamOS Primary Home density",
  goalLane: "ui",
  goalVerdict: "requires_approval",
  goalRequiresApproval: true,
  queueTitle: "Primary Home density",
  queueObjective: "Apply the approved WilliamOS display density",
  authorityLevel: "A2_WRITE_OWN",
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
    queueTitle: request.queueTitle,
    queueObjective: request.queueObjective,
    riskClass: request.riskClass,
    approvalState: "approved",
    authorityState: "matched",
    authorityLevel: request.authorityLevel,
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "blocked",
    activeWorkOrderId: request.workOrderId,
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
      prompt: expect.stringContaining("Reply only Approve or Deny"),
    })
    expect(recordDecision).not.toHaveBeenCalled()
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
    expect(query.mock.calls[0][1]).toEqual([PRIMARY_DECISION_OWNER_EMAIL])
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
  })
  const rpc = child.messages().at(-1)
  child.send({
    id: rpc.id,
    result: {
      thread: {
        id: "thread-owner",
        threadSource: "user",
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
            id: "request-message",
            type: "agentMessage",
            text: `Decision needed\n${primaryDecisionRequestMarker(request)}`,
          }],
        }, {
          id: "turn-owner",
          status: "inProgress",
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
          items: [{ type: "agentMessage", text: primaryDecisionRequestMarker(request) }],
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
