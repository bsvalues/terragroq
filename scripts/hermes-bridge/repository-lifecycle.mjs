import { spawn } from "node:child_process"
import path from "node:path"

export const HERMES_REPOSITORY = "bsvalues/terragroq"
export const HERMES_BASE_BRANCH = "main"

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^codex\/hermes-[a-z0-9](?:[a-z0-9._-]{0,119}[a-z0-9])?$/
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,119}[a-z0-9])?$/
const SUCCESSFUL_CHECKS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])
const VALIDATION_EXECUTABLES = new Set(["node", "npm", "npx", "pnpm", "yarn", "bun", "cargo", "dotnet"])
const PROHIBITED_WORD = /(^|[-_:])(deploy|production|release|tag)([-_:]|$)/i
const SECRET_LIKE = /(?:ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|password|secret)\s*[:=]\s*\S+)/i

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
  }
}

export function createCommandRunner() {
  return ({ command, args, cwd }) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
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
  const normalized = { command: command.command, args: command.args ?? [] }
  assertSafeInvocation(normalized.command, normalized.args)
  const executable = path.basename(normalized.command).toLowerCase().replace(/\.(cmd|exe)$/i, "")
  if (!VALIDATION_EXECUTABLES.has(executable)) {
    wall("HERMES_REPOSITORY_VALIDATION_WALL", `validationCommands[${index}] executable is not allowed`)
  }
  return Object.freeze({ command: normalized.command, args: Object.freeze([...normalized.args]) })
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

function diffPaths(output) {
  return output.split("\0").filter(Boolean).map(safeRelativePath)
}

function checkState(check) {
  return String(check?.conclusion ?? check?.state ?? check?.status ?? "").toUpperCase()
}

function checkName(check) {
  return String(check?.name ?? check?.context ?? "")
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

  async function run(command, args, { cwd = workspaceRoot, allowFailure = false } = {}) {
    assertSafeInvocation(command, args)
    let result
    try {
      result = normalizeResult(await runner({ command, args: [...args], cwd }))
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

  async function resumeOwnedWorktree({ branch, worktreePath } = {}) {
    const safeBranch = branchName(branch)
    const absoluteWorktree = absolute(worktreePath, "worktreePath")
    if (!inside(ownedWorktreeRoot, absoluteWorktree)) wall("HERMES_REPOSITORY_PATH_WALL", "worktree outside owned root")
    await verifyOrigin()
    const listing = await run("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"])
    const normalized = listing.stdout.replace(/\\/g, "/").toLowerCase()
    const expectedPath = absoluteWorktree.replace(/\\/g, "/").toLowerCase()
    if (!normalized.includes(`worktree ${expectedPath}\n`) || !normalized.includes(`branch refs/heads/${safeBranch.toLowerCase()}\n`)) {
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
    const diff = await run("git", ["-C", record.worktreePath, "diff", "--name-only", "-z", "refs/remotes/origin/main...HEAD"])
    return [...new Set([...statusPaths(status.stdout), ...diffPaths(diff.stdout)])].sort()
  }

  async function runValidationCommands({ worktreePath, branch, commands = validationCommands } = {}) {
    const record = ownedRecord(absolute(worktreePath, "worktreePath"), branchName(branch))
    const normalized = commands === validationCommands ? validationCommands : commands.map(normalizeValidation)
    if (normalized.length === 0) wall("HERMES_REPOSITORY_VALIDATION_WALL", "at least one validation command required")
    const results = []
    for (const command of normalized) {
      const result = await run(command.command, command.args, { cwd: record.worktreePath })
      results.push({ command: command.command, args: [...command.args], code: result.code })
    }
    return results
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
    const prResult = await run("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,headRefName,headRefOid,state,isDraft,reviewDecision,statusCheckRollup,mergeCommit,url"])
    const pr = parseJson(prResult.stdout, "HERMES_REPOSITORY_GITHUB_WALL")
    branchName(pr.headRefName)
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved comments(first:20){nodes{body isMinimized}}} pageInfo{hasNextPage}}}}}"
    const threadResult = await run("gh", ["api", "graphql", "-f", `query=${query}`, "-F", "owner=bsvalues", "-F", "name=terragroq", "-F", `number=${number}`])
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
    const unresolved = unresolvedThreadCount(parseJson(threadResult.stdout, "HERMES_REPOSITORY_GITHUB_WALL"))
    return {
      ...pr,
      checksGreen: checks.length > 0 && checks.every((check) => SUCCESSFUL_CHECKS.has(checkState(check))),
      reviewed: pr.reviewDecision === "APPROVED" || checks.some((check) =>
        /coderabbit/i.test(checkName(check)) && SUCCESSFUL_CHECKS.has(checkState(check))),
      unresolvedThreadCount: unresolved,
    }
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

  async function mergePullRequest({ number, branch } = {}) {
    const safeBranch = branchName(branch)
    const pr = await inspectPullRequest(number)
    if (pr.headRefName !== safeBranch || pr.state !== "OPEN" || pr.isDraft || !pr.checksGreen
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

  async function cleanupOwnedWorktree({ worktreePath, branch, mergeCommitSha } = {}) {
    const safeBranch = branchName(branch)
    const absoluteWorktree = absolute(worktreePath, "worktreePath")
    const record = records.get(safeBranch)
    if (record?.cleaned) return { branch: safeBranch, worktreePath: absoluteWorktree, cleaned: true, alreadyCleaned: true }
    ownedRecord(absoluteWorktree, safeBranch)
    if (!await verifyOriginMainContains(mergeCommitSha)) wall("HERMES_REPOSITORY_CLEANUP_WALL", "merge not present on origin/main")
    const status = await run("git", ["-C", absoluteWorktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"])
    if (status.stdout.length > 0) wall("HERMES_REPOSITORY_CLEANUP_WALL", "owned worktree is dirty")
    await run("git", ["-C", repositoryRoot, "worktree", "remove", absoluteWorktree])
    await run("git", ["-C", repositoryRoot, "branch", "--delete", safeBranch])
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
    resumeOwnedWorktree,
    inspectChangedPaths,
    runValidationCommands,
    discoverPullRequest,
    inspectPullRequest,
    pushBranch,
    createPullRequest,
    mergePullRequest,
    verifyOriginMainContains,
    cleanupOwnedWorktree,
  })
}

export const createHermesRepositoryLifecycle = createRepositoryLifecycle
