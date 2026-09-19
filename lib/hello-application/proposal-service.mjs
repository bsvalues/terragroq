import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
import { createGovernedMarkerExpectedSources } from "../../scripts/hello-application/apply-governed-marker-change.mjs"

export const HELLO_APPLICATION_ALLOWED_PATHS = Object.freeze([
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
])

const PROPOSAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{40,64}$/
const MAX_PATCH_BYTES = 256 * 1024
const TURN_TIMEOUT_MS = 30 * 60 * 1000
const HELLO_APPLICATION_VALIDATION_PATHS = Object.freeze([
  ...HELLO_APPLICATION_ALLOWED_PATHS,
  "examples/hello-application/package.json",
  "examples/hello-application/server.mjs",
  "examples/hello-application/test/hello.test.mjs",
])

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) throw new TypeError(`${name} is required`)
  return value
}

function samePath(left, right) {
  return process.platform === "win32"
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right)
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: options.encoding ?? "utf8",
      env: options.env,
      maxBuffer: options.maxBuffer ?? 2_000_000,
      timeout: options.timeout ?? 60_000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const result = { code: error?.code && Number.isInteger(error.code) ? error.code : error ? 1 : 0, stdout, stderr }
      if (error && !options.allowFailure) {
        const detail = String(stderr || stdout || error.message).trim().slice(0, 800)
        reject(new Error(`${options.errorCode ?? "HELLO_PROPOSAL_COMMAND_FAILED"}${detail ? `:${detail}` : ""}`))
        return
      }
      resolve(result)
    })
  })
}

async function git(repositoryRoot, args, options = {}) {
  return runFile("git", ["-C", repositoryRoot, ...args], options)
}

function proposalsRoot(runtimeRoot) {
  return path.join(path.resolve(runtimeRoot), "hello-application-proposals")
}

function proposalPaths(runtimeRoot, proposalId) {
  if (!PROPOSAL_ID.test(proposalId)) throw new Error("HELLO_PROPOSAL_ID_INVALID")
  const root = proposalsRoot(runtimeRoot)
  return {
    root,
    receipt: path.join(root, `${proposalId}.json`),
    patch: path.join(root, `${proposalId}.patch`),
  }
}

function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  fs.renameSync(temporary, target)
}

function readProposal(runtimeRoot, proposalId) {
  const files = proposalPaths(runtimeRoot, proposalId)
  let value
  try { value = JSON.parse(fs.readFileSync(files.receipt, "utf8")) } catch { throw new Error("HELLO_PROPOSAL_NOT_FOUND") }
  if (value?.schemaVersion !== 1 || value.proposalId !== proposalId || !Array.isArray(value.changedPaths)
    || !SHA.test(value.baseSha ?? "") || !SHA.test(value.proposalCommit ?? "")
    || typeof value.patchSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.patchSha256)) {
    throw new Error("HELLO_PROPOSAL_RECEIPT_INVALID")
  }
  return { value, files }
}

function decodeReviewPatch(patchBytes) {
  if (patchBytes.length === 0 || patchBytes.length > MAX_PATCH_BYTES || patchBytes.includes(0)) {
    throw new Error("HELLO_PROPOSAL_PATCH_REVIEW_INVALID")
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(patchBytes)
  } catch {
    throw new Error("HELLO_PROPOSAL_PATCH_REVIEW_INVALID")
  }
}

function proposalForReview(proposal, files) {
  const patchBytes = fs.readFileSync(files.patch)
  if (crypto.createHash("sha256").update(patchBytes).digest("hex") !== proposal.patchSha256) {
    throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH")
  }
  return { ...proposal, reviewPatch: decodeReviewPatch(patchBytes) }
}

function parseChangedPaths(status) {
  const paths = []
  for (const entry of String(status).split("\0").filter(Boolean)) {
    const code = entry.slice(0, 2)
    const changedPath = entry.slice(3)
    if (!changedPath || code.includes("R") || code.includes("C")) throw new Error("HELLO_PROPOSAL_RENAME_REFUSED")
    paths.push(changedPath.replaceAll("\\", "/"))
  }
  return [...new Set(paths)].sort()
}

