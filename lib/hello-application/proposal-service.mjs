import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
import { runCerebrasHelloTurn } from "./cerebras-turn.mjs"
import { resolveHelloExecutionRoute } from "./execution-routing.mjs"
import { assertHelloValidationWorkspace, validateHelloApplicationInContainer } from "./proposal-validation.mjs"
import { createProposalEngine } from "../applications/proposal-engine.mjs"
import { readBoundedRegularFile } from "../applications/proposal-artifacts.mjs"
import { runGovernedResidentChangeTransaction } from "../applications/proposal-resident-change.mjs"
import { readResidentProposalEvidence, readResidentProposalPolicy } from "../applications/resident-proposal-turn.mjs"
import {
  deleteOwnedProposalBranch,
  runGovernedApplyLifecycle,
  runGovernedApplyTransaction,
  runGovernedCreateTransaction,
  runGovernedRejectLifecycleSync,
} from "../applications/proposal-transaction-core.mjs"
import {
  acquireApplicationRepositoryLock,
  reconcileTerminalApplicationRepositoryLock,
  releaseApplicationRepositoryLock,
} from "../applications/proposal-repository-lock.mjs"

const HELLO_PROPOSAL_ENGINE = createProposalEngine({
  applicationId: "hello-application",
  displayName: "Hello Application",
  allowedPaths: [
    "examples/hello-application/src/app.js",
    "examples/hello-application/src/index.html",
    "examples/hello-application/src/styles.css",
  ],
  validationPaths: [
    "examples/hello-application/src/app.js",
    "examples/hello-application/src/index.html",
    "examples/hello-application/src/styles.css",
    "examples/hello-application/package.json",
    "examples/hello-application/server.mjs",
    "examples/hello-application/test/hello.test.mjs",
  ],
  validationCommand: "node --test examples/hello-application/test/hello.test.mjs",
  namespace: "hello-application-proposals",
  receiptSchemaVersion: 2,
  errorPrefix: "HELLO_PROPOSAL",
  promptKind: "hello-legacy",
})
export const HELLO_APPLICATION_ALLOWED_PATHS = HELLO_PROPOSAL_ENGINE.allowedPaths
const VALIDATION_PATHS = [...HELLO_APPLICATION_ALLOWED_PATHS, "examples/hello-application/package.json", "examples/hello-application/server.mjs", "examples/hello-application/test/hello.test.mjs"]
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256 = /^[0-9a-f]{64}$/
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_PATCH_BYTES = 256 * 1024
const MAX_RECEIPT_BYTES = 128 * 1024
const MAX_SOURCE_FILE_BYTES = 512 * 1024
const MAX_SOURCE_TOTAL_BYTES = 1024 * 1024
const MAX_REJECTION_REASON_LENGTH = 500
const RESIDENT_TURN_TIMEOUT_MS = 1_800_000
const RESIDENT_TRANSACTION_TIMEOUT_MS = 5_400_000
const COMMAND = "node --test examples/hello-application/test/hello.test.mjs"
const PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES is editing the isolated workspace"],
  ["resident_finished", "HERMES editing finished"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
]
const EXTERNAL_PROGRESS = [
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated workspace ready"],
  ["resident_started", "HERMES sent the bounded request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded change"],
  ["validation_started", "Contained validation started"],
  ["ready_for_review", "Proposal ready for review"],
]
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const filePath = (root, item) => path.join(root, ...item.split("/"))
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && !/[\0\r\n]/.test(value)
const safeId = (value) => typeof value === "string" && SAFE_ID.test(value)
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
    cwd: options.cwd, env: options.env, encoding: options.encoding ?? "utf8", windowsHide: true,
    timeout: 60_000, maxBuffer: options.maxBuffer ?? 2_000_000,
  }, (error, stdout, stderr) => {
    if (error && !options.allowFailure) reject(new Error(options.errorCode ?? "HELLO_PROPOSAL_COMMAND_FAILED"))
    else {
      const numericCode = error && Number.isInteger(error.code) ? error.code : error ? -1 : 0
      resolve({ code: numericCode, executionFailure: !!error && numericCode === -1, stdout, stderr })
    }
    })
    if (options.input !== undefined) {
      child.stdin?.on("error", () => { /* command failure is reported by the exec callback */ })
      child.stdin?.end(options.input)
    }
  })
}
const git = (root, args, options = {}) => run("git", ["--no-replace-objects", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false", "-C", root, ...args], {
  ...options,
  env: {
    ...(options.env ?? process.env),
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  },
})
function required(value, name) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new TypeError(`${name} is required`)
  return value.trim()
}
function request(value) {
  if (typeof value !== "string") throw new Error("HELLO_PROPOSAL_REQUEST_INVALID")
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2_000 || trimmed.includes("\0")) throw new Error("HELLO_PROPOSAL_REQUEST_INVALID")
  return trimmed
}
function rejectionReason(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) {
    throw new Error("HELLO_PROPOSAL_REJECTION_INVALID")
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_REJECTION_REASON_LENGTH) {
    throw new Error("HELLO_PROPOSAL_REJECTION_INVALID")
  }
  return trimmed
}
function policy(repository) {
  return readResidentProposalPolicy(repository, "HELLO_PROPOSAL")
}
function pathsFor(runtime, id) {
  if (!ID.test(id)) throw new Error("HELLO_PROPOSAL_ID_INVALID")
  const root = path.join(path.resolve(runtime), "hello-application-proposals")
  return { root, receipt: path.join(root, `${id}.json`), patch: path.join(root, `${id}.patch`),
    quarantine: path.join(root, `${id}.quarantine`), inflight: path.join(root, `${id}.inflight`),
    applyBinding: path.join(root, `${id}.apply-binding`) }
}
function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" })
    const descriptor = fs.openSync(temporary, "r+")
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    fs.renameSync(temporary, target)
  } finally { fs.rmSync(temporary, { force: true }) }
}
function encodedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}
function writeExclusiveSynced(target, encoded, onCreated) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  let descriptor
  try {
    descriptor = fs.openSync(target, "wx")
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
    throw error
  }
  onCreated?.()
  try {
    const bytes = Buffer.from(encoded)
    let offset = 0
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (written <= 0) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
      offset += written
    }
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}
function syncFile(target) {
  const descriptor = fs.openSync(target, "r+")
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}
function removeCreationArtifactVerified(target) {
  try { fs.rmSync(target, { force: true }) } catch { /* Verification below decides publication cleanup. */ }
  try { return !fs.existsSync(target) } catch { return false }
}
async function repositoryRoot(root) {
  const real = fs.realpathSync(path.resolve(required(root, "repositoryRoot")))
  const top = (await git(real, ["rev-parse", "--show-toplevel"])).stdout.trim()
  if (fs.realpathSync(top) !== real) throw new Error("HELLO_PROPOSAL_REPOSITORY_INVALID")
  return real
}
function changed(status) {
  const result = []
  for (const entry of String(status).split("\0").filter(Boolean)) {
    const code = entry.slice(0, 2)
    const item = entry.slice(3).replaceAll("\\", "/")
    if (code !== " M" || !item) throw new Error(code.includes("R") || code.includes("C") ? "HELLO_PROPOSAL_RENAME_REFUSED" : "HELLO_PROPOSAL_PATH_REFUSED")
    result.push(item)
  }
  return [...new Set(result)].sort()
}
export function assertHelloApplicationChangedPaths(paths, ignored = []) {
  HELLO_PROPOSAL_ENGINE.assertChangedPaths(paths, ignored)
}
function regularFile(root, item) {
  let cursor = root
  const parts = item.split("/")
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part)
    const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
  return cursor
}
function sourceSize(stat) {
  const size = typeof stat.size === "bigint" ? stat.size : Number.isSafeInteger(stat.size) ? BigInt(stat.size) : -1n
  if (size < 0n || size >= BigInt(MAX_SOURCE_FILE_BYTES)) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
  return size
}
function sameIdentity(left, right) { return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino) }
function sameObservedFile(left, right) {
  return sameIdentity(left, right)
    && ["mode", "size", "nlink", "mtimeNs", "ctimeNs"].every((key) => String(left[key]) === String(right[key]))
}
function assertOpenFile(descriptorStat, pathStat) {
  if (!descriptorStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink() || !sameIdentity(descriptorStat, pathStat)) {
    throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
  const descriptorSize = sourceSize(descriptorStat)
  const pathSize = sourceSize(pathStat)
  if (descriptorSize !== pathSize) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
  return descriptorSize
}
function closeValidationFiles(files) {
  for (const file of files.values()) { try { fs.closeSync(file.descriptor) } catch { /* Best effort after every bounded read path. */ } }
}
function boundedValidationFiles(root) {
  const files = new Map()
  let total = 0n
  try {
    for (const item of VALIDATION_PATHS) {
      const target = regularFile(root, item)
      const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow)
      files.set(item, { target, descriptor })
      const accepted = fs.fstatSync(descriptor, { bigint: true })
      const pathStat = fs.lstatSync(target, { bigint: true })
      const size = assertOpenFile(accepted, pathStat)
      total += size
      if (total >= BigInt(MAX_SOURCE_TOTAL_BYTES)) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
      files.set(item, { target, descriptor, accepted, mode: Number(accepted.mode & 0o777n), size: Number(size) })
    }
    return files
  } catch (error) {
    closeValidationFiles(files)
    if (error instanceof Error && error.message.startsWith("HELLO_PROPOSAL_")) throw error
    throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
}
function readBoundedFile(root, item, file) {
  const bytes = Buffer.allocUnsafe(file.size)
  let offset = 0
  while (offset < bytes.length) {
    const count = fs.readSync(file.descriptor, bytes, offset, bytes.length - offset, offset)
    if (count <= 0) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
    offset += count
  }
  const probe = Buffer.allocUnsafe(1)
  if (fs.readSync(file.descriptor, probe, 0, 1, bytes.length) !== 0) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
  const after = fs.fstatSync(file.descriptor, { bigint: true })
  const target = regularFile(root, item)
  const pathStat = fs.lstatSync(target, { bigint: true })
  assertOpenFile(after, pathStat)
  if (!sameObservedFile(file.accepted, after) || !sameObservedFile(after, pathStat)) {
    if (sourceSize(file.accepted) !== sourceSize(after)) throw new Error("HELLO_PROPOSAL_SOURCE_SIZE_REFUSED")
    throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
  return bytes
}
function snapshot(root, paths = VALIDATION_PATHS) {
  const files = boundedValidationFiles(root)
  try {
    return new Map(paths.map((item) => {
      const file = files.get(item)
      if (!file) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
      return [item, {
        bytes: readBoundedFile(root, item, file),
        mode: file.mode,
        identity: { dev: String(file.accepted.dev), ino: String(file.accepted.ino) },
      }]
    }))
  } finally { closeValidationFiles(files) }
}
function sameFile(left, right) { return left.mode === right.mode && left.bytes.equals(right.bytes) }
function assertSnapshot(root, expected, code) {
  const actual = snapshot(root, [...expected.keys()])
  for (const [item, original] of expected) if (!sameFile(original, actual.get(item))) throw new Error(code)
}
function validationResult(value) {
  if (!value || !equal(Object.keys(value).sort(), ["command", "output", "status"]) || value.status !== "passed"
    || value.command !== COMMAND || typeof value.output !== "string" || value.output.length > 12_000) throw new Error("HELLO_PROPOSAL_VALIDATION_FAILED")
  return value
}

export function governedPrompt(requestText) {
  return HELLO_PROPOSAL_ENGINE.governedPrompt(requestText)
}
/**
 * @param {{ client: { runTurn: (input: { threadId: string, prompt: string, timeoutMs: number }) => Promise<any> }, threadId: string, requestText: string, readChangedPaths: () => Promise<string[]>, timeoutMs?: number, maximumAttempts?: number, verifyAttempt?: (outcome: any) => any, now?: () => number }} options
 * @returns {Promise<{ turn: any, turnId: string, completionMode: "MODEL_OUTPUT_VALID" | "HOST_OBSERVED_OUTPUT_INVALID", changedPaths: string[], attempts: number }>}
 */
export async function runGovernedResidentChange({ client, threadId, requestText, readChangedPaths, timeoutMs = RESIDENT_TRANSACTION_TIMEOUT_MS, maximumAttempts = 3, verifyAttempt, now = Date.now }) {
  return runGovernedResidentChangeTransaction({
    client,
    threadId,
    requestText,
    parseRequest: request,
    promptForRequest: governedPrompt,
    readChangedPaths,
    assertChangedPaths: assertHelloApplicationChangedPaths,
    errorPrefix: "HELLO_PROPOSAL",
    timeoutMs,
    turnTimeoutMs: RESIDENT_TURN_TIMEOUT_MS,
    maximumAttempts,
    verifyAttempt,
    now,
  })
}
function readResidentEvidence({ runtimeRoot, workspacePath, threadId, outcomes, reviewed }) {
  return readResidentProposalEvidence({ runtimeRoot, workspacePath, threadId, outcomes, reviewed, errorPrefix: "HELLO_PROPOSAL" })
}
async function defaultResident({ repositoryRoot, runtimeRoot, workspacePath, requestText }) {
  const reviewed = policy(repositoryRoot)
  const backend = new ResidentModelExecutionBackend({ repositoryRoot, runtimeRoot })
  const client = await backend.runCodexClient({ workspacePath, timeoutMs: RESIDENT_TURN_TIMEOUT_MS })
  try {
    await client.connect()
    const threadId = await client.startThread()
    if (!ID.test(threadId)) throw new Error("HELLO_PROPOSAL_RESIDENT_EVIDENCE_INVALID")
    const outcomes = []
    let evidence
    const result = await runGovernedResidentChange({ client, threadId, requestText,
      readChangedPaths: async () => changed((await git(workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout),
      verifyAttempt: (outcome) => {
        outcomes.push(outcome)
        evidence = readResidentEvidence({ runtimeRoot, workspacePath, threadId, outcomes, reviewed })
        return evidence
      },
    })
    return { threadId, turnId: result.turnId, ...evidence }
  } finally { client.close() }
}

async function defaultCerebras({ workspacePath, requestText, model }) {
  return runCerebrasHelloTurn({
    workspacePath,
    requestText,
    model,
    allowedPaths: HELLO_APPLICATION_ALLOWED_PATHS,
  })
}

function validProviderExecution(value, model, executionNode) {
  const keys = ["route", "provider", "bridgeNode", "inferenceNode", "mode", "requestedModel", "actualModel",
    "externalEgress", "promptTokens", "completionTokens", "totalTokens", "calculatedCostUsd", "maxCostUsd",
    "contextDigest", "durationMs"]
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !equal(Object.keys(value).sort(), keys.sort()) || value.route !== "external" || value.provider !== "cerebras"
    || value.bridgeNode !== "hermes-node" || value.inferenceNode !== "cerebras-api"
    || value.mode !== "credential-bridge-one-shot" || value.requestedModel !== model || value.actualModel !== model
    || value.externalEgress !== true || executionNode !== value.inferenceNode
    || !Number.isSafeInteger(value.promptTokens) || value.promptTokens < 0
    || !Number.isSafeInteger(value.completionTokens) || value.completionTokens < 0
    || value.totalTokens !== value.promptTokens + value.completionTokens
    || typeof value.calculatedCostUsd !== "number" || !Number.isFinite(value.calculatedCostUsd) || value.calculatedCostUsd < 0
    || value.maxCostUsd !== 0.03 || value.calculatedCostUsd > value.maxCostUsd
    || typeof value.contextDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.contextDigest)
    || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw new Error()
  return value
}

function validReceipt(value, id) {
  if (!value || ![1, 2, 3].includes(value.schemaVersion) || value.proposalId !== id || !ID.test(id)
    || !["READY_FOR_REVIEW", "APPLY_IN_PROGRESS", "APPLIED", "REJECT_IN_PROGRESS", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(value.status)
    || !text(value.requestedBy) || !timestamp(value.createdAt) || !SHA.test(value.baseSha) || !SHA.test(value.proposalCommit)
    || !SHA256.test(value.patchSha256) || !safeId(value.threadId) || !safeId(value.turnId) || !text(value.model)
    || value.branch !== `codex/hermes-hello-${id}` || !Array.isArray(value.changedPaths) || !value.changedPaths.length
    || !equal(value.changedPaths, [...new Set(value.changedPaths)].sort())
    || value.changedPaths.some((item) => !HELLO_APPLICATION_ALLOWED_PATHS.includes(item))) throw new Error()
  validationResult(value.validation)
  const durable = value.schemaVersion >= 2
  if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || value.appliedAt < value.createdAt) throw new Error()
    if (durable ? !SHA.test(value.appliedCommit) : value.appliedCommit !== undefined && !SHA.test(value.appliedCommit)) throw new Error()
  } else if (value.appliedAt !== null || (durable && value.appliedCommit !== null)) throw new Error()
  if (value.status === "QUARANTINED_ROLLBACK_FAILED") {
    if (!timestamp(value.quarantinedAt) || value.quarantinedAt < value.createdAt) throw new Error()
  } else if (value.quarantinedAt !== undefined) throw new Error()
  if (value.status === "APPLY_IN_PROGRESS") {
    if (!durable || !timestamp(value.applyStartedAt) || value.applyStartedAt < value.createdAt) throw new Error()
  } else if (value.applyStartedAt !== undefined) throw new Error()
  if (value.status === "REJECT_IN_PROGRESS") {
    if (!timestamp(value.rejectStartedAt) || value.rejectStartedAt < value.createdAt
      || rejectionReason(value.rejectionReason) !== value.rejectionReason) throw new Error()
  } else if (value.rejectStartedAt !== undefined) throw new Error()
  if (value.status === "REJECTED") {
    if (!timestamp(value.rejectedAt) || value.rejectedAt < value.createdAt
      || rejectionReason(value.rejectionReason) !== value.rejectionReason) throw new Error()
  } else if (value.rejectedAt !== undefined || (value.status !== "REJECT_IN_PROGRESS" && value.rejectionReason !== undefined)) throw new Error()
  if (durable) {
    const keys = ["schemaVersion", "proposalId", "status", "requestedBy", "requestText", "requestSha256", "executionNode", "progress", "createdAt", "appliedAt", "appliedCommit", "baseSha", "proposalCommit", "branch", "changedPaths", "patchSha256", "threadId", "turnId", "model", "validation"]
    if (value.schemaVersion === 3) keys.push("providerExecution")
    if (value.status === "QUARANTINED_ROLLBACK_FAILED") keys.push("quarantinedAt")
    if (value.status === "APPLY_IN_PROGRESS") keys.push("applyStartedAt")
    if (value.status === "REJECT_IN_PROGRESS") keys.push("rejectStartedAt", "rejectionReason")
    if (value.status === "REJECTED") keys.push("rejectedAt", "rejectionReason")
    if (!equal(Object.keys(value).sort(), keys.sort())) throw new Error()
    const expectedProgress = value.schemaVersion === 3 ? EXTERNAL_PROGRESS : PROGRESS
    if (request(value.requestText) !== value.requestText || value.requestSha256 !== digest(value.requestText)
      || !text(value.executionNode) || !Array.isArray(value.progress) || value.progress.length !== expectedProgress.length) throw new Error()
    if (value.schemaVersion === 3) validProviderExecution(value.providerExecution, value.model, value.executionNode)
    let previous = value.createdAt
    for (const [index, entry] of value.progress.entries()) {
      if (!equal(Object.keys(entry).sort(), ["at", "detail", "stage"]) || entry.stage !== expectedProgress[index][0]
        || entry.detail !== expectedProgress[index][1] || !timestamp(entry.at) || entry.at < previous) throw new Error()
      previous = entry.at
    }
    if (value.appliedAt && value.appliedAt < previous) throw new Error()
    if (value.applyStartedAt && value.applyStartedAt < previous) throw new Error()
    if (value.rejectStartedAt && value.rejectStartedAt < previous) throw new Error()
    if (value.rejectedAt && value.rejectedAt < previous) throw new Error()
  }
  return value
}
function readyProjectionFromReject(marker) {
  const ready = { ...marker }
  delete ready.rejectStartedAt
  delete ready.rejectionReason
  ready.status = "READY_FOR_REVIEW"
  validReceipt(ready, marker.proposalId)
  return ready
}
function receipt(runtime, id) {
  const files = pathsFor(runtime, id)
  const read = (target) => {
    const bytes = readBoundedRegularFile(target, {
      maxBytes: MAX_RECEIPT_BYTES,
      errorCode: "HELLO_PROPOSAL_RECEIPT_INVALID",
      allowMissing: true,
    })
    if (bytes === null) return null
    try { return { value: validReceipt(JSON.parse(bytes), id), files, bytes } }
    catch { throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID") }
  }
  const quarantined = read(files.quarantine)
  if (quarantined) {
    if (quarantined.value.status !== "QUARANTINED_ROLLBACK_FAILED") throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    return quarantined
  }
  const stored = read(files.receipt)
  // APPLIED is published last. It is authoritative even if journal cleanup was interrupted.
  if (stored && stored.value.status !== "READY_FOR_REVIEW") return stored
  const inflight = read(files.inflight)
  if (inflight) {
    if (inflight.value.status === "QUARANTINED_ROLLBACK_FAILED") {
      const projection = { ...inflight.value }
      delete projection.quarantinedAt
      projection.status = "READY_FOR_REVIEW"
      if (stored && (Object.keys(projection).length !== Object.keys(stored.value).length
        || Object.keys(stored.value).some((key) => !equal(projection[key], stored.value[key])))) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
      return inflight
    }
    if (inflight.value.status === "REJECT_IN_PROGRESS") {
      const projection = readyProjectionFromReject(inflight.value)
      if (!stored || Object.keys(projection).length !== Object.keys(stored.value).length
        || Object.keys(stored.value).some((key) => !equal(projection[key], stored.value[key]))) {
        throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
      }
      return inflight
    }
    if (inflight.value.status !== "APPLY_IN_PROGRESS" || !stored || stored.value.schemaVersion < 2) {
      throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    }
    const projection = { ...inflight.value }
    delete projection.applyStartedAt
    projection.status = "READY_FOR_REVIEW"
    if (Object.keys(projection).length !== Object.keys(stored.value).length
      || Object.keys(stored.value).some((key) => !equal(projection[key], stored.value[key]))) {
      throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    }
    return inflight
  }
  if (!stored) throw new Error("HELLO_PROPOSAL_NOT_FOUND")
  return stored
}
function review(value, files) {
  const bytes = readBoundedRegularFile(files.patch, {
    maxBytes: MAX_PATCH_BYTES,
    errorCode: "HELLO_PROPOSAL_PATCH_MISMATCH",
  })
  if (digest(bytes) !== value.patchSha256 || !bytes.length || bytes.length > MAX_PATCH_BYTES || bytes.includes(0)) throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH")
  try { return { ...value, reviewPatch: new TextDecoder("utf-8", { fatal: true }).decode(bytes) } }
  catch { throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH") }
}
function eventTimestamp(value) {
  const observed = [value.createdAt, ...(Array.isArray(value.progress) ? value.progress.map((entry) => entry.at) : [])]
    .map((entry) => Date.parse(entry)).filter(Number.isFinite)
  return new Date(Math.max(Date.now(), ...observed)).toISOString()
}
function immutable(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) immutable(item)
    Object.freeze(value)
  }
  return value
}
function quarantinedReceipt(value) {
  const quarantined = { ...value, status: "QUARANTINED_ROLLBACK_FAILED", quarantinedAt: eventTimestamp(value) }
  validReceipt(quarantined, value.proposalId)
  return quarantined
}
function persistApplyQuarantine(value, files) {
  const quarantined = quarantinedReceipt(value)
  const encoded = encodedJson(quarantined)
  let durable = false
  try {
    fs.writeFileSync(files.quarantine, encoded, { flag: "wx" })
    syncFile(files.quarantine)
    durable = fs.readFileSync(files.quarantine, "utf8") === encoded
  } catch {
    try { durable = fs.readFileSync(files.quarantine, "utf8") === encoded } catch { /* Use the receipt path below. */ }
  }
  try { writeJson(files.receipt, quarantined) } catch { /* The independent marker remains authoritative. */ }
  if (!durable) {
    try { durable = fs.readFileSync(files.receipt, "utf8") === encoded } catch { /* Fail closed below. */ }
  }
  if (!durable) throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED")
  return quarantined
}
function assertClaimOwnership(claim, { allowLinkedInflight = false } = {}) {
  const expectedReceipt = Buffer.from(claim.originalReceiptBase64, "base64")
  let markerBytes
  let receiptBytes
  try {
    markerBytes = fs.readFileSync(claim.files.inflight)
    receiptBytes = fs.readFileSync(claim.files.receipt)
  } catch { throw new Error("claim ownership uncertain") }
  if (!markerBytes.equals(Buffer.from(claim.markerText)) || !receiptBytes.equals(expectedReceipt)) {
    throw new Error("claim ownership uncertain")
  }
  if (allowLinkedInflight) {
    try {
      if (fs.existsSync(claim.files.quarantine)
        || !equal(validReceipt(JSON.parse(markerBytes), claim.proposalId), claim.marker)) throw new Error()
    } catch { throw new Error("claim ownership uncertain") }
  } else {
    let current
    try { current = receipt(claim.runtime, claim.proposalId) }
    catch { throw new Error("claim ownership uncertain") }
    if (!current.bytes.equals(markerBytes) || !equal(current.value, claim.marker)) throw new Error("claim ownership uncertain")
  }
  if (claim.applyBindingText) {
    try {
      if (fs.readFileSync(claim.files.applyBinding, "utf8") !== claim.applyBindingText) throw new Error()
    } catch { throw new Error("claim ownership uncertain") }
  }
  try {
    if (review(claim.value, claim.files).reviewPatch !== claim.reviewPatch) throw new Error()
  } catch { throw new Error("claim ownership uncertain") }
}
function releaseClaim(claim) {
  assertClaimOwnership(claim)
  const tombstone = `${claim.files.inflight}.${crypto.randomUUID()}.release`
  let linked = false
  try {
    fs.linkSync(claim.files.inflight, tombstone)
    linked = true
    const markerStat = fs.statSync(claim.files.inflight, { bigint: true })
    const tombstoneStat = fs.statSync(tombstone, { bigint: true })
    if (!sameIdentity(markerStat, tombstoneStat)
      || fs.readFileSync(tombstone, "utf8") !== claim.markerText) throw new Error("claim cleanup uncertain")
    // This is the last ownership check while A still occupies the public claim path.
    assertClaimOwnership(claim, { allowLinkedInflight: true })
    const finalMarkerStat = fs.statSync(claim.files.inflight, { bigint: true })
    const finalTombstoneStat = fs.statSync(tombstone, { bigint: true })
    if (!sameIdentity(markerStat, finalMarkerStat) || !sameIdentity(finalMarkerStat, finalTombstoneStat)
      || fs.readFileSync(tombstone, "utf8") !== claim.markerText) throw new Error("claim cleanup uncertain")
    // Successful unlink releases A. A successor may claim immediately, so never inspect this path again.
    fs.unlinkSync(claim.files.inflight)
    if (claim.applyBindingText) {
      if (fs.readFileSync(claim.files.applyBinding, "utf8") !== claim.applyBindingText) throw new Error("claim cleanup uncertain")
      fs.unlinkSync(claim.files.applyBinding)
    }
  } finally {
    if (linked) {
      try { fs.unlinkSync(tombstone) } catch { /* Never touch a successor's public claim to clean a private tombstone. */ }
    }
  }
}
function bestEffortReleaseAppliedClaim(claim) {
  try {
    if (fs.readFileSync(claim.files.inflight, "utf8") === claim.markerText) fs.unlinkSync(claim.files.inflight)
  } catch { /* APPLIED is already authoritative; retain an uncertain marker. */ }
  if (claim.applyBindingText) {
    try {
      if (fs.readFileSync(claim.files.applyBinding, "utf8") === claim.applyBindingText) fs.unlinkSync(claim.files.applyBinding)
    } catch { /* APPLIED is already authoritative; retain an uncertain binding. */ }
  }
}
function matchingRejectedTerminal(runtime, proposalId, encoded, reviewPatch, claim) {
  try {
    const current = receipt(runtime, proposalId)
    if (current.value.status !== "REJECTED" || !current.bytes.equals(Buffer.from(encoded))) return null
    const reviewed = review(current.value, current.files)
    if (reviewed.reviewPatch !== reviewPatch) return null
    if (claim) bestEffortReleaseAppliedClaim(claim)
    return reviewed
  } catch { return null }
}
function helloApplyBindingText({ proposalId, repositoryClaim, originalReceipt, markerText }) {
  return encodedJson({
    schemaVersion: 1,
    proposalId,
    repositoryToken: repositoryClaim.value.token,
    repositoryProcessId: repositoryClaim.value.processId,
    repositoryDigest: repositoryClaim.value.repositoryDigest,
    originalReceiptSha256: digest(originalReceipt),
    markerSha256: digest(markerText),
    workspaceName: `apply-${proposalId}`,
  })
}
export function claimHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy, repositoryClaim }) {
  const runtime = path.resolve(runtimeRoot)
  const id = required(proposalId, "proposalId")
  const owner = required(requestedBy, "requestedBy")
  const { value, files, bytes } = receipt(runtime, id)
  if (value.requestedBy !== owner) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  if (value.status !== "READY_FOR_REVIEW") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
  const reviewed = review(value, files)
  const marker = value.schemaVersion >= 2
    ? { ...value, status: "APPLY_IN_PROGRESS", applyStartedAt: eventTimestamp(value) }
    : quarantinedReceipt(value)
  validReceipt(marker, id)
  const markerText = encodedJson(marker)
  let created = false
  let applyBindingText = null
  let bindingCreated = false
  try {
    writeExclusiveSynced(files.inflight, markerText, () => { created = true })
    if (repositoryClaim) {
      applyBindingText = helloApplyBindingText({ proposalId: id, repositoryClaim, originalReceipt: bytes, markerText })
      writeExclusiveSynced(files.applyBinding, applyBindingText, () => { bindingCreated = true })
    }
    const claim = immutable({
      runtime, proposalId: id, requestedBy: owner, value: structuredClone(value), files: { ...files },
      originalReceiptBase64: bytes.toString("base64"), reviewPatch: reviewed.reviewPatch,
      marker: structuredClone(marker), markerText, applyBindingText,
    })
    assertClaimOwnership(claim)
    return claim
  } catch (error) {
    if (!created) throw error
    if (bindingCreated) {
      try {
        if (fs.readFileSync(files.applyBinding, "utf8") === applyBindingText) fs.unlinkSync(files.applyBinding)
      } catch { /* quarantine below is authoritative */ }
    }
    try { persistApplyQuarantine(value, files) }
    catch { throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED") }
    throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
  }
}

function rollbackHelloUnappliedClaim(claim) {
  try { releaseClaim(claim) }
  catch {
    try { persistApplyQuarantine(claim.value, claim.files) }
    catch { throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED") }
    throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
  }
}

function bindHelloClaimToRepository(claim, repositoryClaim) {
  const applyBindingText = helloApplyBindingText({
    proposalId: claim.proposalId,
    repositoryClaim,
    originalReceipt: Buffer.from(claim.originalReceiptBase64, "base64"),
    markerText: claim.markerText,
  })
  try {
    writeExclusiveSynced(claim.files.applyBinding, applyBindingText)
    const bound = immutable({ ...claim, applyBindingText })
    assertClaimOwnership(bound)
    return bound
  } catch (error) {
    try {
      if (fs.readFileSync(claim.files.applyBinding, "utf8") === applyBindingText) fs.unlinkSync(claim.files.applyBinding)
    } catch { /* rollback/quarantine below remains authoritative */ }
    try { rollbackHelloUnappliedClaim(claim) } catch (rollbackError) { throw rollbackError }
    throw error
  }
}

function claimHelloApplicationProposalRejection({ runtimeRoot, proposalId, requestedBy, reason }) {
  const runtime = path.resolve(runtimeRoot)
  const id = required(proposalId, "proposalId")
  const owner = required(requestedBy, "requestedBy")
  const rejectedBecause = rejectionReason(reason)
  const { value, files, bytes } = receipt(runtime, id)
  if (value.requestedBy !== owner) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  if (value.status === "REJECTED") {
    if (value.rejectionReason !== rejectedBecause) throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
    return immutable({ terminal: review(value, files) })
  }
  if (value.status === "REJECT_IN_PROGRESS") {
    if (value.rejectionReason !== rejectedBecause) throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
    const original = readyProjectionFromReject(value)
    const reviewed = review(original, files)
    const terminal = {
      ...original,
      status: "REJECTED",
      rejectedAt: value.rejectStartedAt,
      rejectionReason: rejectedBecause,
    }
    validReceipt(terminal, id)
    const terminalEncoded = encodedJson(terminal)
    const markerText = bytes.toString("utf8")
    try {
      const originalReceipt = fs.readFileSync(files.receipt)
      const claim = immutable({
        runtime,
        proposalId: id,
        requestedBy: owner,
        rejectionReason: rejectedBecause,
        value: structuredClone(original),
        files: { ...files },
        originalReceiptBase64: originalReceipt.toString("base64"),
        reviewPatch: reviewed.reviewPatch,
        marker: structuredClone(value),
        markerText,
      })
      assertClaimOwnership(claim)
      return claim
    } catch (error) {
      const completed = matchingRejectedTerminal(
        runtime,
        id,
        terminalEncoded,
        reviewed.reviewPatch,
        { files, markerText },
      )
      if (completed) return immutable({ terminal: completed })
      throw error
    }
  }
  if (value.status !== "READY_FOR_REVIEW") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
  const reviewed = review(value, files)
  const marker = {
    ...value,
    status: "REJECT_IN_PROGRESS",
    rejectStartedAt: eventTimestamp(value),
    rejectionReason: rejectedBecause,
  }
  validReceipt(marker, id)
  const markerText = encodedJson(marker)
  const terminal = {
    ...value,
    status: "REJECTED",
    rejectedAt: marker.rejectStartedAt,
    rejectionReason: rejectedBecause,
  }
  validReceipt(terminal, id)
  const terminalEncoded = encodedJson(terminal)
  let created = false
  try {
    writeExclusiveSynced(files.inflight, markerText, () => { created = true })
    const claim = immutable({
      runtime,
      proposalId: id,
      requestedBy: owner,
      rejectionReason: rejectedBecause,
      value: structuredClone(value),
      files: { ...files },
      originalReceiptBase64: bytes.toString("base64"),
      reviewPatch: reviewed.reviewPatch,
      marker: structuredClone(marker),
      markerText,
    })
    assertClaimOwnership(claim)
    return claim
  } catch (error) {
    if (!created) throw error
    const completed = matchingRejectedTerminal(
      runtime,
      id,
      terminalEncoded,
      reviewed.reviewPatch,
      { files, markerText },
    )
    if (completed) return immutable({ terminal: completed })
    throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
  }
}
async function patchPaths(repository, patch) {
  const bytes = Buffer.isBuffer(patch) ? patch : fs.readFileSync(patch)
  const raw = await git(repository, ["apply", "--numstat", "-z", "-"], {
    encoding: "buffer", errorCode: "HELLO_PROPOSAL_PATCH_INVALID", input: bytes,
  })
  // Hunk content always has a prefix. Only metadata before the first hunk is authoritative.
  let header = false
  let patchText
  try { patchText = new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { throw new Error("HELLO_PROPOSAL_PATCH_INVALID") }
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) header = true
    else if (line.startsWith("@@ ")) header = false
    else if (header && /^(?:GIT binary patch$|Binary files |new file mode |deleted file mode |old mode |new mode |rename (?:from|to) |copy (?:from|to) )/.test(line)) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  }
  const result = Buffer.from(raw.stdout).toString("utf8").split("\0").filter(Boolean).map((line) => {
    const pieces = line.split("\t")
    if (pieces.length !== 3 || !/^\d+$/.test(pieces[0]) || !/^\d+$/.test(pieces[1])) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
    return pieces[2]
  })
  try { assertHelloApplicationChangedPaths(result, []) } catch { throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH") }
  if (new Set(result).size !== result.length) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  return result.sort()
}
function notifyProgress(onProgress, entry) {
  try { Promise.resolve(onProgress?.({ ...entry })).catch(() => {}) } catch { /* Observers have no execution authority. */ }
}
async function removeWorktree(repository, runtime, workspace) {
  if (path.dirname(path.resolve(workspace)) !== path.resolve(runtime, "worktrees")) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  const removed = await git(repository, ["worktree", "remove", "--force", workspace], { allowFailure: true })
  const pruned = await git(repository, ["worktree", "prune"], { allowFailure: true })
  const listed = await git(repository, ["worktree", "list", "--porcelain", "-z"], { allowFailure: true })
  const normalized = (item) => process.platform === "win32" ? path.resolve(item).toLowerCase() : path.resolve(item)
  const registered = listed.stdout.split("\0").some((entry) => entry.startsWith("worktree ") && normalized(entry.slice(9)) === normalized(workspace))
  if (pruned.code || listed.code || fs.existsSync(workspace) || registered) throw new Error("HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED")
}
async function bestEffortRemoveWorktree(repository, runtime, workspace) {
  try { await removeWorktree(repository, runtime, workspace) } catch { /* Never mask the already-decided transaction outcome. */ }
}

function exactStoredPatch(target, bytes) {
  try {
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length || stat.size > MAX_PATCH_BYTES) return false
    return fs.realpathSync(target) === target && fs.readFileSync(target).equals(bytes)
  } catch { return false }
}
function ensureStoredPatch(target, bytes) {
  if (exactStoredPatch(target, bytes)) return true
  try {
    if (fs.existsSync(target)) return false
    fs.writeFileSync(target, bytes, { flag: "wx" })
    syncFile(target)
  } catch { /* Exact verification below handles a write that completed before throwing. */ }
  return exactStoredPatch(target, bytes)
}
function persistCreationQuarantine(runtime, id, files, value, bytes) {
  const quarantined = { ...value, status: "QUARANTINED_ROLLBACK_FAILED", quarantinedAt: new Date().toISOString() }
  try { validReceipt(quarantined, id) } catch { return false }
  if (!ensureStoredPatch(files.patch, bytes)) return false
  for (const target of [files.quarantine, files.inflight, files.receipt]) {
    try { writeJson(target, quarantined) } catch { /* A rename may have completed before the injected failure. */ }
    try {
      const stored = receipt(runtime, id)
      if (stored.value.status === "QUARANTINED_ROLLBACK_FAILED") {
        review(stored.value, stored.files)
        return true
      }
    } catch { /* Try the next independent marker path. */ }
  }
  return false
}

/**
 * @param {{ repositoryRoot: string, runtimeRoot: string, requestedBy: string, requestText: string, executionRoute?: string, externalEgressApproved?: boolean, externalRoutingEnabled?: boolean | string, onProgress?: (event: { stage: string, detail: string, at: string }) => unknown, residentTurn?: (input: { repositoryRoot: string, runtimeRoot: string, workspacePath: string, requestText: string, prompt: string }) => Promise<any>, cerebrasTurn?: (input: { repositoryRoot: string, runtimeRoot: string, workspacePath: string, requestText: string, model: string }) => Promise<any>, validateWorkspace?: (input: { repositoryRoot: string, runtimeRoot: string, workspacePath: string }) => Promise<any> }} options
 */
export async function createHelloApplicationProposal({ repositoryRoot: configured, runtimeRoot, requestedBy, requestText,
  executionRoute, externalEgressApproved = false,
  externalRoutingEnabled = process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
  onProgress, residentTurn = defaultResident, cerebrasTurn = defaultCerebras,
  validateWorkspace = validateHelloApplicationInContainer }) {
  const owner = required(requestedBy, "requestedBy")
  const requested = request(requestText)
  const execution = resolveHelloExecutionRoute(executionRoute, {
    externalEnabled: externalRoutingEnabled,
    externalEgressApproved,
  })
  const repository = await repositoryRoot(configured)
  const runtime = path.resolve(required(runtimeRoot, "runtimeRoot"))
  const id = crypto.randomUUID()
  const workspace = path.join(runtime, "worktrees", `hello-${id}`)
  const branch = `codex/hermes-hello-${id}`
  const progressContract = execution.external ? EXTERNAL_PROGRESS : PROGRESS
  const files = pathsFor(runtime, id)
  let stagedPatch = `${files.patch}.${crypto.randomUUID()}.tmp`
  return runGovernedCreateTransaction({
    errorPrefix: "HELLO_PROPOSAL",
    repository,
    runtime,
    proposalId: id,
    branch,
    workspace,
    files,
    engine: HELLO_PROPOSAL_ENGINE,
    boundPaths: VALIDATION_PATHS,
    progressContract,
    onProgress,
    git,
    gitIndexEnvironment: (index) => ({ ...process.env, GIT_INDEX_FILE: index }),
    ensureWorkspaceParent: async () => {
      fs.mkdirSync(path.dirname(workspace), { recursive: true })
      if (fs.lstatSync(path.dirname(workspace)).isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
    },
    assertWorkspace: (target) => assertHelloValidationWorkspace(runtime, target),
    executeTurn: () => execution.external
      ? cerebrasTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, model: execution.model })
      : residentTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, prompt: governedPrompt(requested) }),
    validateWorkspace: (target) => validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: target }),
    validationResult,
    snapshot,
    assertSnapshot,
    changedPaths: changed,
    verifyCandidate,
    patchPaths: async (_repository, _bytes, _allowed, target) => patchPaths(repository, target),
    removeWorktree,
    bestEffortRemoveWorktree,
    createReceipt: ({ progress, createdAt, baseSha, candidateSha, branch: receiptBranch, changedPaths: paths, patchBytes, validation, turn }) => {
      const value = { schemaVersion: execution.external ? 3 : 2, proposalId: id, status: "READY_FOR_REVIEW", requestedBy: owner, requestText: requested,
        requestSha256: digest(requested), executionNode: turn.executionNode ?? policy(repository).placement.executionNode,
        progress, createdAt, appliedAt: null, appliedCommit: null, baseSha, proposalCommit: candidateSha, branch: receiptBranch, changedPaths: paths,
        patchSha256: digest(patchBytes), threadId: turn.threadId, turnId: turn.turnId, model: turn.model, validation }
      if (execution.external) value.providerExecution = turn.providerExecution
      return value
    },
    validateReceipt: (value, proposalId) => {
      try { return validReceipt(value, proposalId) } catch { throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID") }
    },
    review,
    prepareStorage: async () => {
      fs.mkdirSync(files.root, { recursive: true })
      if ([files.receipt, files.patch, files.quarantine, files.inflight].some((target) => fs.existsSync(target))) {
        throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
      }
    },
    writePatch: async (_files, bytes) => {
      fs.writeFileSync(stagedPatch, bytes, { flag: "wx" })
      syncFile(stagedPatch)
      return stagedPatch
    },
    publishPatch: async () => { fs.renameSync(stagedPatch, files.patch) },
    writeReceipt: async (_files, value) => { writeJson(files.receipt, value) },
    cleanupCreationArtifacts: async () => [files.receipt, files.patch, stagedPatch].map(removeCreationArtifactVerified).every(Boolean),
    persistCreationQuarantine: async ({ value, bytes }) => persistCreationQuarantine(runtime, id, files, value, bytes),
    deleteBranch: async (_repository, receiptBranch, ownedTargets) => deleteOwnedProposalBranch({
      git, repository, branch: receiptBranch, ownedTargets, errorCode: "HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    }),
    commitMessage: `proposal(hello): resident change ${id}`,
    maxPatchBytes: MAX_PATCH_BYTES,
    worktreeCleanupErrorCode: "HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED",
  })
}

