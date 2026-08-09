import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { CodexAppServerClient } from "./app-server-client.mjs"

export const PRIMARY_DECISION_OWNER_EMAIL = "bsvalues@gmail.com"
export const PRIMARY_DECISION_TTL_MS = 60 * 60 * 1000
const PRIMARY_DECISION_APP_SERVER_TIMEOUT_MS = 30_000
const PRIMARY_DECISION_DEFAULT_DENY_RATIONALE = "Default-deny: WilliamOS reached a Primary authority boundary and cannot infer approval."

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

export function derivePrimaryDecisionRecommendation({ riskClass, decisionPacket } = {}) {
  if (!["R0", "R1"].includes(riskClass)
    || typeof decisionPacket?.authorityBoundary !== "string"
    || decisionPacket.authorityBoundary.trim() === "") {
    wall("PRIMARY_DECISION_REQUEST_INVALID")
  }
  return Object.freeze({
    choice: "DENY",
    rationale: PRIMARY_DECISION_DEFAULT_DENY_RATIONALE,
  })
}

export function primaryDecisionRequestSnapshot(request) {
  const snapshot = {
    outcomeKey: request?.outcomeKey,
    queueVersion: request?.queueVersion,
    riskClass: request?.riskClass,
    authorityLevel: request?.authorityLevel,
    authoritySubject: request?.authoritySubject,
    authorityAction: request?.authorityAction,
    approvalDecisionId: request?.approvalDecisionId,
    authorityGrantRef: request?.authorityGrantRef,
    recommendation: request?.recommendation,
    recommendationRationale: request?.recommendationRationale,
    allowedChoices: Array.isArray(request?.allowedChoices) ? [...request.allowedChoices] : null,
  }
  if (typeof snapshot.outcomeKey !== "string" || snapshot.outcomeKey.trim() === ""
    || !Number.isSafeInteger(snapshot.queueVersion) || snapshot.queueVersion < 0
    || !["R0", "R1"].includes(snapshot.riskClass)
    || [snapshot.authorityLevel, snapshot.authoritySubject, snapshot.authorityAction,
      snapshot.authorityGrantRef].some((value) => typeof value !== "string" || value.trim() === "")
    || !Number.isSafeInteger(snapshot.approvalDecisionId) || snapshot.approvalDecisionId <= 0
    || !["APPROVE", "DENY"].includes(snapshot.recommendation)
    || typeof snapshot.recommendationRationale !== "string"
    || snapshot.recommendationRationale.trim() === ""
    || JSON.stringify(snapshot.allowedChoices) !== JSON.stringify(["APPROVE", "DENY"])) {
    wall("PRIMARY_DECISION_REQUEST_INVALID")
  }
  return Object.freeze({ ...snapshot, allowedChoices: Object.freeze(snapshot.allowedChoices) })
}

export function assertPrimaryDecisionTextSafety(value) {
  const text = String(value)
  if (!/^[\x20-\x7e]*$/.test(text)) {
    wall("PRIMARY_DECISION_REQUEST_INVALID")
  }
  return text
}

export function assertPrimaryDecisionPacketSafety(packet) {
  if (packet === null || typeof packet !== "object" || Array.isArray(packet)
    || packet.minimumChoice !== "APPROVE_OR_DENY") {
    wall("PRIMARY_DECISION_REQUEST_INVALID")
  }
  for (const field of ["blockedAction", "authorityBoundary", "approveConsequence", "denyConsequence"]) {
    if (typeof packet[field] !== "string") wall("PRIMARY_DECISION_REQUEST_INVALID")
    const text = assertPrimaryDecisionTextSafety(packet[field])
    if (!/^[A-Za-z0-9 ]+[.!?]?$/.test(text)
      || /[A-Za-z][0-9]|[0-9][A-Za-z]/.test(text)) {
      wall("PRIMARY_DECISION_REQUEST_INVALID")
    }
  }
  return packet
}

function assertDecisionPacketBinding(request) {
  if (request?.decisionPacket === undefined) return
  if (request.decisionPacket === null || typeof request.decisionPacket !== "object"
    || Array.isArray(request.decisionPacket)
    || typeof request.decisionPacketDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(request.decisionPacketDigest)) {
    wall("PRIMARY_DECISION_REQUEST_INVALID")
  }
  assertPrimaryDecisionPacketSafety(request.decisionPacket)
  const digest = createHash("sha256")
    .update(JSON.stringify(request.decisionPacket))
    .digest("hex")
  if (digest !== request.decisionPacketDigest) wall("PRIMARY_DECISION_REQUEST_INVALID")
}

export function primaryDecisionRequestDigest(request) {
  assertDecisionPacketBinding(request)
  return createHash("sha256").update(JSON.stringify({
    outcomeId: request.outcomeId,
    queueItemId: request.queueItemId,
    workOrderId: request.workOrderId,
    terminalEventId: request.terminalEventId,
    expectedNextState: request.expectedNextState,
    decisionPacketDigest: request.decisionPacketDigest,
    ...primaryDecisionRequestSnapshot(request),
  })).digest("hex")
}