export function assertHelloApplicationChangedPaths(paths, ignoredPathsCreated = []) {
  if (!Array.isArray(ignoredPathsCreated) || ignoredPathsCreated.length > 0) {
    throw new Error("HELLO_PROPOSAL_IGNORED_PATH_REFUSED")
  }
  if (!Array.isArray(paths)) throw new Error("HELLO_PROPOSAL_EXACT_FILE_SET_REQUIRED")
  if (paths.length > HELLO_APPLICATION_ALLOWED_PATHS.length) throw new Error("HELLO_PROPOSAL_PATH_LIMIT")
  const allowed = new Set(HELLO_APPLICATION_ALLOWED_PATHS)
  for (const changedPath of paths) {
    if (!allowed.has(changedPath)) throw new Error(`HELLO_PROPOSAL_PATH_REFUSED:${changedPath}`)
  }
  const normalized = [...new Set(paths)].sort()
  if (JSON.stringify(normalized) !== JSON.stringify([...HELLO_APPLICATION_ALLOWED_PATHS].sort())) {
    throw new Error("HELLO_PROPOSAL_EXACT_FILE_SET_REQUIRED")
  }
}

async function derivePatchPaths(repositoryRoot, patchPath) {
  const result = await git(repositoryRoot, ["apply", "--numstat", "-z", patchPath], {
    encoding: "buffer",
    maxBuffer: MAX_PATCH_BYTES + 4096,
    errorCode: "HELLO_PROPOSAL_PATCH_INVALID",
  })
  const paths = []
  for (const entry of Buffer.from(result.stdout).toString("utf8").split("\0").filter(Boolean)) {
    const firstTab = entry.indexOf("\t")
    const secondTab = entry.indexOf("\t", firstTab + 1)
    if (firstTab < 1 || secondTab <= firstTab + 1) throw new Error("HELLO_PROPOSAL_PATCH_INVALID")
    paths.push(entry.slice(secondTab + 1).replaceAll("\\", "/"))
  }
  if (new Set(paths).size !== paths.length) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  const sorted = [...paths].sort()
  try {
    assertHelloApplicationChangedPaths(sorted, [])
  } catch {
    throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  }
  return sorted
}

async function assertGovernedMarkerSemantics(repositoryRoot, baseSha) {
  const baselineByPath = {}
  for (const relativePath of HELLO_APPLICATION_ALLOWED_PATHS) {
    baselineByPath[relativePath] = (await git(repositoryRoot, ["show", `${baseSha}:${relativePath}`], {
      errorCode: "HELLO_PROPOSAL_GOVERNED_MARKER_BASE_INVALID",
    })).stdout
  }
  let expectedByPath
  try {
    expectedByPath = createGovernedMarkerExpectedSources(baselineByPath)
  } catch {
    throw new Error("HELLO_PROPOSAL_GOVERNED_MARKER_BASE_INVALID")
  }
  for (const relativePath of HELLO_APPLICATION_ALLOWED_PATHS) {
    const actual = fs.readFileSync(path.join(repositoryRoot, ...relativePath.split("/")), "utf8")
    if (actual.replaceAll("\r\n", "\n") !== expectedByPath[relativePath].replaceAll("\r\n", "\n")) {
      throw new Error("HELLO_PROPOSAL_GOVERNED_MARKER_INVALID")
    }
  }
}

async function validateHelloApplication(repositoryRoot, baseSha) {
  await assertGovernedMarkerSemantics(repositoryRoot, baseSha)
  const testPath = path.join(repositoryRoot, "examples", "hello-application", "test", "hello.test.mjs")
  const result = await runFile(process.execPath, ["--test", testPath], {
    cwd: repositoryRoot,
    timeout: 60_000,
    errorCode: "HELLO_PROPOSAL_VALIDATION_FAILED",
  })
  return {
    status: "passed",
    command: "node --test examples/hello-application/test/hello.test.mjs",
    output: `${result.stdout}${result.stderr}`.trim().slice(-12_000),
  }
}

