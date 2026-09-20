import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
import { runCerebrasHelloTurn } from "./cerebras-turn.mjs"
import { resolveHelloExecutionRoute } from "./execution-routing.mjs"
import { assertHelloValidationWorkspace, validateHelloApplicationInContainer } from "./proposal-validation.mjs"

export const HELLO_APPLICATION_ALLOWED_PATHS = Object.freeze([
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
])
const VALIDATION_PATHS = [...HELLO_APPLICATION_ALLOWED_PATHS, "examples/hello-application/package.json", "examples/hello-application/server.mjs", "examples/hello-application/test/hello.test.mjs"]
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256 = /^[0-9a-f]{64}$/
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_PATCH_BYTES = 256 * 1024
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
let applyQueue = Promise.resolve()
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const filePath = (root, item) => path.join(root, ...item.split("/"))
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && !/[\0\r\n]/.test(value)
const safeId = (value) => typeof value === "string" && SAFE_ID.test(value)
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => execFile(command, args, {
    cwd: options.cwd, env: options.env, encoding: options.encoding ?? "utf8", windowsHide: true,
    timeout: 60_000, maxBuffer: options.maxBuffer ?? 2_000_000,
  }, (error, stdout, stderr) => {
    if (error && !options.allowFailure) reject(new Error(options.errorCode ?? "HELLO_PROPOSAL_COMMAND_FAILED"))
    else resolve({ code: error ? 1 : 0, stdout, stderr })
  }))
}
const git = (root, args, options = {}) => run("git", ["-C", root, ...args], options)
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
  try {
    const value = JSON.parse(fs.readFileSync(path.join(repository, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), "utf8"))
    if (value.schemaVersion !== 2 || value.packetSchemaVersion !== 3 || value.placement?.workspaceMode !== "OWNED_WORKTREE"
      || !text(value.placement.executionNode) || !text(value.model?.id)) throw new Error()
    return value
  } catch { throw new Error("HELLO_PROPOSAL_POLICY_INVALID") }
}
function pathsFor(runtime, id) {
  if (!ID.test(id)) throw new Error("HELLO_PROPOSAL_ID_INVALID")
  const root = path.join(path.resolve(runtime), "hello-application-proposals")
  return { root, receipt: path.join(root, `${id}.json`), patch: path.join(root, `${id}.patch`),
    quarantine: path.join(root, `${id}.quarantine`), inflight: path.join(root, `${id}.inflight`) }
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
  if (!Array.isArray(ignored) || ignored.length) throw new Error("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
  if (!Array.isArray(paths) || !paths.length) throw new Error("HELLO_PROPOSAL_NO_CHANGE")
  for (const item of paths) if (!HELLO_APPLICATION_ALLOWED_PATHS.includes(item)) throw new Error(`HELLO_PROPOSAL_PATH_REFUSED:${item}`)
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
      return [item, { bytes: readBoundedFile(root, item, file), mode: file.mode }]
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
  return [
    "Implement the owner request below in the isolated Hello Application workspace.", `Owner request: ${requestText}`,
    `You may modify a nonempty subset of only: ${HELLO_APPLICATION_ALLOWED_PATHS.join(", ")}.`,
    "Preserve existing behavior outside the request. Do not create, delete, rename, or change modes of files.",
    "Do not run Git. Do not use network access. Do not install dependencies. Do not commit or push.",
    `The trusted host will run exactly: ${COMMAND} in a contained validator.`,
  ].join("\n")
}
function recoverable(error) {
  return error?.name === "AppServerTurnEndedError" && error.status === "failed"
    && typeof error.detail === "string" && error.detail.startsWith("RESIDENT_MODEL_TURN_OUTPUT_INVALID:")
}
/**
 * @param {{ client: { runTurn: (input: { threadId: string, prompt: string, timeoutMs: number }) => Promise<any> }, threadId: string, requestText: string, readChangedPaths: () => Promise<string[]>, timeoutMs?: number, maximumAttempts?: number, verifyAttempt?: (outcome: any) => any, now?: () => number }} options
 * @returns {Promise<{ turn: any, turnId: string, completionMode: "MODEL_OUTPUT_VALID" | "HOST_OBSERVED_OUTPUT_INVALID", changedPaths: string[], attempts: number }>}
 */
export async function runGovernedResidentChange({ client, threadId, requestText, readChangedPaths, timeoutMs = RESIDENT_TRANSACTION_TIMEOUT_MS, maximumAttempts = 3, verifyAttempt, now = Date.now }) {
  const requested = request(requestText)
  const limit = Math.min(3, Math.max(1, Number.isInteger(maximumAttempts) ? maximumAttempts : 3))
  const budget = Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 0
  if (budget <= 0 || typeof now !== "function") throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
  const started = now()
  if (!Number.isFinite(started)) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
  const remainingBudget = () => {
    const current = now()
    if (!Number.isFinite(current)) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    return Math.min(budget, Math.floor(budget - Math.max(0, current - started)))
  }
  let paths = []
  for (let attempt = 1; attempt <= limit; attempt++) {
    const remaining = remainingBudget()
    if (remaining < RESIDENT_TURN_TIMEOUT_MS) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    const correction = attempt === 1 ? "" : `Correction attempt ${attempt}: emit the required completion object. Preserve the existing edits. Actual changed paths: ${paths.join(", ") || "none"}.\n`
    let turn
    let failure
    try { turn = await client.runTurn({ threadId, prompt: correction + governedPrompt(requested), timeoutMs: RESIDENT_TURN_TIMEOUT_MS }) }
    catch (error) {
      if (error?.name === "AppServerTimeoutError" || error?.code === "APP_SERVER_TIMEOUT") throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
      if (!recoverable(error)) throw error
      failure = error
    }
    if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    // Security and transport errors never reach the retry boundary.
    const verified = verifyAttempt ? await verifyAttempt({ attempt, turn, failure }) : null
    if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    paths = await readChangedPaths()
    if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    if (paths.length) assertHelloApplicationChangedPaths(paths, [])
    if (!failure) {
      if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
      return { turn, turnId: turn.turnId, completionMode: "MODEL_OUTPUT_VALID", changedPaths: paths, attempts: attempt }
    }
    // The Hello lane consumes the model-authored workspace, not the model's generic governance
    // self-report. When the kernel completed cleanly but that report was malformed, a trusted
    // verifier can bind this exact turn to its durable session/packet evidence. Nonempty allowed
    // edits still pass every host-owned snapshot, diff, contained-validation, candidate, cleanup,
    // and explicit-owner-Apply gate below, so another multi-minute model turn would add no
    // authority. Without that binding (or without edits), retain the existing correction retry.
    if (paths.length && safeId(verified?.turnId)) {
      return {
        turn: null,
        turnId: verified.turnId,
        completionMode: "HOST_OBSERVED_OUTPUT_INVALID",
        changedPaths: paths,
        attempts: attempt,
      }
    }
    if (attempt === limit) throw failure
  }
}
function readResidentEvidence({ runtimeRoot, workspacePath, threadId, outcomes, reviewed }) {
  try {
    if (!ID.test(threadId)) throw new Error()
    const root = path.join(runtimeRoot, "hermes-kernel", "threads", threadId)
    const relative = (target) => path.relative(runtimeRoot, target).split(path.sep).join("/")
    const session = JSON.parse(fs.readFileSync(regularFile(runtimeRoot, relative(path.join(root, "session.json"))), "utf8"))
    if (session.schemaVersion !== 1 || session.threadId !== threadId || path.resolve(session.workspacePath) !== workspacePath
      || !Array.isArray(session.turns) || session.turns.length !== outcomes.length) throw new Error()
    const ignored = []
    const seen = new Set()
    let finalPacket
    let finalTurnId
    for (const [index, outcome] of outcomes.entries()) {
      const record = session.turns[index]
      if (!ID.test(record?.turnId) || seen.has(record.turnId) || record.exitCode !== 0 || record.failure !== undefined
        || record.harvested !== !outcome.failure || !SHA256.test(record.packetSha256)) throw new Error()
      seen.add(record.turnId)
      if (outcome.turn && (outcome.turn.turnId !== record.turnId || outcome.turn.threadId !== threadId || outcome.turn.status !== "completed")) throw new Error()
      if (outcome.recordId && outcome.recordId !== record.turnId) throw new Error()
      const bytes = fs.readFileSync(regularFile(runtimeRoot, relative(path.join(root, "turns", String(index + 1), "packet.json"))))
      if (digest(bytes) !== record.packetSha256 || (outcome.packetSha256 && outcome.packetSha256 !== record.packetSha256)) throw new Error()
      const packet = JSON.parse(bytes)
      if (packet.schemaVersion !== 3 || packet.runId !== record.turnId || packet.workspaceMode !== "OWNED_WORKTREE"
        || path.resolve(packet.workspacePath) !== workspacePath || !text(packet.model)) throw new Error()
      if (packet.placement !== undefined && !text(packet.placement?.computeId)) throw new Error()
      // Completed turns and the narrow harvest failure both occur AFTER the kernel's ignored check.
      // Omission is empty only for those verified outcomes, never arbitrary failed records.
      if (record.ignoredPathsCreated !== undefined) {
        if (!Array.isArray(record.ignoredPathsCreated) || record.ignoredPathsCreated.some((item) => !text(item))) throw new Error("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
        ignored.push(...record.ignoredPathsCreated)
      }
      outcome.recordId = record.turnId
      outcome.packetSha256 = record.packetSha256
      finalPacket = packet
      finalTurnId = record.turnId
    }
    if (ignored.length) throw new Error("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
    return { turnId: finalTurnId, model: finalPacket.model, executionNode: finalPacket.placement?.computeId ?? reviewed.placement.executionNode, ignoredPathsCreated: [...new Set(ignored)] }
  } catch (error) {
    if (error.message === "HELLO_PROPOSAL_IGNORED_PATH_REFUSED") throw error
    throw new Error("HELLO_PROPOSAL_RESIDENT_EVIDENCE_INVALID")
  }
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
    let bytes
    try { bytes = fs.readFileSync(target) }
    catch (error) {
      if (error.code === "ENOENT") return null
      throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    }
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
  const bytes = fs.readFileSync(files.patch)
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
function assertClaimOwnership(claim) {
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
  let current
  try { current = receipt(claim.runtime, claim.proposalId) }
  catch { throw new Error("claim ownership uncertain") }
  if (!current.bytes.equals(markerBytes) || !equal(current.value, claim.marker)) throw new Error("claim ownership uncertain")
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
    assertClaimOwnership(claim)
    const finalMarkerStat = fs.statSync(claim.files.inflight, { bigint: true })
    const finalTombstoneStat = fs.statSync(tombstone, { bigint: true })
    if (!sameIdentity(markerStat, finalMarkerStat) || !sameIdentity(finalMarkerStat, finalTombstoneStat)
      || fs.readFileSync(tombstone, "utf8") !== claim.markerText) throw new Error("claim cleanup uncertain")
    // Successful unlink releases A. A successor may claim immediately, so never inspect this path again.
    fs.unlinkSync(claim.files.inflight)
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
export function claimHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy }) {
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
  try {
    writeExclusiveSynced(files.inflight, markerText, () => { created = true })
    const claim = immutable({
      runtime, proposalId: id, requestedBy: owner, value: structuredClone(value), files: { ...files },
      originalReceiptBase64: bytes.toString("base64"), reviewPatch: reviewed.reviewPatch,
      marker: structuredClone(marker), markerText,
    })
    assertClaimOwnership(claim)
    return claim
  } catch (error) {
    if (!created) throw error
    try { persistApplyQuarantine(value, files) }
    catch { throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED") }
    throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
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
  const raw = await git(repository, ["apply", "--numstat", "-z", patch], { encoding: "buffer", errorCode: "HELLO_PROPOSAL_PATCH_INVALID" })
  // Hunk content always has a prefix. Only metadata before the first hunk is authoritative.
  let header = false
  for (const line of fs.readFileSync(patch, "utf8").split(/\r?\n/)) {
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
  if (removed.code || pruned.code || listed.code || fs.existsSync(workspace) || registered) throw new Error("HELLO_PROPOSAL_WORKTREE_CLEANUP_FAILED")
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
  const createdAt = new Date().toISOString()
  const progress = []
  const progressContract = execution.external ? EXTERNAL_PROGRESS : PROGRESS
  const observe = (index, notify = true) => {
    const entry = { stage: progressContract[index][0], detail: progressContract[index][1], at: new Date().toISOString() }
    progress.push(entry)
    if (notify) notifyProgress(onProgress, entry)
    return entry
  }
  observe(0)
  fs.mkdirSync(path.dirname(workspace), { recursive: true })
  if (fs.lstatSync(path.dirname(workspace)).isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim()
  if (!SHA.test(baseSha)) throw new Error("HELLO_PROPOSAL_BASE_INVALID")
  if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout) throw new Error("HELLO_PROPOSAL_CANONICAL_DIRTY")
  await git(repository, ["worktree", "add", "-b", branch, workspace, baseSha])
  let persisted = false
  let workspaceRemoved = false
  const files = pathsFor(runtime, id)
  const stagedPatch = `${files.patch}.${crypto.randomUUID()}.tmp`
  let artifactWriteStarted = false
  let publicationValue
  let publicationBytes
  try {
    assertHelloValidationWorkspace(runtime, workspace)
    observe(1)
    observe(2)
    const turn = execution.external
      ? await cerebrasTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, model: execution.model })
      : await residentTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, prompt: governedPrompt(requested) })
    observe(3)
    if ((await git(workspace, ["rev-parse", "HEAD"])).stdout.trim() !== baseSha) throw new Error("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
    const paths = changed((await git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout)
    assertHelloApplicationChangedPaths(paths, turn?.ignoredPathsCreated ?? null)
    assertHelloValidationWorkspace(runtime, workspace)
    const proposed = snapshot(workspace)
    await git(workspace, ["diff", "--check", "--", ...paths], { errorCode: "HELLO_PROPOSAL_DIFF_INVALID" })
    observe(4)
    const validation = validationResult(await validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace }))
    assertSnapshot(workspace, proposed, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    if ((await git(workspace, ["rev-parse", "HEAD"])).stdout.trim() !== baseSha) throw new Error("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
    await git(workspace, ["add", "--", ...paths])
    await git(workspace, ["-c", "user.name=WilliamOS HERMES Proposal", "-c", "user.email=hermes@williamos.local", "commit", "-m", `proposal(hello): resident change ${id}`])
    const proposalCommit = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim()
    await verifyCandidate(workspace, baseSha, proposalCommit, paths)
    const bytes = Buffer.from((await git(workspace, ["diff", "--binary", "--full-index", baseSha, proposalCommit, "--", ...paths], { encoding: "buffer" })).stdout)
    if (!bytes.length || bytes.length > MAX_PATCH_BYTES) throw new Error("HELLO_PROPOSAL_PATCH_SIZE_REFUSED")
    await removeWorktree(repository, runtime, workspace)
    workspaceRemoved = true
    const ready = observe(5, false)
    const value = { schemaVersion: execution.external ? 3 : 2, proposalId: id, status: "READY_FOR_REVIEW", requestedBy: owner, requestText: requested,
      requestSha256: digest(requested), executionNode: turn.executionNode ?? policy(repository).placement.executionNode,
      progress, createdAt, appliedAt: null, appliedCommit: null, baseSha, proposalCommit, branch, changedPaths: paths,
      patchSha256: digest(bytes), threadId: turn.threadId, turnId: turn.turnId, model: turn.model, validation }
    if (execution.external) value.providerExecution = turn.providerExecution
    try { validReceipt(value, id) } catch { throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID") }
    fs.mkdirSync(files.root, { recursive: true })
    if ([files.receipt, files.patch, files.quarantine, files.inflight].some((target) => fs.existsSync(target))) {
      throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    }
    publicationValue = value
    publicationBytes = bytes
    artifactWriteStarted = true
    fs.writeFileSync(stagedPatch, bytes, { flag: "wx" })
    syncFile(stagedPatch)
    await patchPaths(repository, stagedPatch)
    const result = review(value, { ...files, patch: stagedPatch })
    fs.renameSync(stagedPatch, files.patch)
    review(value, files)
    writeJson(files.receipt, value)
    persisted = true
    notifyProgress(onProgress, ready)
    return result
  } catch (error) {
    if (artifactWriteStarted && !persisted) {
      const cleaned = [files.receipt, files.patch, stagedPatch].map(removeCreationArtifactVerified).every(Boolean)
      if (!cleaned) {
        if (publicationValue && publicationBytes) persistCreationQuarantine(runtime, id, files, publicationValue, publicationBytes)
        throw new Error("HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
      }
    }
    throw error
  } finally {
    if (!workspaceRemoved) await bestEffortRemoveWorktree(repository, runtime, workspace)
    if (!persisted) {
      await git(repository, ["branch", "-D", branch], { allowFailure: true })
    }
  }
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

async function applyInner({ repositoryRoot: configured, proposalId, validateWorkspace, transactionOperations = {}, claim }) {
  assertClaimOwnership(claim)
  const repository = await repositoryRoot(configured)
  const runtime = claim.runtime
  const { value, files } = claim
  const originalReceipt = Buffer.from(claim.originalReceiptBase64, "base64")
  const reviewed = { ...value, reviewPatch: claim.reviewPatch }
  const paths = await patchPaths(repository, files.patch)
  if (!equal(paths, value.changedPaths)) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  const ref = (await git(repository, ["symbolic-ref", "HEAD"])).stdout.trim()
  if (!ref.startsWith("refs/heads/")) throw new Error("HELLO_PROPOSAL_BASE_INVALID")
  const base = value.baseSha
  const assertHead = async (expected) => {
    if ((await git(repository, ["symbolic-ref", "HEAD"])).stdout.trim() !== ref
      || (await git(repository, ["rev-parse", ref])).stdout.trim() !== expected) throw new Error("HELLO_PROPOSAL_STALE_BASE")
  }
  await assertHead(base)
  if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
  const original = snapshot(repository)
  const originalIndex = await indexEntries(repository)
  const baseEntries = await treeEntries(repository, base, paths)
  const workspace = path.join(runtime, "worktrees", `apply-${crypto.randomUUID()}`)
  const index = path.join(runtime, "worktrees", `apply-index-${crypto.randomUUID()}`)
  const temporary = `${files.receipt}.${crypto.randomUUID()}.tmp`
  const patch = `${files.patch}.${crypto.randomUUID()}.tmp`
  let phase = "VALIDATING"
  let candidate = null
  let candidateEntries
  let proposed
  let updated
  const written = new Set()
  const synced = new Set()
  // Server-only injection points: routes never forward browser options here.
  const checkpoint = async (stage) => transactionOperations.checkpoint?.(stage, { phase, candidate, ref })
  try {
    assertClaimOwnership(claim)
    fs.mkdirSync(path.dirname(workspace), { recursive: true })
    fs.writeFileSync(patch, reviewed.reviewPatch, { flag: "wx" })
    await git(repository, ["worktree", "add", "--detach", workspace, base])
    assertHelloValidationWorkspace(runtime, workspace)
    // Preserve canonical line endings in the validation snapshot, as well as content and modes.
    for (const [item, state] of original) { fs.writeFileSync(filePath(workspace, item), state.bytes); fs.chmodSync(filePath(workspace, item), state.mode) }
    await git(workspace, ["apply", "--whitespace=error-all", patch])
    proposed = snapshot(workspace)
    const validation = validationResult(await validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace }))
    assertHelloValidationWorkspace(runtime, workspace)
    assertSnapshot(workspace, proposed, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    assertSnapshot(repository, original, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    const env = { ...process.env, GIT_INDEX_FILE: index }
    await git(workspace, ["read-tree", base], { env })
    await git(workspace, ["add", "--", ...paths], { env })
    const tree = (await git(workspace, ["write-tree"], { env })).stdout.trim()
    candidate = (await git(repository, ["-c", "user.name=WilliamOS HERMES Apply", "-c", "user.email=hermes@williamos.local", "commit-tree", tree, "-p", base, "-m", `apply(hello): governed proposal ${proposalId}`], { env })).stdout.trim()
    candidateEntries = await verifyCandidate(repository, base, candidate, paths)
    assertSnapshot(workspace, proposed, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    updated = { ...value, status: "APPLIED", appliedAt: new Date().toISOString(), appliedCommit: candidate, validation }
    validReceipt(updated, proposalId)
    await checkpoint("receipt_prewrite")
    fs.writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" })
    phase = "PREPARED"
    await assertHead(base)
    if (!equal(await indexEntries(repository), originalIndex)) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
    assertSnapshot(repository, original, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    phase = "WRITING"
    for (const item of paths) {
      await checkpoint("canonical_write")
      assertSnapshot(repository, new Map([[item, original.get(item)]]), "HELLO_PROPOSAL_TARGET_DIRTY")
      written.add(item)
      fs.writeFileSync(regularFile(repository, item), proposed.get(item).bytes)
      fs.chmodSync(filePath(repository, item), proposed.get(item).mode)
    }
    await checkpoint("before_publish")
    await assertHead(base)
    if (!equal(await indexEntries(repository), originalIndex)) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
    assertSnapshot(repository, proposed, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    await git(repository, ["update-ref", ref, candidate, base])
    phase = "PUBLISHED"
    await checkpoint("published")
    for (const item of paths) {
      const current = (await indexEntries(repository)).find((entry) => entryPath(entry) === item)
      if (current !== originalIndex.find((entry) => entryPath(entry) === item)) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
      synced.add(item)
      await setIndexEntry(repository, item, candidateEntries.get(item))
    }
    phase = "INDEX_SYNCED"
    await checkpoint("index_synced")
    // Strict workspace cleanup and all checks precede the atomic receipt rename.
    await removeWorktree(repository, runtime, workspace)
    fs.rmSync(index, { force: true })
    fs.rmSync(patch, { force: true })
    await checkpoint("receipt_replace")
    await assertHead(candidate)
    assertSnapshot(repository, proposed, "HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    if (!equal(await indexEntries(repository), replaceIndexEntries(originalIndex, candidateEntries))) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
    if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
    if (!fs.readFileSync(files.receipt).equals(originalReceipt)) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    fs.renameSync(temporary, files.receipt)
    phase = "FINALIZED"
    // APPLIED already supersedes this journal. A cleanup failure cannot reject a completed Apply.
    bestEffortReleaseAppliedClaim(claim)
    return { ...updated, reviewPatch: reviewed.reviewPatch }
  } catch (error) {
    let recovered = true
    try {
      if (["PUBLISHED", "INDEX_SYNCED"].includes(phase)) {
        await checkpoint("rollback_ref")
        await assertHead(candidate)
        await git(repository, ["update-ref", ref, base, candidate])
      }
      if (written.size) {
        await assertHead(base)
        const initialEntry = (item) => originalIndex.find((entry) => entryPath(entry) === item)
        const candidateEntry = (item) => `${candidateEntries.get(item).mode} ${candidateEntries.get(item).blob} 0\t${item}`
        const currentEntry = async (item) => {
          const entries = (await indexEntries(repository)).filter((entry) => entryPath(entry) === item)
          if (entries.length !== 1) throw new Error("unowned index state")
          return entries[0]
        }
        const assertRestoreOwnership = async (item, expectedIndex) => {
          await assertHead(base)
          if (await currentEntry(item) !== expectedIndex) throw new Error("unowned index state")
        }
        for (const item of written) {
          const ownedIndex = await currentEntry(item)
          if (ownedIndex !== initialEntry(item) && (!synced.has(item) || ownedIndex !== candidateEntry(item))) throw new Error("unowned index state")
          const actual = snapshot(repository, [item]).get(item)
          if (!sameFile(actual, original.get(item))) {
            if (!sameFile(actual, proposed.get(item))) throw new Error("unowned worktree state")
            await checkpoint("restore_file")
            await assertRestoreOwnership(item, ownedIndex)
            assertSnapshot(repository, new Map([[item, proposed.get(item)]]), "HELLO_PROPOSAL_ROLLBACK_FAILED")
            fs.writeFileSync(regularFile(repository, item), original.get(item).bytes)
            await assertRestoreOwnership(item, ownedIndex)
            fs.chmodSync(filePath(repository, item), original.get(item).mode)
            await assertRestoreOwnership(item, ownedIndex)
            assertSnapshot(repository, new Map([[item, original.get(item)]]), "HELLO_PROPOSAL_ROLLBACK_FAILED")
          }
        }
        for (const item of synced) {
          const current = await currentEntry(item)
          const initial = initialEntry(item)
          if (current !== initial) {
            if (current !== candidateEntry(item)) throw new Error("unowned index state")
            await checkpoint("restore_index")
            await assertRestoreOwnership(item, current)
            assertSnapshot(repository, new Map([[item, original.get(item)]]), "HELLO_PROPOSAL_ROLLBACK_FAILED")
            await setIndexEntry(repository, item, baseEntries.get(item))
            await assertRestoreOwnership(item, initial)
          }
        }
        assertSnapshot(repository, new Map(paths.map((item) => [item, original.get(item)])), "HELLO_PROPOSAL_ROLLBACK_FAILED")
        const actualIndex = await indexEntries(repository)
        for (const item of paths) if (actualIndex.find((entry) => entryPath(entry) === item) !== originalIndex.find((entry) => entryPath(entry) === item)) throw new Error("index restore failed")
        if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...paths])).stdout) throw new Error("restore is dirty")
        await assertHead(base)
      }
      if (!fs.readFileSync(files.receipt).equals(originalReceipt)) throw new Error("receipt replacement uncertain")
      assertClaimOwnership(claim)
    } catch { recovered = false }
    if (!recovered) {
      persistApplyQuarantine(value, files)
      throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
    }
    throw error
  } finally {
    if (phase !== "FINALIZED") {
      await bestEffortRemoveWorktree(repository, runtime, workspace)
      for (const target of [index, temporary, patch]) { try { fs.rmSync(target, { force: true }) } catch { /* No canonical mutation. */ } }
    }
  }
}
async function applyClaimed(options, claim) {
  try {
    return await applyInner({ ...options, claim })
  } catch (error) {
    try { releaseClaim(claim) }
    catch {
      try { persistApplyQuarantine(claim.value, claim.files) }
      catch { throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED") }
      throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
    }
    throw error
  }
}
export async function applyHelloApplicationProposal(options) {
  const claim = claimHelloApplicationProposal(options)
  const claimedOptions = {
    ...options,
    runtimeRoot: claim.runtime,
    proposalId: claim.proposalId,
    requestedBy: claim.requestedBy,
    validateWorkspace: options.validateWorkspace ?? validateHelloApplicationInContainer,
  }
  const next = applyQueue.then(() => applyClaimed(claimedOptions, claim))
  applyQueue = next.catch(() => {})
  return next
}
export function rejectHelloApplicationProposal(options) {
  const claim = claimHelloApplicationProposalRejection(options)
  if (claim.terminal) return claim.terminal
  const updated = {
    ...claim.value,
    status: "REJECTED",
    rejectedAt: claim.marker.rejectStartedAt,
    rejectionReason: claim.rejectionReason,
  }
  validReceipt(updated, claim.proposalId)
  const encoded = encodedJson(updated)
  const acceptMatchingTerminal = () => matchingRejectedTerminal(
    claim.runtime,
    claim.proposalId,
    encoded,
    claim.reviewPatch,
    claim,
  )
  const temporary = `${claim.files.receipt}.${crypto.randomUUID()}.reject`
  let finalized = false
  try {
    fs.writeFileSync(temporary, encoded, { flag: "wx" })
    syncFile(temporary)
    if (fs.readFileSync(temporary, "utf8") !== encoded) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    assertClaimOwnership(claim)
    fs.renameSync(temporary, claim.files.receipt)
    finalized = true
    bestEffortReleaseAppliedClaim(claim)
    return { ...updated, reviewPatch: claim.reviewPatch }
  } catch (error) {
    if (!finalized) {
      const completed = acceptMatchingTerminal()
      if (completed) return completed
      try { releaseClaim(claim) }
      catch {
        const completedAfterReleaseRace = acceptMatchingTerminal()
        if (completedAfterReleaseRace) return completedAfterReleaseRace
        throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
      }
    }
    throw error
  } finally {
    try { fs.rmSync(temporary, { force: true }) } catch { /* The terminal receipt is authoritative. */ }
  }
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
