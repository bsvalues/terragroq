import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
import { validateHelloApplicationInContainer } from "./proposal-validation.mjs"

export const HELLO_APPLICATION_ALLOWED_PATHS = Object.freeze([
  "examples/hello-application/src/app.js", "examples/hello-application/src/index.html", "examples/hello-application/src/styles.css",
])
const VALIDATION_PATHS = [...HELLO_APPLICATION_ALLOWED_PATHS, "examples/hello-application/package.json", "examples/hello-application/server.mjs", "examples/hello-application/test/hello.test.mjs"]
const SHA = /^[0-9a-f]{40,64}$/i
const ID = /^[0-9a-f-]{36}$/i
const MAX_PATCH_BYTES = 256 * 1024
let applyQueue = Promise.resolve()

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => execFile(command, args, { cwd: options.cwd, env: options.env, encoding: options.encoding ?? "utf8", windowsHide: true, maxBuffer: options.maxBuffer ?? 2_000_000 }, (error, stdout, stderr) => {
    const result = { code: error ? 1 : 0, stdout, stderr }
    if (error && !options.allowFailure) reject(new Error(options.errorCode ?? "HELLO_PROPOSAL_COMMAND_FAILED"))
    else resolve(result)
  }))
}
const git = (root, args, options = {}) => run("git", ["-C", root, ...args], options)
const required = (value, name) => { if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new TypeError(`${name} is required`); return value.trim() }
const pathsFor = (runtime, id) => ({ root: path.join(path.resolve(runtime), "hello-application-proposals"), receipt: path.join(path.resolve(runtime), "hello-application-proposals", `${id}.json`), patch: path.join(path.resolve(runtime), "hello-application-proposals", `${id}.patch`) })
const writeJson = (target, value) => { fs.mkdirSync(path.dirname(target), { recursive: true }); const temp = `${target}.${crypto.randomUUID()}`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); fs.renameSync(temp, target) }