export function governedPrompt() {
  return [
    "Implement one bounded Hello Application improvement for WO-HELLO-HERMES-001.",
    "Your first action must be to use the terminal tool to run exactly: node scripts/hello-application/apply-governed-marker-change.mjs",
    "That single trusted, idempotent WilliamOS command performs the required bounded edits and runs the Hello Application test. Do not hand-edit around it or substitute prose or fenced code blocks for running it.",
    "Do not substitute prose or fenced code blocks for file edits.",
    "If the codemod reports a drift error, stop and report that exact error; do not hand-edit around it.",
    "Make all three on-disk edits below:",
    "1. In examples/hello-application/src/index.html, immediately after the existing #pulse-status paragraph, add a visible paragraph with id=\"governance-marker\", class=\"governance-marker\", and initial text exactly 'Governed by HERMES · build ready'.",
    "2. In examples/hello-application/src/styles.css, add a .governance-marker rule that visibly styles the marker using the existing color variables and no gradient.",
    "3. In examples/hello-application/src/app.js, look up #governance-marker and, after each successful pulse, set its text to 'Governed by HERMES · pulse NNN' using the same zero-padded pulse number shown by #pulse-count. Keep this lookup optional so the existing fixture contract remains compatible.",
    "Preserve all existing ids, text, health behavior, Send pulse behavior, and tests.",
    `Modify these three existing files and no others: ${HELLO_APPLICATION_ALLOWED_PATHS.join(", ")}.`,
    "Do not create files, change tests, change the server, install dependencies, commit, push, or use network access.",
    "Do not run Git inside the resident container. The trusted WilliamOS host verifies the resulting diff and exact file scope after your turn.",
    "When the command exits successfully and prints three changedPaths plus validation status passed, immediately emit the required final object. Do not run another terminal command or inspect files.",
  ].join("\n")
}

function residentCorrectionPrompt(changedPaths, attempt) {
  const observed = changedPaths.length > 0 ? changedPaths.join(", ") : "none"
  const allTargetsPresent = HELLO_APPLICATION_ALLOWED_PATHS.every((target) => changedPaths.includes(target))
  if (allTargetsPresent) {
    return [
      `Correction attempt ${attempt}: the prior response did not satisfy the required completion contract.`,
      `Actual changed paths: ${observed}.`,
      "All three required edits already exist on disk. Do not edit them again and do not rerun the codemod.",
      "Do not run Git inside the resident container. The trusted WilliamOS host verifies the resulting diff and exact file scope after your turn.",
      "Run: node --test examples/hello-application/test/hello.test.mjs",
      "Only after validation passes, emit the required final result object.",
    ].join("\n")
  }
  return [
    `Correction attempt ${attempt}: the prior response did not produce the required governed multi-file patch.`,
    `Actual changed paths: ${observed}.`,
    "Your first action must be the terminal command: node scripts/hello-application/apply-governed-marker-change.mjs",
    "Make all three on-disk edits; do not provide sample code or describe future work.",
    governedPrompt(),
  ].join("\n")
}

function isRecoverableResidentCompletionFailure(error) {
  return error?.name === "AppServerTurnEndedError"
    && error?.status === "failed"
    && String(error?.detail ?? "").startsWith("RESIDENT_MODEL_TURN_OUTPUT_INVALID:")
}

export async function runGovernedResidentChange({
  client,
  threadId,
  readChangedPaths,
  timeoutMs = TURN_TIMEOUT_MS,
  maximumAttempts = 3,
}) {
  if (!client || typeof client.runTurn !== "function") throw new TypeError("resident client is required")
  if (typeof readChangedPaths !== "function") throw new TypeError("readChangedPaths is required")
  let changedPaths = []
  let lastCompletedTurn = null

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const prompt = attempt === 1 ? governedPrompt() : residentCorrectionPrompt(changedPaths, attempt)
    let turn
    try {
      turn = await client.runTurn({ threadId, prompt, timeoutMs })
    } catch (error) {
      changedPaths = await readChangedPaths()
      if (!isRecoverableResidentCompletionFailure(error) || attempt === maximumAttempts) throw error
      continue
    }

    lastCompletedTurn = turn
    changedPaths = await readChangedPaths()
    const allowed = new Set(HELLO_APPLICATION_ALLOWED_PATHS)
    const exactRequiredSet = changedPaths.length === HELLO_APPLICATION_ALLOWED_PATHS.length
      && HELLO_APPLICATION_ALLOWED_PATHS.every((requiredPath) => changedPaths.includes(requiredPath))
    if (changedPaths.some((changedPath) => !allowed.has(changedPath)) || exactRequiredSet) {
      return { turn, changedPaths, attempts: attempt }
    }
  }

  return { turn: lastCompletedTurn, changedPaths, attempts: maximumAttempts }
}

