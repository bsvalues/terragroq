import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { looksBinary, resolveRealWorkspacePath, resolveWorkspacePath } from "@/lib/loom/workspace"

const runFile = promisify(execFile)
const MAX_FILE_BYTES = 2_000_000

export type CodexIsolatedWorkspace = Readonly<{
  projectRoot: string
  runtimeRoot: string
  root: string
  baseSha: string
  selectedPath: string
  initialContentDigest: string
}>

export type CodexIsolatedResult = Readonly<{
  content: string
  digest: string
}>

export class CodexIsolatedWorkspaceError extends Error {
  readonly code:
    | "CODEX_ISOLATION_UNAVAILABLE"
    | "CODEX_ISOLATION_VIOLATION"
    | "CODEX_NO_CHANGE"
    | "CODEX_CLEANUP_FAILED"

  constructor(code: CodexIsolatedWorkspaceError["code"], message: string) {
    super(message)
    this.name = "CodexIsolatedWorkspaceError"
    this.code = code
  }
}

function failure(code: CodexIsolatedWorkspaceError["code"], detail: string): never {
  throw new CodexIsolatedWorkspaceError(code, detail)
}

function comparable(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 4_000_000,
    windowsHide: true,
  })
  return result.stdout
}

function productWorktreeRoot(runtimeRoot?: string): string {
  return path.resolve(runtimeRoot ?? path.join(os.homedir(), ".williamos", "loom"), "codex-worktrees")
}

async function exactRepositoryRoot(projectRoot: string): Promise<{ root: string; head: string }> {
  const root = path.resolve(projectRoot)
  let topLevel: string
  let head: string
  try {
    topLevel = (await git(root, ["rev-parse", "--show-toplevel"])).trim()
    head = (await git(root, ["rev-parse", "HEAD"])).trim()
  } catch {
    failure("CODEX_ISOLATION_UNAVAILABLE", "the configured project is not a readable Git checkout")
  }
  if (comparable(topLevel) !== comparable(root) || !/^[0-9a-f]{40}$/i.test(head)) {
    failure("CODEX_ISOLATION_UNAVAILABLE", "the configured project root is not the exact Git worktree root")
  }
  return { root, head }
}

