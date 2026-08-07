import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { CodexAppServerClient } from "./app-server-client.mjs"

export const PRIMARY_DECISION_OWNER_EMAIL = "bsvalues@gmail.com"
export const PRIMARY_DECISION_TTL_MS = 60 * 60 * 1000
const PRIMARY_DECISION_APP_SERVER_TIMEOUT_MS = 30_000

const VERIFIED = new WeakSet()

function wall(code) {
  throw Object.assign(new Error(code), { code })
}

async function withDeadline(promise, timeoutMs) {
  let timer
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error("PRIMARY_DECISION_APP_SERVER_TIMEOUT"),
      { code: "PRIMARY_DECISION_APP_SERVER_TIMEOUT" },
    )), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer)
  }
}

function normalizedPath(value) {
  const resolved = path.resolve(value)
  return process.platform === "win32"
    ? resolved.replaceAll("/", "\\").toLowerCase()
    : resolved
}

function gitCommonDirectory(repositoryPath) {
  const dotGit = path.join(repositoryPath, ".git")
  let gitDirectory = dotGit
  const stat = fs.statSync(dotGit)
  if (stat.isFile()) {
    const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(dotGit, "utf8"))
    if (!match) wall("REPOSITORY_IDENTITY_INVALID")
    gitDirectory = path.resolve(repositoryPath, match[1].trim())
  }
  const commonPath = path.join(gitDirectory, "commondir")
  const commonDirectory = fs.existsSync(commonPath)
    ? path.resolve(gitDirectory, fs.readFileSync(commonPath, "utf8").trim())
    : gitDirectory
  return fs.realpathSync.native(commonDirectory)
}

export function isVerifiedPrimaryDecisionResponse(value) {
  return value !== null && typeof value === "object" && VERIFIED.has(value)
}

export function primaryDecisionRequestDigest(request) {
  return createHash("sha256").update(JSON.stringify({
    outcomeId: request.outcomeId,
    workOrderId: request.workOrderId,
    terminalEventId: request.terminalEventId,
    expectedNextState: request.expectedNextState,
    decisionPacketDigest: request.decisionPacketDigest,
  })).digest("hex")
}

export function primaryDecisionRequestMarker(request) {
  return `WILLIAMOS_PRIMARY_DECISION_REQUEST:${primaryDecisionRequestDigest(request)}`
}

export function buildPrimaryDecisionRequestPrompt(request) {
  return `${primaryDecisionRequestMarker(request)}

WilliamOS needs one Primary decision.

- Decision: ${request.decisionPacket.blockedAction}
- Why: ${request.decisionPacket.authorityBoundary}
- Approve: ${request.decisionPacket.approveConsequence}
- Deny: ${request.decisionPacket.denyConsequence}

Reply only Approve or Deny. This request expires in one hour.`
}

export async function verifyPrimaryDecisionResponse({
  request,
  repositoryPath = process.cwd(),
  environment = process.env,
  now = Date.now(),
  timeoutMs = PRIMARY_DECISION_APP_SERVER_TIMEOUT_MS,
  createClient = () => new CodexAppServerClient({ timeoutMs }),
} = {}) {
  if (!request || typeof request !== "object") wall("PRIMARY_DECISION_REQUEST_INVALID")
  const threadId = environment.CODEX_THREAD_ID
  if (typeof threadId !== "string" || threadId.trim() === "") {
    wall("PRIMARY_DECISION_TASK_IDENTITY_UNAVAILABLE")
  }
  let canonicalRepository
  let canonicalGitDirectory
  try {
    canonicalRepository = fs.realpathSync.native(path.resolve(repositoryPath))
    canonicalGitDirectory = gitCommonDirectory(canonicalRepository)
  } catch {
    wall("REPOSITORY_PATH_INVALID")
  }
  const issuedAtMs = Date.parse(request.issuedAt)
  const expiresAtMs = issuedAtMs + PRIMARY_DECISION_TTL_MS
  if (!Number.isFinite(issuedAtMs) || now >= expiresAtMs) wall("PRIMARY_DECISION_EXPIRED")
  const expiresAt = new Date(expiresAtMs).toISOString()

  const client = createClient()
  let account
  let response
  try {
    await withDeadline(client.connect(), timeoutMs)
    account = await withDeadline(client.readAccount(), timeoutMs)
    response = await withDeadline(client.readLatestDirectUserChoice({
      threadId,
      issuedAfter: request.issuedAt,
      expiresAt,
      requestMarker: primaryDecisionRequestMarker(request),
    }), timeoutMs)
  } finally {
    client.close()
  }
  if (account?.authType !== "chatgpt"
    || typeof account?.email !== "string"
    || account.email.trim().toLowerCase() !== PRIMARY_DECISION_OWNER_EMAIL
    || account.requiresOpenaiAuth !== true) wall("PRIMARY_DECISION_ACCOUNT_WALL")
  if (!response) wall("PRIMARY_DECISION_RESPONSE_NOT_FOUND")
  if (response.threadId !== threadId
    || response.threadSource !== "user"
    || response.source !== "vscode"
    || response.parentThreadId !== null
    || response.agentRole !== null) wall("PRIMARY_DECISION_RESPONSE_IDENTITY_WALL")
  let responseGitDirectory
  try {
    if (typeof response.cwd !== "string" || !path.isAbsolute(response.cwd)) throw new Error()
    responseGitDirectory = gitCommonDirectory(fs.realpathSync.native(response.cwd))
  } catch {
    wall("PRIMARY_DECISION_REPOSITORY_WALL")
  }
  if (normalizedPath(responseGitDirectory) !== normalizedPath(canonicalGitDirectory)) {
    wall("PRIMARY_DECISION_REPOSITORY_WALL")
  }
  if (!["APPROVE", "DENY"].includes(response.choice)) wall("PRIMARY_DECISION_CHOICE_WALL")

  const verified = Object.freeze({
    version: 1,
    choice: response.choice,
    accountEmail: PRIMARY_DECISION_OWNER_EMAIL,
    identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
    requestDigest: primaryDecisionRequestDigest(request),
    responseDigest: createHash("sha256").update(JSON.stringify({
      threadId: response.threadId,
      turnId: response.turnId,
      messageId: response.messageId,
      messageSha256: response.messageSha256,
    })).digest("hex"),
    issuedAt: request.issuedAt,
    expiresAt,
  })
  VERIFIED.add(verified)
  return verified
}
