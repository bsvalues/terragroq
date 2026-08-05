import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { CodexAppServerClient } from "./app-server-client.mjs"

const CONSENT_WINDOW_MS = 24 * 60 * 60 * 1000
const VERIFIED = new WeakSet()

export const PRIMARY_AUTHORIZATION_OWNER_EMAIL = "bsvalues@gmail.com"
export const PRIMARY_AUTHORIZATION_PIN = Object.freeze({
  threadId: "019f2a25-0be9-7423-b659-2a866a9891d6",
  turnId: "019fce78-1c80-77c2-a8f5-228f9995c45f",
  messageId: "item-7191",
  messageSha256: "6e39bc4a56e4af9719a0a6d1a42fad81d6f2ac91fd6b72cce1ddd97627bf42eb",
  scopes: Object.freeze([
    Object.freeze({
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      expectedVersion: 0,
    }),
    Object.freeze({
      outcomeKey: "campaign:v1-2:runtime-continuity-status",
      expectedVersion: 0,
    }),
  ]),
})

export class PrimaryAuthorizationProvenanceError extends Error {
  constructor(code) {
    super(`Primary authorization provenance rejected: ${code}`)
    this.name = "PrimaryAuthorizationProvenanceError"
    this.code = code
  }
}

function reject(code) {
  throw new PrimaryAuthorizationProvenanceError(code)
}

function normalizedPath(value) {
  const normalized = path.resolve(value).replace(/[\\/]+$/, "")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function recordHash(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function isoFromUnixSeconds(value, code) {
  if (!Number.isFinite(value) || value <= 0) reject(code)
  return new Date(value * 1000).toISOString()
}

export function isVerifiedPrimaryAuthorization(value) {
  return value !== null && typeof value === "object" && VERIFIED.has(value)
}

/**
 * Reads one pinned direct-owner message through the authenticated Codex App
 * Server. No caller may provide transcript content, identity, scope, or IDs.
 */
export async function verifyPrimaryAuthorizationProvenance({
  repositoryPath = process.cwd(),
} = {}) {
  let canonicalRepository
  try {
    canonicalRepository = fs.realpathSync.native(path.resolve(repositoryPath))
  } catch {
    reject("REPOSITORY_PATH_INVALID")
  }
  const nowMs = Date.now()

  const client = new CodexAppServerClient({ timeoutMs: 30_000 })
  let account
  let message
  try {
    await client.connect()
    account = await client.readAccount()
    message = await client.readThreadUserMessage(PRIMARY_AUTHORIZATION_PIN)
  } finally {
    client.close()
  }

  if (account?.authType !== "chatgpt"
    || account.email?.trim().toLowerCase() !== PRIMARY_AUTHORIZATION_OWNER_EMAIL
    || account.requiresOpenaiAuth !== true) reject("CODEX_ACCOUNT_WALL")
  if (!message) reject("OWNER_MESSAGE_NOT_FOUND")
  if (message.threadId !== PRIMARY_AUTHORIZATION_PIN.threadId
    || message.turnId !== PRIMARY_AUTHORIZATION_PIN.turnId
    || message.messageId !== PRIMARY_AUTHORIZATION_PIN.messageId
    || message.threadSource !== "user"
    || message.source !== "vscode"
    || message.parentThreadId !== null
    || message.agentRole !== null
    || message.turnStatus !== "completed") reject("OWNER_MESSAGE_IDENTITY_WALL")
  if (normalizedPath(message.cwd ?? "") !== normalizedPath(canonicalRepository)) {
    reject("REPOSITORY_CWD_MISMATCH")
  }
  if (message.textSha256 !== PRIMARY_AUTHORIZATION_PIN.messageSha256) {
    reject("OWNER_REQUEST_HASH_MISMATCH")
  }

  const issuedAt = isoFromUnixSeconds(message.turnStartedAt, "ISSUED_AT_INVALID")
  const completedAt = isoFromUnixSeconds(message.turnCompletedAt, "COMPLETED_AT_INVALID")
  const expiresAt = new Date(Date.parse(issuedAt) + CONSENT_WINDOW_MS).toISOString()
  if (Date.parse(completedAt) < Date.parse(issuedAt)) reject("TURN_TIME_INVALID")
  if (nowMs >= Date.parse(expiresAt)) reject("OWNER_CONSENT_EXPIRED")

  const authorization = Object.freeze({
    version: 1,
    action: "APPROVE",
    identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
    accountEmail: PRIMARY_AUTHORIZATION_OWNER_EMAIL,
    threadSource: message.threadSource,
    originator: "Codex App Server",
    threadId: message.threadId,
    turnId: message.turnId,
    messageId: message.messageId,
    messageSha256: PRIMARY_AUTHORIZATION_PIN.messageSha256,
    sessionMetaSha256: recordHash({
      threadId: message.threadId,
      threadSource: message.threadSource,
      source: message.source,
      cwd: canonicalRepository,
      parentThreadId: message.parentThreadId,
      agentRole: message.agentRole,
    }),
    nonce: sha256(`${message.threadId}:${message.turnId}:${message.messageId}`).slice(0, 32),
    issuedAt,
    expiresAt,
    scopes: PRIMARY_AUTHORIZATION_PIN.scopes,
  })
  VERIFIED.add(authorization)
  return authorization
}
