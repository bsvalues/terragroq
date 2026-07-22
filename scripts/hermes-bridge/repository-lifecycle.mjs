import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const HERMES_REPOSITORY = "bsvalues/terragroq"
export const HERMES_BASE_BRANCH = "main"

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^codex\/hermes-[a-z0-9](?:[a-z0-9._-]{0,119}[a-z0-9])?$/
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,119}[a-z0-9])?$/
const SUCCESSFUL_CHECKS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])
const PENDING_CHECKS = new Set(["", "EXPECTED", "IN_PROGRESS", "PENDING", "QUEUED", "REQUESTED", "WAITING"])
const VALIDATION_EXECUTABLES = new Set(["node", "npm", "npx", "pnpm", "yarn", "bun", "cargo", "dotnet"])
const VALIDATION_ENVIRONMENT = new Set([
  "NEXT_PRIVATE_BUILD_WORKER", "NEXT_TELEMETRY_DISABLED", "WILLIAMOS_HERMES_VALIDATION_ISOLATED",
])
const CHILD_ENVIRONMENT = new Set([
  "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PATHEXT",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP",
  "USERPROFILE", "WINDIR", "SSH_AUTH_SOCK", "TMPDIR",
])
const VALIDATION_CHILD_ENVIRONMENT = new Set([
  "COMSPEC", "PATH", "PATHEXT", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "WINDIR",
])
const MAX_VALIDATION_TIMEOUT_MS = 20 * 60 * 1000
const PROHIBITED_WORD = /(^|[-_:])(deploy|production|release|tag)([-_:]|$)/i
const SECRET_LIKE = /(?:ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|password|secret)\s*[:=]\s*\S+|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s@/]*:[^@\s/]+@)/i

export class HermesRepositoryLifecycleError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}:${detail}` : code)
    this.name = "HermesRepositoryLifecycleError"
    this.code = code
  }
}

function wall(code, detail) {
  throw new HermesRepositoryLifecycleError(code, detail)
}

function absolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) wall("HERMES_REPOSITORY_PATH_WALL", field)
  return path.resolve(value)
}

function samePath(left, right) {
  return process.platform === "win32"
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right)
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function branchName(value) {
  if (typeof value !== "string" || !BRANCH.test(value) || value.includes("..") || value.endsWith(".lock")) {
    wall("HERMES_REPOSITORY_BRANCH_WALL", "codex/hermes-* required")
  }
  return value
}

function repositoryName(value) {
  if (value !== HERMES_REPOSITORY) wall("HERMES_REPOSITORY_SCOPE_WALL", "bsvalues/terragroq required")
  return value
}

function safeWorktreeName(value) {
  if (typeof value !== "string" || !SAFE_NAME.test(value) || value.includes("..")) {
    wall("HERMES_REPOSITORY_PATH_WALL", "unsafe worktree name")
  }
  return value
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    wall("HERMES_REPOSITORY_CHANGED_PATH_WALL", "unsafe changed path")
  }
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    wall("HERMES_REPOSITORY_CHANGED_PATH_WALL", "unsafe changed path")
  }
  return normalized
}

function normalizeResult(result) {
  if (!result || typeof result !== "object") wall("HERMES_REPOSITORY_RUNNER_WALL", "object result required")
  return {
    code: result.code ?? result.status ?? 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    timedOut: result.timedOut === true,
  }
}

function resolveNativeInvocation(command, args) {
  if (process.platform === "win32" && /^(?:npm|npx)$/.test(command)) {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${command}-cli.js`)
    if (fs.statSync(cli, { throwIfNoEntry: false })?.isFile()) {
      return { command: process.execPath, args: [cli, ...args] }
    }
  }
  if (process.platform !== "win32" || path.isAbsolute(command) || path.extname(command)) {
    return { command, args }
  }
  const searchPath = process.env.PATH ?? process.env.Path ?? ""
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of [".exe", ".com"]) {
      const candidate = path.join(directory, `${command}${extension}`)
      if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return { command: candidate, args }
    }
  }
  return { command, args }
}

export function createCommandRunner() {
  return ({ command, args, cwd, env, timeoutMs, credentialAccess = true }) => new Promise((resolve, reject) => {
    const invocation = resolveNativeInvocation(command, args)
    const validationHome = credentialAccess
      ? null
      : fs.mkdtempSync(path.join(
        process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? os.tmpdir(),
        "hermes-validation-",
      ))
    if (validationHome) {
      fs.mkdirSync(path.join(validationHome, "AppData", "Roaming"), { recursive: true })
      fs.mkdirSync(path.join(validationHome, "AppData", "Local"), { recursive: true })
    }
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: createCommandEnvironment(process.env, env, { credentialAccess, validationHome }),
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        if (process.platform === "win32" && Number.isInteger(child.pid)) {
          const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe")
          if (fs.statSync(taskkill, { throwIfNoEntry: false })?.isFile()) {
            const killer = spawn(taskkill, ["/pid", String(child.pid), "/T", "/F"], {
              shell: false, windowsHide: true, stdio: "ignore",
            })
            killer.on("error", () => child.kill())
          } else child.kill()
        } else {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            child.kill("SIGKILL")
          }
        }
      }, timeoutMs)
      : null
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => {
      if (timer) clearTimeout(timer)
      if (validationHome) fs.rmSync(validationHome, { recursive: true, force: true })
      reject(error)
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (validationHome) fs.rmSync(validationHome, { recursive: true, force: true })
      resolve({
        code: timedOut ? 124 : (code ?? 1), stdout,
        stderr: timedOut ? `${stderr}\nHERMES_VALIDATION_TIMEOUT`.trim() : stderr,
        timedOut,
      })
    })
  })
}

