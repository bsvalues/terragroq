import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

export const MAX_WORKSPACE_PATCH_BYTES = 2_000_000
export const MAX_WORKSPACE_PATCH_STREAM_BYTES = 32_000_000
const MAX_WORKSPACE_PATCH_STDERR_BYTES = 64_000
const WORKSPACE_PATCH_TIMEOUT_MS = 30_000

export type WorkspaceFileDiffState = "modified" | "clean" | "untracked" | "oversize" | "git-unavailable"

export type WorkspaceFileDiffSnapshot = Readonly<{
  path: string
  state: WorkspaceFileDiffState
  status: string
  patch: string
  baseHash: string | null
  patchHash: string | null
  fingerprint: string
  reason: "PATCH_TOO_LARGE" | "PATCH_RESOURCE_LIMIT" | "GIT_UNAVAILABLE" | null
}>

type GitResult = Readonly<{ stdout: string; stderr?: string }>
export type FixedGitRunner = (
  file: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; encoding: "utf8"; maxBuffer: number; windowsHide: true }>,
) => Promise<GitResult>

export type GitPatchStreamResult = Readonly<{
  patch: string
  patchHash: string | null
  totalBytes: number
  oversize: boolean
  resourceLimited: boolean
}>

export type FixedGitStreamRunner = (
  file: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string
    windowsHide: true
    maxPresentationBytes: number
    maxStreamBytes: number
    timeoutMs: number
  }>,
) => Promise<GitPatchStreamResult>

const defaultRun = promisify(execFile) as unknown as FixedGitRunner

/**
 * Stream one fixed Git invocation. Patch bytes are hashed as they arrive, but presentation memory is
 * discarded as soon as it crosses the UI cap. A separate hard cap and timeout terminate a runaway
 * child rather than allowing an unbounded repository response to consume the server.
 */
export const streamWorkspacePatch: FixedGitStreamRunner = (file, args, options) => new Promise((resolve, reject) => {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    windowsHide: options.windowsHide,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const hash = createHash("sha256")
  const retained: Buffer[] = []
  let retainedBytes = 0
  let totalBytes = 0
  let stderrBytes = 0
  let oversize = false
  let resourceLimited = false
  let settled = false
  let forceKill: ReturnType<typeof setTimeout> | null = null

  const terminate = () => {
    if (resourceLimited) return
    resourceLimited = true
    child.kill()
    forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000)
    forceKill.unref?.()
  }
  const timeout = setTimeout(terminate, options.timeoutMs)
  timeout.unref?.()
  child.stdout.on("data", (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    totalBytes += chunk.length
    if (totalBytes > options.maxStreamBytes) {
      terminate()
      return
    }
    hash.update(chunk)
    if (oversize) return
    const remaining = options.maxPresentationBytes - retainedBytes
    if (chunk.length <= remaining) {
      retained.push(chunk)
      retainedBytes += chunk.length
      return
    }
    oversize = true
    retained.length = 0
    retainedBytes = 0
  })
  child.stderr.on("data", (value: Buffer | string) => {
    stderrBytes += Buffer.byteLength(value)
    if (stderrBytes > MAX_WORKSPACE_PATCH_STDERR_BYTES) terminate()
  })
  child.once("error", (error) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (forceKill) clearTimeout(forceKill)
    reject(error)
  })
  child.once("close", (code) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (forceKill) clearTimeout(forceKill)
    if (resourceLimited) {
      resolve({ patch: "", patchHash: null, totalBytes, oversize: true, resourceLimited: true })
      return
    }
    if (code !== 0) {
      reject(new Error("GIT_DIFF_UNAVAILABLE"))
      return
    }
    resolve({
      patch: oversize ? "" : Buffer.concat(retained, retainedBytes).toString("utf8"),
      patchHash: hash.digest("hex"),
      totalBytes,
      oversize,
      resourceLimited: false,
    })
  })
})

function fingerprint(input: Omit<WorkspaceFileDiffSnapshot, "fingerprint" | "patch" | "reason">): string {
  return JSON.stringify(input)
}

function unavailable(path: string): WorkspaceFileDiffSnapshot {
  const identity = { path, state: "git-unavailable" as const, status: "", baseHash: null, patchHash: null }
  return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "GIT_UNAVAILABLE" }
}

/**
 * Read one canonical workspace-relative file's current Git truth. Every invocation uses a fixed
 * executable and argument vector; the path is data after `--`, never shell text.
 */
export async function deriveWorkspaceFileDiff(
  projectRoot: string,
  relativePath: string,
  run: FixedGitRunner = defaultRun,
  stream: FixedGitStreamRunner = streamWorkspacePatch,
): Promise<WorkspaceFileDiffSnapshot> {
  const options = {
    cwd: projectRoot,
    encoding: "utf8" as const,
    maxBuffer: MAX_WORKSPACE_PATCH_BYTES + 1,
    windowsHide: true as const,
  }
  let status = ""
  try {
    status = (await run("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", relativePath], options)).stdout.trimEnd()
  } catch {
    return unavailable(relativePath)
  }

  let tracked = true
  try {
    await run("git", ["ls-files", "--error-unmatch", "--", relativePath], options)
  } catch {
    tracked = false
  }

  // Resolve once. Every later diff refers to this immutable object id, never to a moving HEAD alias.
  let baseHash: string
  try {
    baseHash = (await run("git", ["rev-parse", "--verify", "HEAD"], options)).stdout.trim()
    if (!baseHash) return unavailable(relativePath)
  } catch {
    return unavailable(relativePath)
  }

  if (!tracked) {
    const patchHash = createHash("sha256").update("").digest("hex")
    const identity = { path: relativePath, state: "untracked" as const, status, baseHash, patchHash }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: null }
  }

  let streamed: GitPatchStreamResult
  try {
    streamed = await stream(
      "git",
      ["diff", "--patch", "--no-color", baseHash, "--", relativePath],
      {
        cwd: projectRoot,
        windowsHide: true,
        maxPresentationBytes: MAX_WORKSPACE_PATCH_BYTES,
        maxStreamBytes: MAX_WORKSPACE_PATCH_STREAM_BYTES,
        timeoutMs: WORKSPACE_PATCH_TIMEOUT_MS,
      },
    )
  } catch {
    return unavailable(relativePath)
  }
  if (streamed.resourceLimited) {
    const identity = { path: relativePath, state: "oversize" as const, status, baseHash, patchHash: null }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "PATCH_RESOURCE_LIMIT" }
  }
  if (streamed.oversize) {
    const identity = { path: relativePath, state: "oversize" as const, status, baseHash, patchHash: streamed.patchHash }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "PATCH_TOO_LARGE" }
  }
  const state = streamed.patch.length > 0 || status.length > 0 ? "modified" as const : "clean" as const
  const identity = { path: relativePath, state, status, baseHash, patchHash: streamed.patchHash }
  return { ...identity, patch: streamed.patch, fingerprint: fingerprint(identity), reason: null }
}