async function runResidentTurn({ repositoryRoot, runtimeRoot, workspacePath }) {
  const backend = new ResidentModelExecutionBackend({ repositoryRoot, runtimeRoot })
  const client = await backend.runCodexClient({ workspacePath, timeoutMs: TURN_TIMEOUT_MS })
  try {
    await client.connect()
    const threadId = await client.startThread()
    const execution = await runGovernedResidentChange({
      client,
      threadId,
      timeoutMs: TURN_TIMEOUT_MS,
      readChangedPaths: async () => parseChangedPaths((await git(workspacePath, [
        "status", "--porcelain=v1", "-z", "--untracked-files=all",
      ])).stdout),
    })
    const turn = execution.turn
    if (!turn) throw new Error("HELLO_PROPOSAL_RESIDENT_TURN_INCOMPLETE")
    const sessionPath = path.join(runtimeRoot, "hermes-kernel", "threads", threadId, "session.json")
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"))
    const record = session.turns?.find((candidate) => candidate.turnId === turn.turnId)
    const records = Array.isArray(session.turns) ? session.turns : []
    const ignoredPathsCreated = records.some((candidate) => candidate.ignoredPathsCreated === null)
      ? null
      : [...new Set(records.flatMap((candidate) => Array.isArray(candidate.ignoredPathsCreated) ? candidate.ignoredPathsCreated : []))].sort()
    const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), "utf8"))
    return {
      threadId,
      turnId: turn.turnId,
      model: policy.model.id,
      ignoredPathsCreated: record?.ignoredPathsCreated === null ? null : ignoredPathsCreated,
    }
  } finally {
    client.close()
  }
}

async function verifiedRepositoryRoot(repositoryRoot) {
  const configured = fs.realpathSync(path.resolve(required(repositoryRoot, "repositoryRoot")))
  const top = (await git(configured, ["rev-parse", "--show-toplevel"], { errorCode: "HELLO_PROPOSAL_REPOSITORY_INVALID" })).stdout.trim()
  const canonicalTop = fs.realpathSync(path.resolve(top))
  if (!samePath(configured, canonicalTop)) throw new Error("HELLO_PROPOSAL_REPOSITORY_INVALID")
  return configured
}

async function removeOwnedWorktree(repositoryRoot, runtimeRoot, worktreePath, force = false) {
  const ownedRoot = path.resolve(runtimeRoot, "worktrees")
  if (path.dirname(path.resolve(worktreePath)) !== ownedRoot) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  const args = ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath]
  const result = await git(repositoryRoot, args, { allowFailure: true })
  if (result.code !== 0 && !force) return removeOwnedWorktree(repositoryRoot, runtimeRoot, worktreePath, true)
  await git(repositoryRoot, ["worktree", "prune"], { allowFailure: true })
}