export async function createCodexIsolatedWorkspace(input: Readonly<{
  projectRoot: string
  runtimeRoot?: string
  selectedPath: string
  initialContent: string
}>): Promise<CodexIsolatedWorkspace> {
  const repository = await exactRepositoryRoot(input.projectRoot)
  const lexical = resolveWorkspacePath(repository.root, input.selectedPath)
  if (!lexical.ok || !lexical.relative || lexical.relative !== input.selectedPath.replace(/\\/g, "/").replace(/^\.\//, "")) {
    failure("CODEX_ISOLATION_UNAVAILABLE", "the selected path is not canonical and workspace-relative")
  }
  const runtimeRoot = productWorktreeRoot(input.runtimeRoot)
  if (within(repository.root, runtimeRoot)) {
    failure("CODEX_ISOLATION_UNAVAILABLE", "the disposable worktree root must be outside the real checkout")
  }
  await fs.mkdir(runtimeRoot, { recursive: true })
  const root = path.join(runtimeRoot, `delegate-${randomUUID()}`)
  if (!within(runtimeRoot, root) || path.dirname(root) !== runtimeRoot) {
    failure("CODEX_ISOLATION_UNAVAILABLE", "the disposable worktree target is outside product-local storage")
  }
  try {
    await git(repository.root, ["worktree", "add", "--detach", root, repository.head])
    const target = resolveWorkspacePath(root, lexical.relative)
    if (!target.ok || !target.absolute) failure("CODEX_ISOLATION_UNAVAILABLE", "the selected target was absent from the detached checkout")
    const current = await fs.lstat(target.absolute)
    if (!current.isFile() || current.isSymbolicLink()) {
      failure("CODEX_ISOLATION_UNAVAILABLE", "the selected target is not a regular file in the detached checkout")
    }
    await fs.writeFile(target.absolute, input.initialContent, "utf8")
  } catch (error) {
    try {
      await git(repository.root, ["worktree", "remove", "--force", root])
    } catch {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
      await git(repository.root, ["worktree", "prune"]).catch(() => undefined)
    }
    if (error instanceof CodexIsolatedWorkspaceError) throw error
    failure("CODEX_ISOLATION_UNAVAILABLE", "the disposable detached Git worktree could not be created")
  }
  return {
    projectRoot: repository.root,
    runtimeRoot,
    root,
    baseSha: repository.head,
    selectedPath: lexical.relative,
    initialContentDigest: createHash("sha256").update(input.initialContent, "utf8").digest("hex"),
  }
}

function parseStatus(raw: string): ReadonlyArray<{ status: string; path: string }> {
  return raw.split("\0").filter(Boolean).map((entry) => ({
    status: entry.slice(0, 2),
    path: entry.slice(3).replace(/\\/g, "/"),
  }))
}

async function assertNoLinks(root: string, absolute: string): Promise<void> {
  let cursor = path.resolve(root)
  for (const segment of path.relative(cursor, absolute).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if ((await fs.lstat(cursor)).isSymbolicLink()) {
      failure("CODEX_ISOLATION_VIOLATION", "the selected target traverses a link")
    }
  }
}

export async function inspectCodexIsolatedWorkspace(
  isolated: CodexIsolatedWorkspace,
): Promise<CodexIsolatedResult> {
  let status: ReadonlyArray<{ status: string; path: string }>
  try {
    status = parseStatus(await git(isolated.root, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching",
    ]))
  } catch {
    failure("CODEX_ISOLATION_VIOLATION", "the disposable worktree diff could not be inspected")
  }
  if (status.length !== 1
    || status[0].path !== isolated.selectedPath
    || !/^[ M]{2}$/.test(status[0].status)
    || !status[0].status.includes("M")) {
    failure("CODEX_ISOLATION_VIOLATION", "the disposable diff is not one exact-path modification")
  }

  const lexical = resolveWorkspacePath(isolated.root, isolated.selectedPath)
  if (!lexical.ok || !lexical.absolute) failure("CODEX_ISOLATION_VIOLATION", "the selected target escaped the disposable worktree")
  const resolved = await resolveRealWorkspacePath(isolated.root, isolated.selectedPath, fs.realpath)
  if (!resolved.ok || resolved.absolute !== lexical.absolute || resolved.relative !== isolated.selectedPath) {
    failure("CODEX_ISOLATION_VIOLATION", "the selected target no longer resolves to its exact path")
  }
  await assertNoLinks(isolated.root, lexical.absolute)
  const current = await fs.lstat(lexical.absolute)
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size > MAX_FILE_BYTES) {
    failure("CODEX_ISOLATION_VIOLATION", "the selected target is not one bounded regular file")
  }
  const stage = (await git(isolated.root, ["ls-files", "--stage", "-z", "--", isolated.selectedPath]))
    .split("\0").filter(Boolean)
  const tracked = stage.length === 1 ? /^(100644|100755) [0-9a-f]+ 0\t([\s\S]+)$/.exec(stage[0]) : null
  if (!tracked || tracked[2].replace(/\\/g, "/") !== isolated.selectedPath) {
    failure("CODEX_ISOLATION_VIOLATION", "the selected target became a link, submodule, or untracked file")
  }
  const bytes = await fs.readFile(lexical.absolute)
  if (bytes.byteLength > MAX_FILE_BYTES || looksBinary(bytes)) {
    failure("CODEX_ISOLATION_VIOLATION", "the selected target is binary or oversized")
  }
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    failure("CODEX_ISOLATION_VIOLATION", "the selected target is not valid UTF-8 text")
  }
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest === isolated.initialContentDigest) {
    failure("CODEX_NO_CHANGE", "the provider completed without changing the assigned target")
  }
  return { content, digest }
}

export async function cleanupCodexIsolatedWorkspace(isolated: CodexIsolatedWorkspace): Promise<void> {
  if (!within(isolated.runtimeRoot, isolated.root) || path.dirname(isolated.root) !== isolated.runtimeRoot
    || !path.basename(isolated.root).startsWith("delegate-")) {
    failure("CODEX_CLEANUP_FAILED", "the cleanup target is not an exact product-owned worktree")
  }
  try {
    await git(isolated.projectRoot, ["worktree", "remove", "--force", isolated.root])
  } catch {
    try {
      await fs.rm(isolated.root, { recursive: true, force: true })
      await git(isolated.projectRoot, ["worktree", "prune"])
    } catch {
      failure("CODEX_CLEANUP_FAILED", "the disposable worktree could not be removed")
    }
  }
  try {
    await fs.lstat(isolated.root)
    failure("CODEX_CLEANUP_FAILED", "the disposable worktree directory still exists")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  let listed: string
  try {
    listed = await git(isolated.projectRoot, ["worktree", "list", "--porcelain"])
  } catch {
    failure("CODEX_CLEANUP_FAILED", "the Git worktree registry could not be verified")
  }
  const registered = listed.split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => comparable(line.slice("worktree ".length)))
  if (registered.includes(comparable(isolated.root))) {
    failure("CODEX_CLEANUP_FAILED", "the disposable worktree is still registered")
  }
}
