import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"

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
  if (!Array.isArray(paths) || paths.length < 2) throw new Error("HELLO_PROPOSAL_MULTI_FILE_REQUIRED")
  if (paths.length > HELLO_APPLICATION_ALLOWED_PATHS.length) throw new Error("HELLO_PROPOSAL_PATH_LIMIT")
  const allowed = new Set(HELLO_APPLICATION_ALLOWED_PATHS)
  for (const changedPath of paths) {
    if (!allowed.has(changedPath)) throw new Error(`HELLO_PROPOSAL_PATH_REFUSED:${changedPath}`)
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

async function validateHelloApplication(repositoryRoot) {
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

function governedPrompt() {
  return [
    "Implement one bounded Hello Application improvement for WO-HELLO-HERMES-001.",
    "Add a small visible 'Governed by HERMES' build marker to the existing HERMES status area, style it, and have app.js update that marker after a pulse.",
    "Preserve all existing ids, text, health behavior, Send pulse behavior, and tests.",
    `Modify at least two of these existing files and no others: ${HELLO_APPLICATION_ALLOWED_PATHS.join(", ")}.`,
    "Do not create files, change tests, change the server, install dependencies, commit, push, or use network access.",
    "Run: node --test examples/hello-application/test/hello.test.mjs",
    "Report validation truthfully in the required final object.",
  ].join("\n")
}

async function runResidentTurn({ repositoryRoot, runtimeRoot, workspacePath }) {
  const backend = new ResidentModelExecutionBackend({ repositoryRoot, runtimeRoot })
  const client = await backend.runCodexClient({ workspacePath, timeoutMs: TURN_TIMEOUT_MS })
  try {
    await client.connect()
    const threadId = await client.startThread()
    const turn = await client.runTurn({ threadId, prompt: governedPrompt(), timeoutMs: TURN_TIMEOUT_MS })
    const sessionPath = path.join(runtimeRoot, "hermes-kernel", "threads", threadId, "session.json")
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"))
    const record = session.turns?.find((candidate) => candidate.turnId === turn.turnId)
    const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), "utf8"))
    return {
      threadId,
      turnId: turn.turnId,
      model: policy.model.id,
      ignoredPathsCreated: record?.ignoredPathsCreated,
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
    const status = (await git(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout
    const changedPaths = parseChangedPaths(status)
    assertHelloApplicationChangedPaths(changedPaths, turn?.ignoredPathsCreated)
    await git(worktreePath, ["diff", "--check", "--", ...changedPaths], { errorCode: "HELLO_PROPOSAL_DIFF_INVALID" })
    const validation = await validateHelloApplication(worktreePath)

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
    validation = await validateHelloApplication(repository)
  } catch (error) {
    const rollback = await git(repository, ["apply", "--reverse", files.patch], { allowFailure: true })
    const rollbackStatus = (await git(repository, ["status", "--porcelain=v1", "-z", "--", ...HELLO_APPLICATION_VALIDATION_PATHS], { allowFailure: true })).stdout
    if (rollback.code !== 0 || rollbackStatus) {
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
