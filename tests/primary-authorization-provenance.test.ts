import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  account: {
    authType: "chatgpt",
    email: "bsvalues@gmail.com",
    requiresOpenaiAuth: true,
  },
  message: null as Record<string, unknown> | null,
  connect: vi.fn(),
  close: vi.fn(),
}))

vi.mock("@/scripts/hermes-bridge/app-server-client.mjs", () => ({
  CodexAppServerClient: class {
    connect = boundary.connect
    close = boundary.close
    readAccount = vi.fn(async () => boundary.account)
    readThreadUserMessage = vi.fn(async () => boundary.message)
  },
}))

import {
  isVerifiedPrimaryAuthorization,
  PRIMARY_AUTHORIZATION_PIN,
  verifyPrimaryAuthorizationProvenance,
} from "@/scripts/hermes-bridge/primary-authorization-provenance.mjs"

const REPOSITORY = process.cwd()
const STARTED_AT = 1_785_875_405
const COMPLETED_AT = 1_785_876_237
const NOW = new Date((STARTED_AT * 1000) + 30 * 60 * 1000)

function ownerMessage(overrides: Record<string, unknown> = {}) {
  return {
    threadId: PRIMARY_AUTHORIZATION_PIN.threadId,
    threadSource: "user",
    source: "vscode",
    cwd: REPOSITORY,
    parentThreadId: null,
    agentRole: null,
    turnId: PRIMARY_AUTHORIZATION_PIN.turnId,
    turnStatus: "completed",
    turnStartedAt: STARTED_AT,
    turnCompletedAt: COMPLETED_AT,
    messageId: PRIMARY_AUTHORIZATION_PIN.messageId,
    textSha256: PRIMARY_AUTHORIZATION_PIN.messageSha256,
    ...overrides,
  }
}

describe("primary authorization provenance", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it("binds the authenticated account to the exact pinned direct-owner item", async () => {
    boundary.account = {
      authType: "chatgpt",
      email: "bsvalues@gmail.com",
      requiresOpenaiAuth: true,
    }
    boundary.message = ownerMessage()
    const result = await verifyPrimaryAuthorizationProvenance({ repositoryPath: REPOSITORY })

    expect(isVerifiedPrimaryAuthorization(result)).toBe(true)
    expect(result).toMatchObject({
      accountEmail: "bsvalues@gmail.com",
      identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
      threadId: PRIMARY_AUTHORIZATION_PIN.threadId,
      turnId: PRIMARY_AUTHORIZATION_PIN.turnId,
      messageId: PRIMARY_AUTHORIZATION_PIN.messageId,
      scopes: PRIMARY_AUTHORIZATION_PIN.scopes,
    })
    expect(boundary.connect).toHaveBeenCalled()
    expect(boundary.close).toHaveBeenCalled()
  })

  it.each([
    ["wrong account", { account: { authType: "chatgpt", email: "other@example.test", requiresOpenaiAuth: true } }, "CODEX_ACCOUNT_WALL"],
    ["missing item", { message: null }, "OWNER_MESSAGE_NOT_FOUND"],
    ["subagent thread", { message: ownerMessage({ parentThreadId: "parent" }) }, "OWNER_MESSAGE_IDENTITY_WALL"],
    ["wrong thread", { message: ownerMessage({ threadId: "other" }) }, "OWNER_MESSAGE_IDENTITY_WALL"],
    ["wrong repository", { message: ownerMessage({ cwd: "C:/other" }) }, "REPOSITORY_CWD_MISMATCH"],
    ["unrelated message", { message: ownerMessage({ textSha256: "0".repeat(64) }) }, "OWNER_REQUEST_HASH_MISMATCH"],
  ])("rejects %s", async (_name, mutation, code) => {
    boundary.account = {
      authType: "chatgpt",
      email: "bsvalues@gmail.com",
      requiresOpenaiAuth: true,
    }
    boundary.message = ownerMessage()
    Object.assign(boundary, mutation)
    await expect(verifyPrimaryAuthorizationProvenance({ repositoryPath: REPOSITORY }))
      .rejects.toMatchObject({ code })
  })

  it("rejects expired pinned consent", async () => {
    boundary.account = {
      authType: "chatgpt",
      email: "bsvalues@gmail.com",
      requiresOpenaiAuth: true,
    }
    boundary.message = ownerMessage()
    vi.setSystemTime(new Date((STARTED_AT * 1000) + 24 * 60 * 60 * 1000))
    await expect(verifyPrimaryAuthorizationProvenance({ repositoryPath: REPOSITORY }))
      .rejects.toMatchObject({ code: "OWNER_CONSENT_EXPIRED" })
  })

  it("does not accept structurally identical forged authorization objects", async () => {
    expect(isVerifiedPrimaryAuthorization({
      identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
      scopes: PRIMARY_AUTHORIZATION_PIN.scopes,
    })).toBe(false)
  })
})