export function createCommandEnvironment(source = process.env, overrides = {}, {
  credentialAccess = true,
  validationHome,
} = {}) {
  const result = {}
  const allowed = credentialAccess ? CHILD_ENVIRONMENT : VALIDATION_CHILD_ENVIRONMENT
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) result[key] = String(value)
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && VALIDATION_ENVIRONMENT.has(key)) result[key] = String(value)
  }
  if (!credentialAccess) {
    const isolatedHome = path.resolve(validationHome ?? path.join(
      result.TEMP ?? result.TMP ?? result.TMPDIR ?? os.tmpdir(),
      "hermes-validation-home",
    ))
    result.USERPROFILE = isolatedHome
    result.HOME = isolatedHome
    result.APPDATA = path.join(isolatedHome, "AppData", "Roaming")
    result.LOCALAPPDATA = path.join(isolatedHome, "AppData", "Local")
  }
  return result
}

function assertSafeInvocation(command, args) {
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args)
    || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    wall("HERMES_REPOSITORY_COMMAND_WALL", "command and string argument array required")
  }
  const executable = path.basename(command).toLowerCase().replace(/\.(cmd|exe)$/i, "")
  if (["cmd", "powershell", "pwsh", "bash", "sh", "vercel"].includes(executable)) {
    wall("HERMES_REPOSITORY_COMMAND_WALL", `prohibited executable ${executable}`)
  }
  if (executable === "git") {
    const lowered = args.map((arg) => arg.toLowerCase())
    if (lowered.includes("--force") || lowered.includes("-f") || lowered.includes("--force-with-lease")
      || (lowered.includes("reset") && lowered.includes("--hard"))
      || lowered.includes("tag")) {
      wall("HERMES_REPOSITORY_DESTRUCTIVE_WALL", "unsafe git operation")
    }
  }
  if ((executable === "gh" && args.some((arg) => /^(release|workflow)$/i.test(arg)))
    || [command, ...args].some((arg) => PROHIBITED_WORD.test(arg) && /^(?:--)?(?:deploy|production|release|tag)$/i.test(arg))) {
    wall("HERMES_REPOSITORY_PRODUCTION_WALL", "deploy, tag, and release are prohibited")
  }
}

function parseJson(output, code) {
  try {
    return JSON.parse(output)
  } catch {
    wall(code, "invalid JSON from command")
  }
}

function remoteMatches(value) {
  const remote = value.trim().replace(/\.git$/i, "")
  return remote === "https://github.com/bsvalues/terragroq"
    || remote === "git@github.com:bsvalues/terragroq"
    || remote === "ssh://git@github.com/bsvalues/terragroq"
}

function normalizeValidation(command, index) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    wall("HERMES_REPOSITORY_VALIDATION_WALL", `validationCommands[${index}]`)
  }
  const normalized = {
    command: command.command, args: command.args ?? [], env: command.env ?? {},
    timeoutMs: command.timeoutMs ?? 10 * 60 * 1000,
  }
  assertSafeInvocation(normalized.command, normalized.args)
  const executable = path.basename(normalized.command).toLowerCase().replace(/\.(cmd|exe)$/i, "")
  if (!VALIDATION_EXECUTABLES.has(executable)) {
    wall("HERMES_REPOSITORY_VALIDATION_WALL", `validationCommands[${index}] executable is not allowed`)
  }
  if (!normalized.env || typeof normalized.env !== "object" || Array.isArray(normalized.env)
    || Object.entries(normalized.env).some(([key, value]) =>
      !VALIDATION_ENVIRONMENT.has(key) || !["0", "1"].includes(value))) {
    wall("HERMES_REPOSITORY_VALIDATION_WALL", `validationCommands[${index}] environment`)
  }
  if (!Number.isInteger(normalized.timeoutMs) || normalized.timeoutMs < 1_000
    || normalized.timeoutMs > MAX_VALIDATION_TIMEOUT_MS) {
    wall("HERMES_REPOSITORY_VALIDATION_WALL", `validationCommands[${index}] timeout`)
  }
  return Object.freeze({
    command: normalized.command,
    args: Object.freeze([...normalized.args]),
    env: Object.freeze({ ...normalized.env }),
    timeoutMs: normalized.timeoutMs,
  })
}

function statusPaths(output) {
  const fields = output.split("\0")
  const paths = []
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]
    if (!entry) continue
    if (entry.length < 4 || entry[2] !== " ") wall("HERMES_REPOSITORY_STATUS_WALL", "invalid porcelain output")
    paths.push(safeRelativePath(entry.slice(3)))
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") {
      const destination = fields[++index]
      if (!destination) wall("HERMES_REPOSITORY_STATUS_WALL", "missing rename path")
      paths.push(safeRelativePath(destination))
    }
  }
  return paths
}

function nameStatusPaths(output) {
  const fields = output.split("\0")
  const paths = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!status) continue
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) wall("HERMES_REPOSITORY_STATUS_WALL", "invalid name-status output")
    const source = fields[index++]
    if (!source) wall("HERMES_REPOSITORY_STATUS_WALL", "missing changed path")
    paths.push(safeRelativePath(source))
    if (/^[RC]/.test(status)) {
      const destination = fields[index++]
      if (!destination) wall("HERMES_REPOSITORY_STATUS_WALL", "missing rename destination")
      paths.push(safeRelativePath(destination))
    }
  }
  return paths
}

function worktreeEntries(output) {
  return output.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/)
    return {
      worktreePath: lines.find((line) => line.startsWith("worktree "))?.slice(9) ?? null,
      branch: lines.find((line) => line.startsWith("branch refs/heads/"))?.slice(18) ?? null,
    }
  })
}

function checkState(check) {
  return String(check?.conclusion ?? check?.state ?? check?.status ?? "").toUpperCase()
}

function checkName(check) {
  return String(check?.name ?? check?.context ?? "")
}