export function primaryDecisionRequestMarker(request) {
  return `WILLIAMOS_PRIMARY_DECISION_REQUEST:${primaryDecisionRequestDigest(request)}`
}

function presentedString(value) {
  return JSON.stringify(assertPrimaryDecisionTextSafety(value))
}

export function buildPrimaryDecisionRequestPrompt(request) {
  assertDecisionPacketBinding(request)
  return `${primaryDecisionRequestMarker(request)}

WilliamOS needs one Primary decision.

- Outcome: ${presentedString(request.outcomeKey)}
- Observed queue version: ${request.queueVersion}
- Observed terminal event: ${request.terminalEventId}
- Authority: ${presentedString(request.authorityLevel)} / ${presentedString(request.authoritySubject)} / ${presentedString(request.authorityAction)}
- Approval record: ${request.approvalDecisionId}
- Authority grant: ${presentedString(request.authorityGrantRef)}
- Allowed choices: Approve or Deny
- Recommendation: ${presentedString(request.recommendation === "APPROVE" ? "Approve" : "Deny")}
- Recommendation reason: ${presentedString(request.recommendationRationale)}
- Decision: ${presentedString(request.decisionPacket.blockedAction)}
- Why: ${presentedString(request.decisionPacket.authorityBoundary)}
- Approve: ${presentedString(request.decisionPacket.approveConsequence)}
- Deny: ${presentedString(request.decisionPacket.denyConsequence)}

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
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > now) wall("PRIMARY_DECISION_REQUEST_INVALID")
  const presentedAfter = new Date(Math.max(issuedAtMs, now - PRIMARY_DECISION_TTL_MS)).toISOString()
  const presentedBefore = new Date(now).toISOString()

  const client = createClient()
  let account
  let response
  try {
    await withDeadline(client.connect(), timeoutMs)
    account = await withDeadline(client.readAccount(), timeoutMs)
    const responseInput = {
      threadId,
      requestCreatedAt: request.issuedAt,
      presentedAfter,
      presentedBefore,
      requestMarker: primaryDecisionRequestMarker(request),
      requestPrompt: buildPrimaryDecisionRequestPrompt(request),
    }
    const firstResponse = await withDeadline(client.readLatestDirectUserChoice(responseInput), timeoutMs)
    response = await withDeadline(client.readLatestDirectUserChoice(responseInput), timeoutMs)
    if (!firstResponse || !response || JSON.stringify(firstResponse) !== JSON.stringify(response)) {
      response = null
    }
  } finally {
    client.close()
  }
  if (account?.authType !== "chatgpt"
    || typeof account?.email !== "string"
    || account.email.trim().toLowerCase() !== PRIMARY_DECISION_OWNER_EMAIL
    || account.requiresOpenaiAuth !== true) wall("PRIMARY_DECISION_ACCOUNT_WALL")
  if (!response) wall("PRIMARY_DECISION_RESPONSE_NOT_FOUND")
  if (response.threadId !== threadId
    || !["user", null].includes(response.threadSource)
    || response.source !== "vscode"
    || response.parentThreadId !== null
    || response.agentRole !== null
    || ![response.requestTurnId, response.requestMessageId, response.turnId, response.messageId]
      .every((value) => typeof value === "string" && value.trim() !== "")
    || typeof response.messageSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(response.messageSha256)
    || typeof response.threadSnapshotSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(response.threadSnapshotSha256)) {
    wall("PRIMARY_DECISION_RESPONSE_IDENTITY_WALL")
  }
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

  const requestPresentedAtMs = Number(response.requestPresentedAt) * 1_000
  if (!Number.isFinite(requestPresentedAtMs)
    || requestPresentedAtMs < issuedAtMs
    || requestPresentedAtMs < now - PRIMARY_DECISION_TTL_MS
    || requestPresentedAtMs > now) wall("PRIMARY_DECISION_EXPIRED")
  const provenanceIssuedAt = new Date(requestPresentedAtMs).toISOString()
  const expiresAt = new Date(requestPresentedAtMs + PRIMARY_DECISION_TTL_MS).toISOString()

  const verified = Object.freeze({
    version: 2,
    choice: response.choice,
    accountEmail: PRIMARY_DECISION_OWNER_EMAIL,
    identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
    requestDigest: primaryDecisionRequestDigest(request),
    requestSnapshot: primaryDecisionRequestSnapshot(request),
    responseDigest: createHash("sha256").update(JSON.stringify({
      threadId: response.threadId,
      requestTurnId: response.requestTurnId,
      requestMessageId: response.requestMessageId,
      turnId: response.turnId,
      messageId: response.messageId,
      messageSha256: response.messageSha256,
      threadSnapshotSha256: response.threadSnapshotSha256,
    })).digest("hex"),
    issuedAt: provenanceIssuedAt,
    expiresAt,
  })
  VERIFIED.add(verified)
  return verified
}