function request(value) {
  if (typeof value !== "string") throw new Error("HELLO_PROPOSAL_REQUEST_INVALID")
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2_000 || trimmed.includes("\0")) throw new Error("HELLO_PROPOSAL_REQUEST_INVALID")
  return trimmed
}
function policy(repository) {
  try { return JSON.parse(fs.readFileSync(path.join(repository, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), "utf8")) } catch { throw new Error("HELLO_PROPOSAL_POLICY_INVALID") }
}
function changed(status) {
  const result = []
  for (const entry of String(status).split("\0").filter(Boolean)) {
    const code = entry.slice(0, 2); const item = entry.slice(3).replaceAll("\\", "/")
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
function regular(root, items) { for (const item of items) { const stat = fs.lstatSync(path.join(root, ...item.split("/"))); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID") } }
function direct(runtime, workspace) { const parent = path.resolve(runtime, "worktrees"); if (path.dirname(path.resolve(workspace)) !== parent || fs.lstatSync(parent).isSymbolicLink() || fs.lstatSync(workspace).isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID") }
function hashFile(root, item) { const stat = fs.lstatSync(path.join(root, ...item.split("/"))); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID"); return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, ...item.split("/")).toString("utf8").replaceAll("\r\n", "\n"))).digest("hex") }

export function governedPrompt(requestText) {
  return [
    "Implement the owner request below in the isolated Hello Application workspace.", `Owner request: ${requestText}`,
    `You may modify a nonempty subset of only: ${HELLO_APPLICATION_ALLOWED_PATHS.join(", ")}.`,
    "Preserve existing behavior outside the request. Do not create, delete, rename, or change modes of files.",
    "Do not run Git. Do not use network access. Do not install dependencies. Do not commit or push.",
    "The trusted host will run exactly: node --test examples/hello-application/test/hello.test.mjs in a contained validator.",
  ].join("\n")
}

async function defaultResident({ repositoryRoot, runtimeRoot, workspacePath, requestText }) {
  const backend = new ResidentModelExecutionBackend({ repositoryRoot, runtimeRoot }); const client = await backend.runCodexClient({ workspacePath, timeoutMs: 1_800_000 })
  try { await client.connect(); const threadId = await client.startThread(); const turn = await client.runTurn({ threadId, prompt: governedPrompt(requestText), timeoutMs: 1_800_000 }); return { threadId, turnId: turn.turnId, model: policy(repositoryRoot).model.id, ignoredPathsCreated: [] } } finally { client.close() }
}
async function removeWorktree(repository, runtime, workspace) { try { await git(repository, ["worktree", "remove", "--force", workspace], { allowFailure: true }) } finally { await git(repository, ["worktree", "prune"], { allowFailure: true }) } }
function receipt(runtime, id) { const files = pathsFor(runtime, id); try { const value = JSON.parse(fs.readFileSync(files.receipt, "utf8")); if (!ID.test(id) || ![1, 2].includes(value.schemaVersion) || value.proposalId !== id || !Array.isArray(value.changedPaths) || !SHA.test(value.baseSha) || !/^[0-9a-f]{64}$/.test(value.patchSha256)) throw new Error(); return { value, files } } catch { throw new Error("HELLO_PROPOSAL_NOT_FOUND") } }
function review(value, files) { const bytes = fs.readFileSync(files.patch); if (crypto.createHash("sha256").update(bytes).digest("hex") !== value.patchSha256 || !bytes.length || bytes.length > MAX_PATCH_BYTES || bytes.includes(0)) throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH"); return { ...value, reviewPatch: new TextDecoder("utf-8", { fatal: true }).decode(bytes) } }
async function patchPaths(repository, patch) {
  const raw = await git(repository, ["apply", "--numstat", "-z", patch], { encoding: "buffer", errorCode: "HELLO_PROPOSAL_PATCH_INVALID" }); const text = Buffer.from(raw.stdout).toString("utf8")
  if (/GIT binary patch|new file mode|deleted file mode|old mode|new mode|rename |copy /.test(fs.readFileSync(patch, "utf8"))) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  const result = text.split("\0").filter(Boolean).map((line) => { const pieces = line.split("\t"); if (pieces.length !== 3 || pieces[0] === "-" || pieces[1] === "-") throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH"); return pieces[2].replaceAll("\\", "/") })
  assertHelloApplicationChangedPaths(result, []); return [...new Set(result)].sort()
}
const event = (onProgress, stage, detail) => { if (onProgress) onProgress({ stage, detail, at: new Date().toISOString() }) }

export async function createHelloApplicationProposal({ repositoryRoot, runtimeRoot, requestedBy, requestText, onProgress, residentTurn = defaultResident, validateWorkspace = validateHelloApplicationInContainer }) {
  const owner = required(requestedBy, "requestedBy"); const requested = request(requestText); const repository = fs.realpathSync(path.resolve(repositoryRoot)); const runtime = path.resolve(required(runtimeRoot, "runtimeRoot")); const id = crypto.randomUUID(); const workspace = path.join(runtime, "worktrees", `hello-${id}`); const branch = `codex/hermes-hello-${id}`
  event(onProgress, "accepted", "Request accepted"); fs.mkdirSync(path.dirname(workspace), { recursive: true }); if (fs.lstatSync(path.dirname(workspace)).isSymbolicLink()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim(); if (!SHA.test(baseSha)) throw new Error("HELLO_PROPOSAL_BASE_INVALID")
  const dirty = (await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout; if (dirty) throw new Error("HELLO_PROPOSAL_CANONICAL_DIRTY")
  await git(repository, ["worktree", "add", "-b", branch, workspace, baseSha]); let persisted = false
  try {
    direct(runtime, workspace); event(onProgress, "workspace_ready", "Isolated workspace ready"); event(onProgress, "resident_started", "HERMES is editing the isolated workspace")
    const turn = await residentTurn({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace, requestText: requested, prompt: governedPrompt(requested) }); event(onProgress, "resident_finished", "HERMES editing finished")
    if ((await git(workspace, ["rev-parse", "HEAD"])).stdout.trim() !== baseSha) throw new Error("HELLO_PROPOSAL_RESIDENT_HEAD_MUTATED")
    const paths = changed((await git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout); assertHelloApplicationChangedPaths(paths, turn?.ignoredPathsCreated); regular(workspace, paths)
    await git(workspace, ["diff", "--check", "--", ...paths], { errorCode: "HELLO_PROPOSAL_DIFF_INVALID" }); event(onProgress, "validation_started", "Contained validation started")
    const validation = await validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: workspace })
    await git(workspace, ["add", "--", ...paths]); await git(workspace, ["-c", "user.name=WilliamOS HERMES Proposal", "-c", "user.email=hermes@williamos.local", "commit", "-m", `proposal(hello): resident change ${id}`])
    const proposalCommit = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim(); const bytes = Buffer.from((await git(workspace, ["diff", "--binary", "--full-index", baseSha, proposalCommit, "--", ...paths], { encoding: "buffer" })).stdout); if (!bytes.length || bytes.length > MAX_PATCH_BYTES) throw new Error("HELLO_PROPOSAL_PATCH_SIZE_REFUSED")
    const files = pathsFor(runtime, id); fs.mkdirSync(files.root, { recursive: true }); fs.writeFileSync(files.patch, bytes, { flag: "wx" }); const reviewed = policy(repository)
    const value = { schemaVersion: 2, proposalId: id, status: "READY_FOR_REVIEW", requestedBy: owner, requestText: requested, requestSha256: crypto.createHash("sha256").update(requested).digest("hex"), executionNode: reviewed.placement.executionNode ?? "unknown", progress: [], createdAt: new Date().toISOString(), appliedAt: null, appliedCommit: null, baseSha, proposalCommit, branch, changedPaths: paths, patchSha256: crypto.createHash("sha256").update(bytes).digest("hex"), threadId: required(turn?.threadId, "threadId"), turnId: required(turn?.turnId, "turnId"), model: required(turn?.model, "model"), validation }
    writeJson(files.receipt, value); persisted = true; event(onProgress, "ready_for_review", "Proposal ready for review"); return review(value, files)
  } finally { await removeWorktree(repository, runtime, workspace); if (!persisted) await git(repository, ["branch", "-D", branch], { allowFailure: true }) }
}

async function applyInner({ repositoryRoot, runtimeRoot, proposalId, requestedBy, validateWorkspace }) {
  const repository = fs.realpathSync(path.resolve(repositoryRoot))
  const runtime = path.resolve(runtimeRoot)
  const { value, files } = receipt(runtime, required(proposalId, "proposalId"))
  if (value.requestedBy !== required(requestedBy, "requestedBy") || value.status !== "READY_FOR_REVIEW") throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE")
  assertHelloApplicationChangedPaths(value.changedPaths, [])
  const head = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim()
  if (head !== value.baseSha) throw new Error("HELLO_PROPOSAL_STALE_BASE")
  if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
  const bytes = fs.readFileSync(files.patch)
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== value.patchSha256) throw new Error("HELLO_PROPOSAL_PATCH_MISMATCH")
  const paths = await patchPaths(repository, files.patch)
  if (JSON.stringify(paths) !== JSON.stringify(value.changedPaths)) throw new Error("HELLO_PROPOSAL_PATCH_SCOPE_MISMATCH")
  await git(repository, ["apply", "--check", "--whitespace=error-all", files.patch])
  await git(repository, ["apply", "--whitespace=error-all", files.patch])
  let patchApplied = true
  let publishedCommit = null
  const validationWorkspace = path.join(runtime, "worktrees", `apply-${crypto.randomUUID()}`)
  try {
    fs.mkdirSync(path.dirname(validationWorkspace), { recursive: true })
    await git(repository, ["worktree", "add", "--detach", validationWorkspace, value.baseSha])
    direct(runtime, validationWorkspace)
    await git(validationWorkspace, ["apply", "--whitespace=error-all", files.patch])
    regular(validationWorkspace, VALIDATION_PATHS)
    const validation = await validateWorkspace({ repositoryRoot: repository, runtimeRoot: runtime, workspacePath: validationWorkspace })
    for (const item of paths) if (hashFile(repository, item) !== hashFile(validationWorkspace, item)) throw new Error("HELLO_PROPOSAL_VALIDATION_HASH_MISMATCH")
    if ((await git(repository, ["rev-parse", "HEAD"])).stdout.trim() !== value.baseSha) throw new Error("HELLO_PROPOSAL_STALE_BASE")
    const canonicalPaths = changed((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...VALIDATION_PATHS])).stdout)
    if (JSON.stringify(canonicalPaths) !== JSON.stringify(paths)) throw new Error("HELLO_PROPOSAL_TARGET_DIRTY")
    const index = path.join(runtime, "worktrees", `apply-index-${crypto.randomUUID()}`)
    const env = { ...process.env, GIT_INDEX_FILE: index }
    try {
      await git(repository, ["read-tree", value.baseSha], { env })
      await git(repository, ["add", "--", ...paths], { env })
      const tree = (await git(repository, ["write-tree"], { env })).stdout.trim()
      const commit = (await git(repository, ["-c", "user.name=WilliamOS HERMES Apply", "-c", "user.email=hermes@williamos.local", "commit-tree", tree, "-p", value.baseSha, "-m", `apply(hello): governed proposal ${proposalId}`], { env })).stdout.trim()
      const updated = { ...value, status: "APPLIED", appliedAt: new Date().toISOString(), appliedCommit: commit, validation }
      const receiptTemp = `${files.receipt}.${crypto.randomUUID()}.tmp`
      fs.writeFileSync(receiptTemp, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" })
      await git(repository, ["update-ref", "HEAD", commit, value.baseSha])
      publishedCommit = commit
      await git(repository, ["reset", "--mixed", "HEAD", "--", ...paths])
      fs.renameSync(receiptTemp, files.receipt)
      patchApplied = false
      return review(updated, files)
    } finally { try { fs.rmSync(index, { force: true }) } catch {} }
  } catch (error) {
    let recovered = true
    if (publishedCommit && (await git(repository, ["rev-parse", "HEAD"])).stdout.trim() === publishedCommit) {
      const rollback = await git(repository, ["update-ref", "HEAD", value.baseSha, publishedCommit], { allowFailure: true })
      recovered = rollback.code === 0
    } else if (publishedCommit) recovered = false
    if (patchApplied && recovered) {
      const reverse = await git(repository, ["apply", "--reverse", files.patch], { allowFailure: true })
      await git(repository, ["reset", "--mixed", "HEAD", "--", ...paths], { allowFailure: true })
      recovered = reverse.code === 0
    }
    if (!recovered) { writeJson(files.receipt, { ...value, status: "QUARANTINED_ROLLBACK_FAILED", quarantinedAt: new Date().toISOString() }); throw new Error("HELLO_PROPOSAL_ROLLBACK_FAILED") }
    throw error
  } finally { await removeWorktree(repository, runtime, validationWorkspace) }
}
export async function applyHelloApplicationProposal(options) { const next = applyQueue.then(() => applyInner({ ...options, validateWorkspace: options.validateWorkspace ?? validateHelloApplicationInContainer })); applyQueue = next.catch(() => {}); return next }
export function getHelloApplicationProposal({ runtimeRoot, proposalId, requestedBy }) { const { value, files } = receipt(runtimeRoot, proposalId); if (value.requestedBy !== required(requestedBy, "requestedBy")) throw new Error("HELLO_PROPOSAL_OWNER_MISMATCH"); return review(value, files) }
export function listHelloApplicationProposals({ runtimeRoot, requestedBy }) { const root = path.join(path.resolve(runtimeRoot), "hello-application-proposals"); if (!fs.existsSync(root)) return []; return fs.readdirSync(root).filter((name) => name.endsWith(".json")).map((name) => getHelloApplicationProposal({ runtimeRoot, proposalId: name.slice(0, -5), requestedBy })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