function exactHeadApprovedReview(pr) {
  return Array.isArray(pr?.reviews) && pr.reviews.some((review) =>
    review?.author?.login && review.author.login !== "bsvalues"
    && review?.commit?.oid === pr.headRefOid
    && String(review?.state ?? "").toUpperCase() === "APPROVED")
}

function exactHeadCodexRequestTimes(value, headRefOid) {
  const connection = value?.data?.repository?.pullRequest?.comments
  const comments = connection?.nodes
  if (!Array.isArray(comments)) wall("HERMES_REPOSITORY_GITHUB_WALL", "review request comments missing")
  if (connection?.pageInfo?.hasPreviousPage === true || connection?.pageInfo?.hasNextPage === true) {
    wall("HERMES_REPOSITORY_GITHUB_WALL", "review request comments are incomplete")
  }
  return comments.filter((comment) => {
    const createdAt = Date.parse(comment?.createdAt ?? "")
    const updatedAt = Date.parse(comment?.updatedAt ?? "")
    return Number.isFinite(createdAt) && createdAt === updatedAt
      && comment?.author?.login === "bsvalues"
      && /@codex\s+review/i.test(String(comment?.body ?? ""))
      && [...String(comment?.body ?? "").matchAll(/\b[0-9a-f]{40}\b/gi)]
        .some((match) => match[0].toLowerCase() === headRefOid)
  }).map((comment) => Date.parse(comment.createdAt))
}

function exactHeadCodexReviews(pr) {
  if (!Array.isArray(pr?.reviews)) return []
  return pr.reviews.filter((review) => {
    const body = String(review?.body ?? "")
    const digest = body.match(/\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/i)?.[1]?.toLowerCase()
    return review?.author?.login === "chatgpt-codex-connector"
      && review?.commit?.oid === pr.headRefOid
      && ["COMMENTED", "APPROVED"].includes(String(review?.state ?? "").toUpperCase())
      && typeof digest === "string" && pr.headRefOid.startsWith(digest)
  })
}