async function treeEntries(repository, commit, paths) {
  const raw = (await git(repository, ["ls-tree", "-z", commit, "--", ...paths])).stdout
  const entries = new Map()
  for (const record of raw.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(record)
    if (!match || !SHA.test(match[2]) || !paths.includes(match[3])) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
    entries.set(match[3], { mode: match[1], blob: match[2] })
  }
  if (entries.size !== paths.length) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
  return entries
}
async function verifyCandidate(repository, base, candidate, paths) {
  if (!SHA.test(candidate) || (await git(repository, ["show", "-s", "--format=%P", candidate])).stdout.trim() !== base) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
  const actual = (await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", base, candidate])).stdout.split("\0").filter(Boolean).sort()
  if (!equal(paths, actual)) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
  const before = await treeEntries(repository, base, paths)
  const after = await treeEntries(repository, candidate, paths)
  for (const item of paths) if (before.get(item).mode !== after.get(item).mode) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
  return after
}
async function indexEntries(repository) {
  return (await git(repository, ["ls-files", "--stage", "-z"])).stdout.split("\0").filter(Boolean)
}
const entryPath = (entry) => entry.slice(entry.indexOf("\t") + 1)
function replaceIndexEntries(original, replacements) {
  return original.map((entry) => {
    const item = entryPath(entry)
    const replacement = replacements.get(item)
    return replacement ? `${replacement.mode} ${replacement.blob} 0\t${item}` : entry
  })
}
async function setIndexEntry(repository, item, entry) {
  await git(repository, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.blob},${item}`])
}

function parseHelloApplyBinding(files, stale, originalBytes, markerBytes) {
  let bindingBytes
  let binding
  try {
    bindingBytes = fs.readFileSync(files.applyBinding)
    binding = JSON.parse(bindingBytes)
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const keys = ["schemaVersion", "proposalId", "repositoryToken", "repositoryProcessId", "repositoryDigest",
    "originalReceiptSha256", "markerSha256", "workspaceName"]
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
    || !equal(Object.keys(binding).sort(), keys.sort()) || binding.schemaVersion !== 1
    || binding.proposalId !== stale.proposalId || binding.repositoryToken !== stale.token
    || binding.repositoryProcessId !== stale.processId || binding.repositoryDigest !== stale.repositoryDigest
    || binding.originalReceiptSha256 !== digest(originalBytes) || binding.markerSha256 !== digest(markerBytes)
    || binding.workspaceName !== `apply-${stale.proposalId}`) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  return { bindingBytes, binding }
}

function unlinkHelloApplyJournal(files, markerBytes, bindingBytes) {
  try {
    if (!fs.readFileSync(files.inflight).equals(markerBytes)
      || !fs.readFileSync(files.applyBinding).equals(bindingBytes)) throw new Error()
    fs.unlinkSync(files.inflight)
    if (!fs.readFileSync(files.applyBinding).equals(bindingBytes)) throw new Error()
    fs.unlinkSync(files.applyBinding)
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
}

async function recoverStaleHelloApply(repository, runtime, stale) {
  const files = pathsFor(runtime, stale.proposalId)
  let stored
  try { stored = receipt(runtime, stale.proposalId) }
  catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const workspace = path.join(runtime, "worktrees", `apply-${stale.proposalId}`)
  const exactHead = async (commit) => (await git(repository, ["rev-parse", "HEAD"])).stdout.trim() === commit
    && await exactRepositoryState(repository, commit, VALIDATION_PATHS)

  if (stored.value.status === "READY_FOR_REVIEW") {
    if (!await exactHead(stored.value.baseSha)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    if (fs.existsSync(workspace) || fs.existsSync(files.applyBinding) || fs.existsSync(files.inflight)) {
      throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    }
    return
  }
  if (["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(stored.value.status)) {
    await bestEffortRemoveWorktree(repository, runtime, workspace)
    try {
      await deleteOwnedProposalBranch({
        git, repository, branch: stored.value.branch, ownedTargets: new Set([stored.value.proposalCommit]),
        errorCode: "APPLICATION_PROPOSAL_LOCK_UNCERTAIN",
      })
    } catch { /* terminal receipt is authoritative; retain an ambiguously changed branch */ }
    return
  }
  if (stored.value.status !== "APPLY_IN_PROGRESS") throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")

  let originalBytes
  let original
  try {
    originalBytes = fs.readFileSync(files.receipt)
    original = validReceipt(JSON.parse(originalBytes), stale.proposalId)
  } catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  if (original.status !== "READY_FOR_REVIEW") throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  const markerBytes = stored.bytes
  const projection = { ...stored.value, status: "READY_FOR_REVIEW" }
  delete projection.applyStartedAt
  if (!equal(projection, original)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  const { bindingBytes } = parseHelloApplyBinding(files, stale, originalBytes, markerBytes)
  review(original, files)
  await removeWorktree(repository, runtime, workspace)
  if (await exactHead(original.baseSha)) {
    unlinkHelloApplyJournal(files, markerBytes, bindingBytes)
    return
  }
  if (!await exactHead(original.proposalCommit)) {
    persistApplyQuarantine(original, files)
    throw new Error("APPLICATION_PROPOSAL_QUARANTINED")
  }
  await deleteOwnedProposalBranch({
    git, repository, branch: original.branch, ownedTargets: new Set([original.proposalCommit]),
    errorCode: "APPLICATION_PROPOSAL_LOCK_UNCERTAIN",
  })
  const applied = validReceipt({
    ...original,
    status: "APPLIED",
    appliedAt: eventTimestamp(stored.value),
    appliedCommit: original.proposalCommit,
  }, stale.proposalId)
  const temporary = `${files.receipt}.${crypto.randomUUID()}.recover`
  try {
    fs.writeFileSync(temporary, encodedJson(applied), { flag: "wx" })
    syncFile(temporary)
    if (!fs.readFileSync(files.receipt).equals(originalBytes)) throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    fs.renameSync(temporary, files.receipt)
  } finally { try { fs.rmSync(temporary, { force: true }) } catch { /* rename may have completed */ } }
  unlinkHelloApplyJournal(files, markerBytes, bindingBytes)
}

async function applyInner({ repositoryRoot: configured, proposalId, validateWorkspace, transactionOperations = {}, claim }) {
  assertClaimOwnership(claim)
  const repository = await repositoryRoot(configured)
  const runtime = claim.runtime
  const { value, files } = claim
  const originalReceipt = Buffer.from(claim.originalReceiptBase64, "base64")
  const patchBytes = Buffer.from(claim.reviewPatch)
  const workspace = path.join(runtime, "worktrees", `apply-${proposalId}`)
  const readBaseRef = async () => {
    const ref = (await git(repository, ["symbolic-ref", "HEAD"])).stdout.trim()
    if (!ref.startsWith("refs/heads/")) throw new Error("HELLO_PROPOSAL_BASE_INVALID")
    return ref
  }
  return runGovernedApplyTransaction({
    errorPrefix: "HELLO_PROPOSAL",
    repository,
    runtime,
    proposalId,
    value,
    patchBytes,
    changedPaths: value.changedPaths,
    allowedPaths: HELLO_APPLICATION_ALLOWED_PATHS,
    boundPaths: VALIDATION_PATHS,
    baseSha: value.baseSha,
    candidateSha: value.proposalCommit,
    workspace,
    git,
    readBaseRef,
    patchPaths,
    snapshot,
    assertSnapshot,
    regularFile,
    indexEntries,
    setIndexEntry,
    treeEntries,
    verifyCandidate,
    assertWorkspace: (target) => assertHelloValidationWorkspace(runtime, target),
    validateWorkspace: (target) => validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: target }),
    validationResult,
    removeWorktree,
    createAppliedReceipt: ({ candidateSha, validation }) => ({
      ...value,
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
      appliedCommit: candidateSha,
      validation,
    }),
    validateReceipt: validReceipt,
    publishAppliedReceipt: async (updated) => {
      const temporary = `${files.receipt}.${crypto.randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, encodedJson(updated), { flag: "wx" })
        syncFile(temporary)
        if (!fs.readFileSync(files.receipt).equals(originalReceipt)) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
        fs.renameSync(temporary, files.receipt)
      } finally { try { fs.rmSync(temporary, { force: true }) } catch { /* receipt rename may have completed */ } }
    },
    restoreReadyReceipt: async () => {
      if (!fs.readFileSync(files.receipt).equals(originalReceipt)) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    },
    quarantine: async () => { persistApplyQuarantine(value, files) },
    assertClaimOwnership: () => assertClaimOwnership(claim),
    releaseClaim: async ({ terminal }) => { if (terminal) bestEffortReleaseAppliedClaim(claim); else releaseClaim(claim) },
    deleteBranch: async () => deleteOwnedProposalBranch({
      git,
      repository,
      branch: value.branch,
      ownedTargets: new Set([value.proposalCommit]),
      errorCode: "HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    }),
    review: (updated) => ({ ...updated, reviewPatch: claim.reviewPatch }),
    transactionOperations,
    digest,
    patchDigest: value.patchSha256,
    maxPatchBytes: MAX_PATCH_BYTES,
    worktreeCleanupFailureCode: "HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED",
    canonicalValidationDriftCode: "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH",
  })
}
async function applyClaimed(options, claim) {
  try {
    return await applyInner({ ...options, claim })
  } catch (error) {
    if (!fs.existsSync(claim.files.inflight) || fs.existsSync(claim.files.quarantine)) throw error
    try { releaseClaim(claim) }
    catch {
      try { persistApplyQuarantine(claim.value, claim.files) }
      catch { throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED") }
      throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
    }
    throw error
  }
}
async function acquireHelloRepositoryLock(options) {
  const deadline = Date.now() + 60_000
  while (true) {
    try { return await acquireApplicationRepositoryLock(options) }
    catch (error) {
      if (error?.message !== "APPLICATION_PROPOSAL_REPOSITORY_BUSY" || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}
export async function applyHelloApplicationProposal(options) {
  const runtime = path.resolve(required(options.runtimeRoot, "runtimeRoot"))
  const proposalId = required(options.proposalId, "proposalId")
  const requestedBy = required(options.requestedBy, "requestedBy")
  let repository
  const claimedOptions = {
    ...options,
    runtimeRoot: runtime,
    proposalId,
    requestedBy,
    validateWorkspace: options.validateWorkspace ?? validateHelloApplicationInContainer,
  }
  return runGovernedApplyLifecycle({
    errorPrefix: "HELLO_PROPOSAL",
    load: () => receipt(runtime, proposalId),
    assertOwner: (stored) => {
      if (stored.value.requestedBy !== requestedBy) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
    },
    assertBinding: () => {},
    status: (stored) => stored.value.status,
    inspect: (stored) => { if (stored.value.status === "READY_FOR_REVIEW") review(stored.value, stored.files) },
    onTerminal: async (stored) => {
      repository ??= await repositoryRoot(options.repositoryRoot)
      await reconcileTerminalApplicationRepositoryLock({ runtimeRoot: runtime, repositoryRoot: repository, proposalId })
      await deleteOwnedProposalBranch({
        git,
        repository,
        branch: stored.value.branch,
        ownedTargets: new Set([stored.value.proposalCommit]),
        errorCode: "HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
      })
      throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
    },
    canClaim: (status) => ["READY_FOR_REVIEW", "APPLY_IN_PROGRESS"].includes(status),
    claimBeforeRepositoryLock: true,
    acquireRepositoryLock: async (recoverStale) => {
      repository = await repositoryRoot(options.repositoryRoot)
      return acquireHelloRepositoryLock({ runtimeRoot: runtime, repositoryRoot: repository, proposalId, recoverStale })
    },
    releaseRepositoryLock: (claim) => releaseApplicationRepositoryLock(claim),
    recoverStale: (stale) => recoverStaleHelloApply(repository, runtime, stale),
    reconcileLocked: async () => { throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE") },
    claimApply: (_stored, repositoryClaim) => claimHelloApplicationProposal({
      runtimeRoot: runtime,
      proposalId,
      requestedBy,
      repositoryClaim,
    }),
    bindClaimToRepository: (claim, repositoryClaim) => bindHelloClaimToRepository(claim, repositoryClaim),
    rollbackUnappliedClaim: (claim) => rollbackHelloUnappliedClaim(claim),
    applyClaimed: (_stored, claim) => applyClaimed({ ...claimedOptions, repositoryRoot: repository }, claim),
  })
}
export function rejectHelloApplicationProposal(options) {
  let temporary
  return runGovernedRejectLifecycleSync({
    errorPrefix: "HELLO_PROPOSAL",
    proposalId: options.proposalId,
    claimReject: () => claimHelloApplicationProposalRejection(options),
    createRejectedReceipt: (claim) => ({
      ...claim.value,
      status: "REJECTED",
      rejectedAt: claim.marker.rejectStartedAt,
      rejectionReason: claim.rejectionReason,
    }),
    validateReceipt: validReceipt,
    publishRejected: (claim, updated) => {
      const encoded = encodedJson(updated)
      temporary = `${claim.files.receipt}.${crypto.randomUUID()}.reject`
      fs.writeFileSync(temporary, encoded, { flag: "wx" })
      syncFile(temporary)
      if (fs.readFileSync(temporary, "utf8") !== encoded) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
      assertClaimOwnership(claim)
      fs.renameSync(temporary, claim.files.receipt)
      return { ...updated, reviewPatch: claim.reviewPatch }
    },
    matchingTerminal: (claim, updated) => matchingRejectedTerminal(
      claim.runtime,
      claim.proposalId,
      encodedJson(updated),
      claim.reviewPatch,
      claim,
    ),
    releaseClaim: (claim, { terminal }) => { if (terminal) bestEffortReleaseAppliedClaim(claim); else releaseClaim(claim) },
    cleanupTemporary: () => { if (temporary) try { fs.rmSync(temporary, { force: true }) } catch { /* terminal receipt is authoritative */ } },
  })
}
export function getHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy }) {
  const { value, files } = receipt(runtimeRoot, proposalId)
  if (value.requestedBy !== required(requestedBy, "requestedBy")) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  return review(value, files)
}
export function listHelloApplicationProposals({ runtimeRoot, requestedBy }) {
  const root = path.join(path.resolve(runtimeRoot), "hello-application-proposals")
  if (!fs.existsSync(root)) return []
  const ids = [...new Set(fs.readdirSync(root).filter((name) => /\.(?:json|quarantine|inflight)$/.test(name)).map((name) => name.replace(/\.(?:json|quarantine|inflight)$/, "")))]
  return ids.map((proposalId) => getHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
