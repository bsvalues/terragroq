import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
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
function syncFile(target) {
  const descriptor = fs.openSync(target, "r+")
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}
function removeVerified(target) {
  try { fs.rmSync(target, { force: true }) } catch { /* Verification below decides the outcome. */ }
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
 * @returns {Promise<{ turn: any, changedPaths: string[], attempts: number }>}
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
    if (verifyAttempt) await verifyAttempt({ attempt, turn, failure })
    if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    paths = await readChangedPaths()
    if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
    if (paths.length) assertHelloApplicationChangedPaths(paths, [])
    if (!failure) {
      if (remainingBudget() <= 0) throw new Error("HELLO_PROPOSAL_RESIDENT_TIMEOUT")
      return { turn, changedPaths: paths, attempts: attempt }
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
    }
    if (ignored.length) throw new Error("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
    return { model: finalPacket.model, executionNode: finalPacket.placement?.computeId ?? reviewed.placement.executionNode, ignoredPathsCreated: [...new Set(ignored)] }
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
      },
    })
    return { threadId, turnId: result.turn.turnId, ...evidence }
  } finally { client.close() }
}

function validReceipt(value, id) {
  if (!value || ![1, 2].includes(value.schemaVersion) || value.proposalId !== id || !ID.test(id)
    || !["READY_FOR_REVIEW", "APPLIED", "QUARANTINED_ROLLBACK_FAILED"].includes(value.status)
    || !text(value.requestedBy) || !timestamp(value.createdAt) || !SHA.test(value.baseSha) || !SHA.test(value.proposalCommit)
    || !SHA256.test(value.patchSha256) || !safeId(value.threadId) || !safeId(value.turnId) || !text(value.model)
    || value.branch !== `codex/hermes-hello-${id}` || !Array.isArray(value.changedPaths) || !value.changedPaths.length
    || !equal(value.changedPaths, [...new Set(value.changedPaths)].sort())
    || value.changedPaths.some((item) => !HELLO_APPLICATION_ALLOWED_PATHS.includes(item))) throw new Error()
  validationResult(value.validation)
  if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || value.appliedAt < value.createdAt) throw new Error()
    if (value.schemaVersion === 2 ? !SHA.test(value.appliedCommit) : value.appliedCommit !== undefined && !SHA.test(value.appliedCommit)) throw new Error()
  } else if (value.appliedAt !== null || (value.schemaVersion === 2 && value.appliedCommit !== null)) throw new Error()
  if (value.status === "QUARANTINED_ROLLBACK_FAILED") {
    if (!timestamp(value.quarantinedAt) || value.quarantinedAt < value.createdAt) throw new Error()
  } else if (value.quarantinedAt !== undefined) throw new Error()
  if (value.schemaVersion === 2) {
    const keys = ["schemaVersion", "proposalId", "status", "requestedBy", "requestText", "requestSha256", "executionNode", "progress", "createdAt", "appliedAt", "appliedCommit", "baseSha", "proposalCommit", "branch", "changedPaths", "patchSha256", "threadId", "turnId", "model", "validation"]
    if (value.status === "QUARANTINED_ROLLBACK_FAILED") keys.push("quarantinedAt")
    if (!equal(Object.keys(value).sort(), keys.sort())) throw new Error()
    if (request(value.requestText) !== value.requestText || value.requestSha256 !== digest(value.requestText)
      || !text(value.executionNode) || !Array.isArray(value.progress) || value.progress.length !== PROGRESS.length) throw new Error()
    let previous = value.createdAt
    for (const [index, entry] of value.progress.entries()) {
      if (!equal(Object.keys(entry).sort(), ["at", "detail", "stage"]) || entry.stage !== PROGRESS[index][0]
        || entry.detail !== PROGRESS[index][1] || !timestamp(entry.at) || entry.at < previous) throw new Error()
      previous = entry.at
    }
    if (value.appliedAt && value.appliedAt < previous) throw new Error()
  }
  return value
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
    if (inflight.value.status !== "QUARANTINED_ROLLBACK_FAILED") throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
    const { quarantinedAt, ...projection } = inflight.value
    projection.status = "READY_FOR_REVIEW"
    if (stored && (Object.keys(projection).length !== Object.keys(stored.value).length
      || Object.keys(stored.value).some((key) => !equal(projection[key], stored.value[key])))) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
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
 * @param {{ repositoryRoot: string, runtimeRoot: string, requestedBy: string, requestText: string, onProgress?: (event: { stage: string, detail: string, at: string }) => unknown, residentTurn?: (input: { repositoryRoot: string, runtimeRoot: string, workspacePath: string, requestText: string, prompt: string }) => Promise<any>, validateWorkspace?: (input: { repositoryRoot: string, runtimeRoot: string, workspacePath: string }) => Promise<any> }} options
 */