function exactHeadCodexReviewFindings(pr) {
  return exactHeadCodexReviews(pr).flatMap((review) => {
    if (String(review.state).toUpperCase() !== "COMMENTED") return []
    const summary = String(review.body ?? "")
      .replace(/<details>[\s\S]*$/i, "")
      .replace(/^\s*###\s*[^\r\n]*Codex Review[^\r\n]*\r?\n?/i, "")
      .replace(/^\s*Here are some automated review suggestions for this pull request\.\s*$/gim, "")
      .replace(/^\s*\*\*Reviewed commit:\*\*\s*`[0-9a-f]{10,40}`\s*$/gim, "")
      .trim()
    if (!summary || summary.startsWith("Codex Review: Didn't find any major issues.")) return []
    if (SECRET_LIKE.test(summary)) wall("HERMES_REPOSITORY_REVIEW_WALL", "secret-like review text refused")
    return [summary.slice(0, 4_000)]
  })
}

function exactHeadCodexCleanComment(value, headRefOid, requestTimes = exactHeadCodexRequestTimes(value, headRefOid)) {
  const comments = value.data.repository.pullRequest.comments.nodes
  return comments.some((comment) => {
    const body = String(comment?.body ?? "")
    const createdAt = Date.parse(comment?.createdAt ?? "")
    const updatedAt = Date.parse(comment?.updatedAt ?? "")
    const immutableRequest = Number.isFinite(createdAt) && createdAt === updatedAt
    const reviewedDigest = body.match(/\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/i)?.[1]?.toLowerCase()
    return immutableRequest
      && comment?.author?.login === "chatgpt-codex-connector"
      && body.startsWith("Codex Review: Didn't find any major issues.")
      && typeof reviewedDigest === "string"
      && headRefOid.startsWith(reviewedDigest)
      && requestTimes.some((requestTime) => requestTime <= createdAt)
  })
}

function unresolvedThreadCount(value) {
  const reviewThreads = value?.data?.repository?.pullRequest?.reviewThreads
  const nodes = reviewThreads?.nodes
  if (!Array.isArray(nodes)) wall("HERMES_REPOSITORY_GITHUB_WALL", "review thread response missing")
  if (reviewThreads?.pageInfo?.hasNextPage === true) {
    wall("HERMES_REPOSITORY_GITHUB_WALL", "review thread result is incomplete")
  }
  return nodes.filter((thread) => !thread.isResolved && Array.isArray(thread?.comments?.nodes)
    && thread.comments.nodes.some((comment) => !comment.isMinimized && String(comment.body ?? "").trim().length > 0)).length
}

export function createRepositoryLifecycle(options) {
  if (!options || typeof options !== "object") wall("HERMES_REPOSITORY_CONFIG_WALL", "options required")
  const repository = repositoryName(options.repository ?? HERMES_REPOSITORY)
  const workspaceRoot = absolute(options.workspaceRoot, "workspaceRoot")
  const repositoryRoot = absolute(options.repositoryRoot ?? workspaceRoot, "repositoryRoot")
  if (!samePath(workspaceRoot, repositoryRoot)) wall("HERMES_REPOSITORY_SCOPE_WALL", "repository root must equal workspace root")
  const ownedWorktreeRoot = absolute(options.ownedWorktreeRoot, "ownedWorktreeRoot")
  if (samePath(ownedWorktreeRoot, workspaceRoot) || inside(workspaceRoot, ownedWorktreeRoot)) {
    wall("HERMES_REPOSITORY_PATH_WALL", "owned worktree root must be outside workspace root")
  }
  const runner = options.runner ?? createCommandRunner()
  if (typeof runner !== "function") wall("HERMES_REPOSITORY_CONFIG_WALL", "runner function required")
  const validationCommands = (options.validationCommands ?? []).map(normalizeValidation)
  const records = new Map()

  async function run(command, args, {
    cwd = workspaceRoot, allowFailure = false, env = {}, timeoutMs, credentialAccess = true,
  } = {}) {
    assertSafeInvocation(command, args)
    let result
    try {
      const invocation = { command, args: [...args], cwd }
      if (Object.keys(env).length > 0) invocation.env = { ...env }
      if (timeoutMs !== undefined) invocation.timeoutMs = timeoutMs
      if (!credentialAccess) invocation.credentialAccess = false
      result = normalizeResult(await runner(invocation))
    } catch {
      wall("HERMES_REPOSITORY_RUNNER_WALL", `${path.basename(command)} failed to start`)
    }
    if (!allowFailure && result.code !== 0) {
      wall("HERMES_REPOSITORY_COMMAND_FAILED", `${path.basename(command)} exited ${result.code}`)
    }
    return result
  }

  async function verifyOrigin() {
    const result = await run("git", ["-C", repositoryRoot, "remote", "get-url", "origin"])
    if (!remoteMatches(result.stdout)) wall("HERMES_REPOSITORY_ORIGIN_WALL", "origin must be bsvalues/terragroq")
    return true
  }

  function ownedRecord(worktreePath, branch) {
    const record = records.get(branch)
    if (!record || !samePath(record.worktreePath, worktreePath) || !inside(ownedWorktreeRoot, worktreePath)) {
      wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "recorded owned worktree and branch required")
    }
    return record
  }

  async function refreshOriginMain() {
    await verifyOrigin()
    await run("git", ["-C", repositoryRoot, "fetch", "--no-tags", "--prune", "origin", HERMES_BASE_BRANCH])
    const result = await run("git", ["-C", repositoryRoot, "rev-parse", "refs/remotes/origin/main"])
    const sha = result.stdout.trim()
    if (!SHA.test(sha)) wall("HERMES_REPOSITORY_GIT_WALL", "origin/main SHA required")
    return sha
  }

  async function createWorktree({ branch, name } = {}) {
    const safeBranch = branchName(branch)
    const existing = records.get(safeBranch)
    if (existing) return { ...existing }
    await verifyOrigin()
    const leaf = safeWorktreeName(name ?? safeBranch.slice("codex/".length))
    const worktreePath = path.resolve(ownedWorktreeRoot, leaf)
    if (!inside(ownedWorktreeRoot, worktreePath)) wall("HERMES_REPOSITORY_PATH_WALL", "worktree outside owned root")
    const branchResult = await run("git", ["-C", repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${safeBranch}`], { allowFailure: true })
    if (![0, 1].includes(branchResult.code)) wall("HERMES_REPOSITORY_COMMAND_FAILED", "git show-ref failed")
    if (branchResult.code === 0) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "pre-existing branch is not owned")
    await run("git", ["-C", repositoryRoot, "worktree", "add", "-b", safeBranch, worktreePath, "refs/remotes/origin/main"])
    const record = Object.freeze({ repository, branch: safeBranch, worktreePath, ownedWorktreeRoot, cleaned: false })
    records.set(safeBranch, record)
    return { ...record }
  }

  async function ensureOwnedWorktree({ branch, name, worktreePath } = {}) {
    const safeBranch = branchName(branch)
    const leaf = safeWorktreeName(name ?? safeBranch.slice("codex/".length))
    const intendedPath = absolute(worktreePath, "worktreePath")
    const computedPath = path.resolve(ownedWorktreeRoot, leaf)
    if (!samePath(intendedPath, computedPath) || !inside(ownedWorktreeRoot, intendedPath)) {
      wall("HERMES_REPOSITORY_PATH_WALL", "persisted worktree intent mismatch")
    }
    const existing = records.get(safeBranch)
    if (existing) {
      if (!samePath(existing.worktreePath, intendedPath)) {
        wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "in-memory worktree record does not match persisted intent")
      }
      return { ...existing }
    }
    await verifyOrigin()
    const listing = await run("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"])
    const entries = worktreeEntries(listing.stdout)
    const byPath = entries.find((entry) => entry.worktreePath && samePath(entry.worktreePath, intendedPath))
    const byBranch = entries.find((entry) => entry.branch === safeBranch)
    if (byPath || byBranch) {
      if (byPath !== byBranch) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "worktree intent conflicts with registered git state")
      const currentBranch = await run("git", ["-C", intendedPath, "branch", "--show-current"])
      if (currentBranch.stdout.trim() !== safeBranch) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "worktree branch mismatch")
      const record = Object.freeze({ repository, branch: safeBranch, worktreePath: intendedPath, ownedWorktreeRoot, cleaned: false })
      records.set(safeBranch, record)
      return { ...record, resumed: true }
    }
    const branchResult = await run("git", ["-C", repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${safeBranch}`], { allowFailure: true })
    if (![0, 1].includes(branchResult.code)) wall("HERMES_REPOSITORY_COMMAND_FAILED", "git show-ref failed")
    if (branchResult.code === 0) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "persisted branch is not registered to its intended worktree")
    await run("git", ["-C", repositoryRoot, "worktree", "add", "-b", safeBranch, intendedPath, "refs/remotes/origin/main"])
    const record = Object.freeze({ repository, branch: safeBranch, worktreePath: intendedPath, ownedWorktreeRoot, cleaned: false })
    records.set(safeBranch, record)
    return { ...record, resumed: false }
  }

  async function resumeOwnedWorktree({ branch, worktreePath } = {}) {
    const safeBranch = branchName(branch)
    const absoluteWorktree = absolute(worktreePath, "worktreePath")
    const expectedWorktree = path.resolve(ownedWorktreeRoot, safeBranch.slice("codex/".length))
    if (!samePath(absoluteWorktree, expectedWorktree)) {
      wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "cleanup path does not match the owned branch")
    }
    if (!inside(ownedWorktreeRoot, absoluteWorktree)) wall("HERMES_REPOSITORY_PATH_WALL", "worktree outside owned root")
    await verifyOrigin()
    const listing = await run("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"])
    const entries = worktreeEntries(listing.stdout)
    const byPath = entries.find((entry) => entry.worktreePath && samePath(entry.worktreePath, absoluteWorktree))
    const byBranch = entries.find((entry) => entry.branch === safeBranch)
    if (!byPath || byPath !== byBranch) {
      wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "persisted worktree is not registered to the expected branch")
    }
    const currentBranch = await run("git", ["-C", absoluteWorktree, "branch", "--show-current"])
    if (currentBranch.stdout.trim() !== safeBranch) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "worktree branch mismatch")
    const record = Object.freeze({ repository, branch: safeBranch, worktreePath: absoluteWorktree, ownedWorktreeRoot, cleaned: false })
    records.set(safeBranch, record)
    return { ...record, resumed: true }
  }

  async function inspectChangedPaths({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const status = await run("git", ["-C", record.worktreePath, "status", "--porcelain=v1", "-z", "--untracked-files=all"])
    const diff = await run("git", ["-C", record.worktreePath, "diff", "--name-status", "-z", "--find-renames", "refs/remotes/origin/main...HEAD"])
    return [...new Set([...statusPaths(status.stdout), ...nameStatusPaths(diff.stdout)])].sort()
  }

  async function inspectWorkingTreePaths({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const status = await run("git", ["-C", record.worktreePath, "status", "--porcelain=v1", "-z", "--untracked-files=all"])
    return [...new Set(statusPaths(status.stdout))].sort()
  }

  async function inspectWorktreeHead({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const result = await run("git", ["-C", record.worktreePath, "rev-parse", "HEAD"])
    const headRefOid = result.stdout.trim()
    if (!SHA.test(headRefOid)) wall("HERMES_REPOSITORY_GIT_WALL", "40-character worktree head required")
    return headRefOid
  }

  function ensureValidationDependencies({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const source = path.join(workspaceRoot, "node_modules")
    const target = path.join(record.worktreePath, "node_modules")
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
      wall("HERMES_REPOSITORY_VALIDATION_WALL", "workspace dependencies are unavailable")
    }
    const targetStat = fs.lstatSync(target, { throwIfNoEntry: false })
    if (targetStat) {
      if (!targetStat.isSymbolicLink() || !samePath(fs.realpathSync(target), source)) {
        wall("HERMES_REPOSITORY_VALIDATION_WALL", "worktree dependency path is not the owned workspace junction")
      }
      return { linked: true, existing: true }
    }
    fs.symlinkSync(source, target, "junction")
    return { linked: true, existing: false }
  }

  function removeValidationDependencies({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const dependencies = path.join(record.worktreePath, "node_modules")
    const dependencyStat = fs.lstatSync(dependencies, { throwIfNoEntry: false })
    if (!dependencyStat) return { removed: false }
    const source = path.join(workspaceRoot, "node_modules")
    if (!dependencyStat.isSymbolicLink() || !samePath(fs.realpathSync(dependencies), source)) {
      wall("HERMES_REPOSITORY_CLEANUP_WALL", "validation dependency path is not the owned junction")
    }
    fs.unlinkSync(dependencies)
    return { removed: true }
  }

  function removeGeneratedNextOutput(record) {
    const nextOutput = path.join(record.worktreePath, ".next")
    const nextStat = fs.lstatSync(nextOutput, { throwIfNoEntry: false })
    if (!nextStat) return { removed: false }
    if (!nextStat.isDirectory() || nextStat.isSymbolicLink()) {
      wall("HERMES_REPOSITORY_CLEANUP_WALL", "generated Next output is not an owned directory")
    }
    fs.rmSync(nextOutput, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
    return { removed: true }
  }

  function removeValidationArtifacts(record) {
    removeValidationDependencies(record)
    removeGeneratedNextOutput(record)
  }

  async function runValidationCommands({ worktreePath, branch, commands = validationCommands } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const normalized = commands === validationCommands ? validationCommands : commands.map(normalizeValidation)
    if (normalized.length === 0) wall("HERMES_REPOSITORY_VALIDATION_WALL", "at least one validation command required")
    const results = []
    for (const command of normalized) {
      const executable = path.basename(command.command).replace(/\.(?:cmd|exe)$/i, "")
      if (executable === "npm" && command.args[0] === "run" && command.args[1] === "build") {
        removeGeneratedNextOutput(record)
      }
      const validationEnvironment = {
        ...command.env,
        WILLIAMOS_HERMES_VALIDATION_ISOLATED: "1",
      }
      const result = await run(command.command, command.args, {
        cwd: record.worktreePath, env: validationEnvironment,
        timeoutMs: command.timeoutMs, allowFailure: true,
        credentialAccess: false,
      })
      if (result.code !== 0) {
        const output = `${result.stdout}\n${result.stderr}`.trim().slice(-4_000)
        if (SECRET_LIKE.test(output)) wall("HERMES_REPOSITORY_SECRET_WALL", "validation output refused")
        const error = new HermesRepositoryLifecycleError(
          "HERMES_VALIDATION_FAILED", `${path.basename(command.command)} exited ${result.code}`,
        )
        error.validation = {
          command: command.command, args: [...command.args], code: result.code,
          timedOut: result.timedOut,
          output: output || "Validator exited without output.",
        }
        throw error
      }
      results.push({ command: command.command, args: [...command.args], code: result.code })
    }
    return results
  }

  async function commitChanges({ worktreePath, branch, paths, message } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    if (!Array.isArray(paths) || paths.length === 0) wall("HERMES_REPOSITORY_COMMIT_WALL", "changed paths required")
    const normalizedPaths = [...new Set(paths.map(safeRelativePath))].sort()
    const workingPaths = await inspectWorkingTreePaths(record)
    if (JSON.stringify(normalizedPaths) !== JSON.stringify(workingPaths)) {
      wall("HERMES_REPOSITORY_COMMIT_WALL", "commit paths must exactly match the owned working tree")
    }
    if (typeof message !== "string" || !message.trim() || SECRET_LIKE.test(message)
      || /\b(?:deploy|production|release|tag)\b/i.test(message)) {
      wall("HERMES_REPOSITORY_COMMIT_WALL", "safe commit message required")
    }
    await run("git", ["-C", record.worktreePath, "add", "--", ...normalizedPaths])
    await run("git", ["-C", record.worktreePath, "diff", "--cached", "--check"])
    const staged = await run("git", ["-C", record.worktreePath, "diff", "--cached", "--quiet"], { allowFailure: true })
    if (staged.code !== 1) wall("HERMES_REPOSITORY_COMMIT_WALL", "nonempty staged diff required")
    await run("git", ["-C", record.worktreePath, "commit", "-m", message.trim()])
    const head = await run("git", ["-C", record.worktreePath, "rev-parse", "HEAD"])
    const commit = head.stdout.trim()
    if (!SHA.test(commit)) wall("HERMES_REPOSITORY_COMMIT_WALL", "40-character commit required")
    return { branch: record.branch, commit, paths: normalizedPaths }
  }

  async function discoverPullRequest(branch) {
    const safeBranch = branchName(branch)
    await verifyOrigin()
    const result = await run("gh", ["pr", "list", "--repo", repository, "--head", safeBranch, "--state", "all", "--json", "number,headRefName,state,url,mergeCommit", "--limit", "100"])
    const values = parseJson(result.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    if (!Array.isArray(values)) wall("HERMES_REPOSITORY_GITHUB_WALL", "PR list array required")
    const matches = values.filter((value) => value?.headRefName === safeBranch)
    if (matches.length > 1) wall("HERMES_REPOSITORY_GITHUB_WALL", "multiple exact-head pull requests")
    return matches[0] ?? null
  }

  async function inspectPullRequest(number) {
    if (!Number.isSafeInteger(number) || number <= 0) wall("HERMES_REPOSITORY_GITHUB_WALL", "positive PR number required")
    await verifyOrigin()
    const prResult = await run("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,headRefName,headRefOid,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,reviews,mergeCommit,url"])
    const pr = parseJson(prResult.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    branchName(pr.headRefName)
    if (!SHA.test(pr.headRefOid ?? "")) wall("HERMES_REPOSITORY_GITHUB_WALL", "PR head SHA required")
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved comments(first:20){nodes{body isMinimized}}} pageInfo{hasNextPage}} comments(last:100){nodes{author{login} body createdAt updatedAt} pageInfo{hasPreviousPage hasNextPage}}}}}"
    const threadResult = await run("gh", ["api", "graphql", "-f", `query=${query}`, "-F", "owner=bsvalues", "-F", "name=terragroq", "-F", `number=${number}`])
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
    const reviewState = parseJson(threadResult.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    const unresolved = unresolvedThreadCount(reviewState)
    const requestTimes = exactHeadCodexRequestTimes(reviewState, pr.headRefOid)
    const hasExactHeadCodexCleanComment = exactHeadCodexCleanComment(reviewState, pr.headRefOid, requestTimes)
    const hasExactHeadApproval = exactHeadApprovedReview(pr)
    const exactHeadCodexReviewsForCommit = exactHeadCodexReviews(pr)
    const codexReviewFindings = exactHeadCodexReviewFindings(pr)
    const hasExactHeadCodexCompletedReview = exactHeadCodexReviewsForCommit.length > 0
    const hasExactHeadCodexCleanReview = codexReviewFindings.length === 0
      && exactHeadCodexReviewsForCommit.some((review) =>
        String(review.state).toUpperCase() === "APPROVED"
          || String(review.state).toUpperCase() === "COMMENTED")
    const rateLimitedCodeRabbitContexts = new Set()
    if (checks.some((check) => /coderabbit/i.test(checkName(check)))) {
      const statusResult = await run("gh", ["api", `repos/${repository}/commits/${pr.headRefOid}/status`])
      const status = parseJson(statusResult.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
      if (Array.isArray(status?.statuses)) {
        for (const entry of status.statuses) {
          const context = String(entry?.context ?? "")
          if (/coderabbit/i.test(context)
            && String(entry?.description ?? "").trim().toLowerCase() === "review rate limited") {
            rateLimitedCodeRabbitContexts.add(context.toLowerCase())
          }
        }
      }
    }
    const codeRabbitRateLimited = rateLimitedCodeRabbitContexts.size > 0
    const hasExactHeadReview = hasExactHeadApproval || hasExactHeadCodexCleanComment
      || (hasExactHeadCodexCleanReview && unresolved === 0 && codexReviewFindings.length === 0)
    const hasCodeRabbitReview = checks.some((check) =>
      /coderabbit/i.test(checkName(check)) && checkState(check) === "SUCCESS"
        && !rateLimitedCodeRabbitContexts.has(checkName(check).toLowerCase()))
    const effectiveCheckState = (check) => {
      const rateLimited = rateLimitedCodeRabbitContexts.has(checkName(check).toLowerCase())
      if (rateLimited) return hasExactHeadReview ? "SUCCESS" : "PENDING"
      return checkState(check)
    }
    const failedChecks = checks.flatMap((check) => {
      const state = effectiveCheckState(check)
      if (SUCCESSFUL_CHECKS.has(state) || PENDING_CHECKS.has(state)) return []
      const name = checkName(check).trim() || "Unnamed check"
      if (SECRET_LIKE.test(name)) wall("HERMES_REPOSITORY_SECRET_WALL", "secret-like check name refused")
      return [{ name: name.slice(0, 200), state: state.slice(0, 80) }]
    })
    return {
      ...pr,
      checksGreen: checks.length > 0 && checks.every((check) => SUCCESSFUL_CHECKS.has(effectiveCheckState(check))),
      checksComplete: checks.length > 0 && checks.every((check) => !PENDING_CHECKS.has(effectiveCheckState(check))),
      failedChecks,
      codexReviewFindings,
      cleanReviewEvidence: hasExactHeadApproval || hasExactHeadCodexCleanComment
        || hasExactHeadCodexCleanReview || hasCodeRabbitReview,
      reviewed: hasExactHeadReview || hasCodeRabbitReview,
      reviewCompleted: hasExactHeadApproval || hasExactHeadCodexCleanComment
        || hasExactHeadCodexCompletedReview || hasCodeRabbitReview,
      codeRabbitRateLimited,
      reviewRequested: requestTimes.length > 0,
      unresolvedThreadCount: unresolved,
    }
  }

  async function inspectPullRequestFiles(number) {
    if (!Number.isSafeInteger(number) || number <= 0) wall("HERMES_REPOSITORY_GITHUB_WALL", "positive PR number required")
    await verifyOrigin()
    const result = await run("gh", ["api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/files?per_page=100`])
    const pages = parseJson(result.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      wall("HERMES_REPOSITORY_GITHUB_WALL", "pull request files response missing")
    }
    const files = [...new Set(pages.flatMap((page) => page.flatMap((file) =>
      [file?.filename, file?.previous_filename].filter(Boolean).map(safeRelativePath))))].sort()
    if (files.length === 0) wall("HERMES_REPOSITORY_GITHUB_WALL", "pull request file list is empty")
    return files
  }

  async function pushBranch({ worktreePath, branch } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    await verifyOrigin()
    await run("git", ["-C", record.worktreePath, "push", "--set-upstream", "origin", `refs/heads/${record.branch}:refs/heads/${record.branch}`])
    return { branch: record.branch, pushed: true }
  }

  async function createPullRequest({ branch, title, body } = {}) {
    const safeBranch = branchName(branch)
    if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()
      || SECRET_LIKE.test(title) || SECRET_LIKE.test(body)) wall("HERMES_REPOSITORY_PR_WALL", "safe title and body required")
    const existing = await discoverPullRequest(safeBranch)
    if (existing && existing.state === "OPEN") return { ...existing, created: false }
    if (existing) wall("HERMES_REPOSITORY_PR_WALL", "exact-head pull request is not open")
    const result = await run("gh", ["pr", "create", "--repo", repository, "--head", safeBranch, "--base", HERMES_BASE_BRANCH, "--title", title, "--body", body])
    return { branch: safeBranch, url: result.stdout.trim(), created: true }
  }

  async function inspectReviewFindings(number) {
    if (!Number.isSafeInteger(number) || number <= 0) wall("HERMES_REPOSITORY_GITHUB_WALL", "positive PR number required")
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(last:100){nodes{body isMinimized} pageInfo{hasPreviousPage}}} pageInfo{hasNextPage}}}}}"
    const result = await run("gh", ["api", "graphql", "-f", `query=${query}`, "-F", "owner=bsvalues", "-F", "name=terragroq", "-F", `number=${number}`])
    const value = parseJson(result.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    const threads = value?.data?.repository?.pullRequest?.reviewThreads
    if (!Array.isArray(threads?.nodes) || threads?.pageInfo?.hasNextPage === true) {
      wall("HERMES_REPOSITORY_GITHUB_WALL", "review findings are incomplete")
    }
    return threads.nodes.filter((thread) => !thread.isResolved).flatMap((thread) => {
      if (thread?.comments?.pageInfo?.hasPreviousPage === true) {
        wall("HERMES_REPOSITORY_GITHUB_WALL", "review finding comments are incomplete")
      }
      const activeComments = thread?.comments?.nodes?.filter((entry) =>
        !entry?.isMinimized && String(entry?.body ?? "").trim()) ?? []
      const comment = activeComments.at(-1)
      if (!comment) return []
      const body = String(comment.body).trim()
      if (SECRET_LIKE.test(body)) wall("HERMES_REPOSITORY_REVIEW_WALL", "secret-like review text refused")
      return [{
        threadId: String(thread.id),
        isOutdated: thread.isOutdated === true,
        path: safeRelativePath(String(thread.path)),
        line: Number.isSafeInteger(thread.line) && thread.line > 0 ? thread.line : null,
        body: body.slice(0, 4_000),
      }]
    })
  }

  async function resolveReviewThreads(threadIds = []) {
    if (!Array.isArray(threadIds) || threadIds.length === 0
      || threadIds.some((id) => typeof id !== "string" || !/^PRRT_[A-Za-z0-9_-]+$/.test(id))) {
      wall("HERMES_REPOSITORY_REVIEW_WALL", "review thread ids required")
    }
    const mutation = "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}"
    for (const threadId of [...new Set(threadIds)]) {
      const result = await run("gh", ["api", "graphql", "-f", `query=${mutation}`, "-F", `threadId=${threadId}`])
      const value = parseJson(result.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
      if (value?.data?.resolveReviewThread?.thread?.isResolved !== true) {
        wall("HERMES_REPOSITORY_REVIEW_WALL", "review thread did not resolve")
      }
    }
    return { resolved: [...new Set(threadIds)].length }
  }

  async function requestCodexReview({ number, headRefOid } = {}) {
    if (!Number.isSafeInteger(number) || number <= 0 || !SHA.test(headRefOid ?? "")) {
      wall("HERMES_REPOSITORY_REVIEW_WALL", "PR number and exact head required")
    }
    await run("gh", ["pr", "comment", String(number), "--repo", repository, "--body",
      `@codex review Exact-head review requested for ${headRefOid}.`])
    return { number, headRefOid, requested: true }
  }

  async function mergePullRequest({ number, branch } = {}) {
    const safeBranch = branchName(branch)
    const pr = await inspectPullRequest(number)
    if (pr.headRefName !== safeBranch || pr.baseRefName !== HERMES_BASE_BRANCH
      || pr.state !== "OPEN" || pr.isDraft || !pr.checksGreen
      || !pr.reviewed || pr.unresolvedThreadCount !== 0 || !SHA.test(pr.headRefOid ?? "")) {
      wall("HERMES_REPOSITORY_MERGE_GATE_WALL", "green checks, approval, and zero unresolved threads required")
    }
    await run("gh", ["pr", "merge", String(number), "--repo", repository, "--squash", "--delete-branch=false", "--match-head-commit", pr.headRefOid])
    return { number, branch: safeBranch, merged: true, headRefOid: pr.headRefOid }
  }

  async function verifyOriginMainContains(commitSha) {
    if (!SHA.test(commitSha)) wall("HERMES_REPOSITORY_GIT_WALL", "40-character merge SHA required")
    await refreshOriginMain()
    const result = await run("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", commitSha, "refs/remotes/origin/main"], { allowFailure: true })
    if (![0, 1].includes(result.code)) wall("HERMES_REPOSITORY_COMMAND_FAILED", "git merge-base failed")
    return result.code === 0
  }

  async function cleanupOwnedWorktree({ worktreePath, branch, mergeCommitSha, expectedHeadSha } = {}) {
    const safeBranch = branchName(branch)
    const absoluteWorktree = absolute(worktreePath, "worktreePath")
    const expectedWorktree = path.resolve(ownedWorktreeRoot, safeBranch.slice("codex/".length))
    if (!samePath(absoluteWorktree, expectedWorktree)) {
      wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "cleanup path does not match the owned branch")
    }
    let record = records.get(safeBranch)
    if (record?.cleaned) return { branch: safeBranch, worktreePath: absoluteWorktree, cleaned: true, alreadyCleaned: true }
    if (!inside(ownedWorktreeRoot, absoluteWorktree)) wall("HERMES_REPOSITORY_PATH_WALL", "worktree outside owned root")
    if (!SHA.test(expectedHeadSha ?? "")) wall("HERMES_REPOSITORY_CLEANUP_WALL", "reviewed head SHA required")
    if (!await verifyOriginMainContains(mergeCommitSha)) wall("HERMES_REPOSITORY_CLEANUP_WALL", "merge not present on origin/main")
    if (!record) {
      const listing = await run("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"])
      const entries = worktreeEntries(listing.stdout)
      const byPath = entries.find((entry) => entry.worktreePath && samePath(entry.worktreePath, absoluteWorktree))
      const byBranch = entries.find((entry) => entry.branch === safeBranch)
      if (byPath || byBranch) {
        if (byPath !== byBranch) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "cleanup intent conflicts with registered git state")
        record = Object.freeze({ repository, branch: safeBranch, worktreePath: absoluteWorktree, ownedWorktreeRoot, cleaned: false })
        records.set(safeBranch, record)
      } else {
        const branchResult = await run("git", ["-C", repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${safeBranch}`], { allowFailure: true })
        if (![0, 1].includes(branchResult.code)) wall("HERMES_REPOSITORY_COMMAND_FAILED", "git show-ref failed")
        if (branchResult.code === 0) {
          const branchHead = await run("git", ["-C", repositoryRoot, "rev-parse", `refs/heads/${safeBranch}`])
          if (branchHead.stdout.trim() !== expectedHeadSha) wall("HERMES_REPOSITORY_OWNERSHIP_WALL", "cleanup branch head mismatch")
          await run("git", ["-C", repositoryRoot, "update-ref", "-d", `refs/heads/${safeBranch}`, expectedHeadSha])
        }
        records.set(safeBranch, Object.freeze({ repository, branch: safeBranch, worktreePath: absoluteWorktree, ownedWorktreeRoot, cleaned: true }))
        return { branch: safeBranch, worktreePath: absoluteWorktree, cleaned: true, alreadyCleaned: true }
      }
    }
    ownedRecord(absoluteWorktree, safeBranch)
    removeValidationArtifacts(record)
    const status = await run("git", ["-C", absoluteWorktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"])
    if (status.stdout.length > 0) wall("HERMES_REPOSITORY_CLEANUP_WALL", "owned worktree is dirty")
    await run("git", ["-C", repositoryRoot, "worktree", "remove", absoluteWorktree])
    await run("git", ["-C", repositoryRoot, "update-ref", "-d", `refs/heads/${safeBranch}`, expectedHeadSha])
    records.set(safeBranch, Object.freeze({ ...record, cleaned: true }))
    return { branch: safeBranch, worktreePath: absoluteWorktree, cleaned: true, alreadyCleaned: false }
  }

  return Object.freeze({
    repository,
    workspaceRoot,
    repositoryRoot,
    ownedWorktreeRoot,
    refreshOriginMain,
    createWorktree,
    ensureOwnedWorktree,
    resumeOwnedWorktree,
    inspectChangedPaths,
    inspectWorkingTreePaths,
    inspectWorktreeHead,
    ensureValidationDependencies,
    removeValidationDependencies,
    runValidationCommands,
    commitChanges,
    discoverPullRequest,
    inspectPullRequest,
    inspectPullRequestFiles,
    inspectReviewFindings,
    resolveReviewThreads,
    pushBranch,
    createPullRequest,
    requestCodexReview,
    mergePullRequest,
    verifyOriginMainContains,
    cleanupOwnedWorktree,
  })
}

export const createHermesRepositoryLifecycle = createRepositoryLifecycle