export async function createHelloApplicationProposal({
  repositoryRoot,
  runtimeRoot,
  requestedBy,
  residentTurn = runResidentTurn,
}) {
  const repository = await verifiedRepositoryRoot(repositoryRoot)
  const runtime = path.resolve(required(runtimeRoot, "runtimeRoot"))
  const owner = required(requestedBy, "requestedBy")
  const proposalId = crypto.randomUUID()
  const branch = `codex/hermes-hello-${proposalId}`
  const worktrees = path.join(runtime, "worktrees")
  const worktreePath = path.join(worktrees, `hello-${proposalId}`)
  fs.mkdirSync(worktrees, { recursive: true })
  if (fs.lstatSync(worktrees).isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")

  const baseSha = (await git(repository, ["rev-parse", "--verify", "HEAD"])).stdout.trim().toLowerCase()
  if (!SHA.test(baseSha)) throw new Error("HELLO_PROPOSAL_BASE_INVALID")
  const canonicalStatus = (await git(repository, ["status", "--porcelain=v1", "-z", "--", ...HELLO_APPLICATION_VALIDATION_PATHS])).stdout
  if (canonicalStatus) throw new Error("HELLO_PROPOSAL_CANONICAL_DIRTY")

  await git(repository, ["worktree", "add", "-b", branch, worktreePath, baseSha], { timeout: 60_000 })
  let proposalPersisted = false
  try {
    const turn = await residentTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: worktreePath, prompt: governedPrompt() })
    const residentHead = (await git(worktreePath, ["rev-parse", "--verify", "HEAD"])).stdout.trim().toLowerCase()
    if (residentHead !== baseSha) throw new Error("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
    const status = (await git(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout
    const changedPaths = parseChangedPaths(status)
    assertHelloApplicationChangedPaths(changedPaths, turn?.ignoredPathsCreated)
    await git(worktreePath, ["diff", "--check", "--", ...changedPaths], { errorCode: "HELLO_PROPOSAL_DIFF_INVALID" })
    const validation = await validateHelloApplication(worktreePath, baseSha)

    await git(worktreePath, ["add", "--", ...changedPaths])
    await git(worktreePath, [
      "-c", "user.name=WilliamOS HERMES Proposal",
      "-c", "user.email=hermes@williamos.local",
      "commit", "-m", `proposal(hello): governed resident change ${proposalId}`,
    ], { errorCode: "HELLO_PROPOSAL_COMMIT_FAILED" })
    const proposalCommit = (await git(worktreePath, ["rev-parse", "--verify", "HEAD"])).stdout.trim().toLowerCase()
    if (!SHA.test(proposalCommit) || proposalCommit === baseSha) throw new Error("HELLO_PROPOSAL_COMMIT_INVALID")
    const committedPaths = (await git(worktreePath, ["diff", "--name-only", "--format=", baseSha, proposalCommit])).stdout
      .split(/\r?\n/).filter(Boolean).sort()
    assertHelloApplicationChangedPaths(committedPaths, [])
    if (JSON.stringify(committedPaths) !== JSON.stringify(changedPaths)) throw new Error("HELLO_PROPOSAL_PATH_MISMATCH")

    const patchResult = await git(worktreePath, ["diff", "--binary", "--full-index", baseSha, proposalCommit, "--", ...changedPaths], {
      encoding: "buffer",
      maxBuffer: MAX_PATCH_BYTES + 1,
      errorCode: "HELLO_PROPOSAL_PATCH_FAILED",
    })
    const patchBytes = Buffer.from(patchResult.stdout)
    if (patchBytes.length === 0 || patchBytes.length > MAX_PATCH_BYTES) throw new Error("HELLO_PROPOSAL_PATCH_SIZE_REFUSED")
    const patchSha256 = crypto.createHash("sha256").update(patchBytes).digest("hex")
    const files = proposalPaths(runtime, proposalId)
    fs.mkdirSync(files.root, { recursive: true })
    fs.writeFileSync(files.patch, patchBytes, { flag: "wx" })
    const receipt = {
      schemaVersion: 1,
      proposalId,
      status: "READY_FOR_REVIEW",
      requestedBy: owner,
      createdAt: new Date().toISOString(),
      appliedAt: null,
      baseSha,
      proposalCommit,
      branch,
      changedPaths,
      patchSha256,
      threadId: required(turn?.threadId, "threadId"),
      turnId: required(turn?.turnId, "turnId"),
      model: required(turn?.model, "model"),
      validation,
    }
    atomicWriteJson(files.receipt, receipt)
    proposalPersisted = true
    return proposalForReview(receipt, files)
  } finally {
    await removeOwnedWorktree(repository, runtime, worktreePath)
    if (!proposalPersisted) {
      const head = await git(repository, ["rev-parse", "--verify", `refs/heads/${branch}`], { allowFailure: true })
      if (head.code === 0 && SHA.test(head.stdout.trim())) {
        await git(repository, ["update-ref", "-d", `refs/heads/${branch}`, head.stdout.trim()], { allowFailure: true })
      }
    }
  }
}

export async function applyHelloApplicationProposal({ repositoryRoot, runtimeRoot, proposalId, requestedBy }) {
  const repository = await verifiedRepositoryRoot(repositoryRoot)
  const owner = required(requestedBy, "requestedBy")
  const { value: proposal, files } = readProposal(runtimeRoot, required(proposalId, "proposalId"))
  if (proposal.requestedBy !== owner) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  if (proposal.status !== "READY_FOR_REVIEW") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
  assertHelloApplicationChangedPaths(proposal.changedPaths, [])
  const currentHead = (await git(repository, ["rev-parse", "--verify", "HEAD"])).stdout.trim().toLowerCase()
  if (currentHead !== proposal.baseSha) throw new Error("HELLO_PROPOSAL_STALE_BASE")
  const status = (await git(repository, ["status", "--porcelain=v1", "-z", "--", ...HELLO_APPLICATION_VALIDATION_PATHS])).stdout
  if (status) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
  const patchBytes = fs.readFileSync(files.patch)
  if (crypto.createHash("sha256").update(patchBytes).digest("hex") !== proposal.patchSha256) {
    throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH")
  }
  const patchPaths = await derivePatchPaths(repository, files.patch)
  if (JSON.stringify(patchPaths) !== JSON.stringify([...proposal.changedPaths].sort())) {
    throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  }

  await git(repository, ["apply", "--check", "--whitespace=error-all", files.patch], { errorCode: "HELLO_PROPOSAL_APPLY_CHECK_FAILED" })
  await git(repository, ["apply", "--whitespace=error-all", files.patch], { errorCode: "HELLO_PROPOSAL_APPLY_FAILED" })
  let validation
  try {
    validation = await validateHelloApplication(repository, proposal.baseSha)
  } catch (error) {
    const rollback = await git(repository, ["apply", "--reverse", files.patch], { allowFailure: true })
    const worktreeDiff = await git(repository, ["diff", "--quiet", "--", ...HELLO_APPLICATION_VALIDATION_PATHS], { allowFailure: true })
    const indexDiff = await git(repository, ["diff", "--cached", "--quiet", "--", ...HELLO_APPLICATION_VALIDATION_PATHS], { allowFailure: true })
    const untracked = (await git(repository, ["ls-files", "--others", "--exclude-standard", "--", ...HELLO_APPLICATION_VALIDATION_PATHS], { allowFailure: true })).stdout.trim()
    if (rollback.code !== 0 || worktreeDiff.code !== 0 || indexDiff.code !== 0 || untracked) {
      atomicWriteJson(files.receipt, {
        ...proposal,
        status: "QUARANTINED_ROLLBACK_FAILED",
        quarantinedAt: new Date().toISOString(),
      })
      throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED")
    }
    throw error
  }
  const updated = { ...proposal, status: "APPLIED", appliedAt: new Date().toISOString(), validation }
  atomicWriteJson(files.receipt, updated)
  return proposalForReview(updated, files)
}

export function getHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy }) {
  const read = readProposal(runtimeRoot, required(proposalId, "proposalId"))
  const proposal = read.value
  if (proposal.requestedBy !== required(requestedBy, "requestedBy")) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH")
  return proposalForReview(proposal, read.files)
}

export function listHelloApplicationProposals({ runtimeRoot, requestedBy }) {
  const owner = required(requestedBy, "requestedBy")
  const root = proposalsRoot(runtimeRoot)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".json") && PROPOSAL_ID.test(name.slice(0, -5)))
    .map((name) => getHelloApplicationProposal({ runtimeRoot, proposalId: name.slice(0, -5), requestedBy: owner }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