export async function createHelloApplicationProposal({ repositoryRoot: configured, runtimeRoot, requestedBy, requestText, onProgress, residentTurn = defaultResident, validateWorkspace = validateHelloApplicationInContainer }) {
  const owner = required(requestedBy, "requestedBy")
  const requested = request(requestText)
  const repository = await repositoryRoot(configured)
  const runtime = path.resolve(required(runtimeRoot, "runtimeRoot"))
  const id = crypto.randomUUID()
  const workspace = path.join(runtime, "worktrees", `hello-${id}`)
  const branch = `codex/hermes-hello-${id}`
  const createdAt = new Date().toISOString()
  const progress = []
  const observe = (index, notify = true) => {
    const entry = { stage: PROGRESS[index][0], detail: PROGRESS[index][1], at: new Date().toISOString() }
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
    const turn = await residentTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, prompt: governedPrompt(requested) })
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
    const value = { schemaVersion: 2, proposalId: id, status: "READY_FOR_REVIEW", requestedBy: owner, requestText: requested,
      requestSha256: digest(requested), executionNode: turn.executionNode ?? policy(repository).placement.executionNode,
      progress, createdAt, appliedAt: null, appliedCommit: null, baseSha, proposalCommit, branch, changedPaths: paths,
      patchSha256: digest(bytes), threadId: turn.threadId, turnId: turn.turnId, model: turn.model, validation }
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
      const cleaned = [files.receipt, files.patch, stagedPatch].map(removeVerified).every(Boolean)
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

async function applyInner({ repositoryRoot: configured, runtimeRoot, proposalId, requestedBy, validateWorkspace, transactionOperations = {} }) {
  const repository = await repositoryRoot(configured)
  const runtime = path.resolve(runtimeRoot)
  const { value, files, bytes: originalReceipt } = receipt(runtime, required(proposalId, "proposalId"))
  if (value.requestedBy !== required(requestedBy, "requestedBy")) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  if (value.status !== "READY_FOR_REVIEW") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
  const reviewed = review(value, files)
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
  let inflightWritten = false
  const written = new Set()
  const synced = new Set()
  // Server-only injection points: routes never forward browser options here.
  const checkpoint = async (stage) => transactionOperations.checkpoint?.(stage, { phase, candidate, ref })
  try {
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
    // A process exit from this point onward must never leave a reusable READY receipt.
    const inflight = { ...value, status: "QUARANTINED_ROLLBACK_FAILED", quarantinedAt: new Date().toISOString() }
    validReceipt(inflight, proposalId)
    writeJson(files.inflight, inflight)
    inflightWritten = true
    if (!equal(receipt(runtime, proposalId).value, inflight)) throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
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
    try { fs.rmSync(files.inflight, { force: true }) } catch { /* Safe stale marker; APPLIED remains authoritative. */ }
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
      if (inflightWritten) {
        fs.rmSync(files.inflight, { force: true })
        if (fs.existsSync(files.inflight)) throw new Error("journal cleanup uncertain")
      }
    } catch { recovered = false }
    if (!recovered) {
      const quarantined = { ...value, status: "QUARANTINED_ROLLBACK_FAILED", quarantinedAt: new Date().toISOString() }
      // Independent durable marker survives failure replacing the receipt. Every reader checks it.
      let durable = false
      const encoded = `${JSON.stringify(quarantined, null, 2)}\n`
      try {
        fs.writeFileSync(files.quarantine, encoded, { flag: "wx" })
        durable = fs.readFileSync(files.quarantine, "utf8") === encoded
      } catch { /* Try the independent receipt path below. */ }
      try { writeJson(files.receipt, quarantined) } catch { /* Marker remains authoritative. */ }
      if (!durable) {
        try { durable = fs.readFileSync(files.receipt, "utf8") === encoded } catch { /* Fail closed. */ }
      }
      if (!durable) throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED:QUARANTINE_PERSISTENCE_FAILED")
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
export async function applyHelloApplicationProposal(options) {
  const next = applyQueue.then(() => applyInner({ ...options, validateWorkspace: options.validateWorkspace ?? validateHelloApplicationInContainer }))
  applyQueue = next.catch(() => {})
  return next
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
