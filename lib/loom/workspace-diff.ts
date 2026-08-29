import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

export const MAX_WORKSPACE_PATCH_BYTES = 2_000_000

export type WorkspaceFileDiffState = "modified" | "clean" | "untracked" | "oversize" | "git-unavailable"

export type WorkspaceFileDiffSnapshot = Readonly<{
  path: string
  state: WorkspaceFileDiffState
  status: string
  patch: string
  baseHash: string | null
  patchHash: string | null
  fingerprint: string
  reason: "PATCH_TOO_LARGE" | "GIT_UNAVAILABLE" | null
}>

type GitResult = Readonly<{ stdout: string; stderr?: string }>
export type FixedGitRunner = (
  file: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; encoding: "utf8"; maxBuffer: number; windowsHide: true }>,
) => Promise<GitResult>

const defaultRun = promisify(execFile) as unknown as FixedGitRunner

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function fingerprint(input: Omit<WorkspaceFileDiffSnapshot, "fingerprint" | "patch" | "reason">): string {
  return JSON.stringify(input)
}

function unavailable(path: string): WorkspaceFileDiffSnapshot {
  const identity = { path, state: "git-unavailable" as const, status: "", baseHash: null, patchHash: null }
  return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "GIT_UNAVAILABLE" }
}

function isMaxBufferFailure(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    || /maxBuffer/i.test(error instanceof Error ? error.message : "")
}

/**
 * Read one canonical workspace-relative file's current Git truth. Every invocation uses a fixed
 * executable and argument vector; the path is data after `--`, never shell text.
 */
export async function deriveWorkspaceFileDiff(
  projectRoot: string,
  relativePath: string,
  run?: FixedGitRunner,
): Promise<WorkspaceFileDiffSnapshot> {
  const runner = run ?? defaultRun
  const options = {
    cwd: projectRoot,
    encoding: "utf8" as const,
    maxBuffer: MAX_WORKSPACE_PATCH_BYTES + 1,
    windowsHide: true as const,
  }
  let status = ""
  try {
    status = (await runner("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", relativePath], options)).stdout.trimEnd()
  } catch {
    return unavailable(relativePath)
  }

  let tracked = true
  try {
    await runner("git", ["ls-files", "--error-unmatch", "--", relativePath], options)
  } catch {
    // `status` already proved Git/repository availability. A failed exact ls-files lookup therefore
    // means this path has no tracked entry (including an ignored file, which porcelain omits).
    tracked = false
  }

  let baseHash: string
  try {
    baseHash = (await runner("git", ["rev-parse", "--verify", "HEAD"], options)).stdout.trim()
    if (!baseHash) return unavailable(relativePath)
  } catch {
    return unavailable(relativePath)
  }

  if (!tracked) {
    const patchHash = createHash("sha256").update("").digest("hex")
    const identity = { path: relativePath, state: "untracked" as const, status, baseHash, patchHash }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: null }
  }

  let patch: string
  let patchHash: string
  try {
    if (run) {
      patch = (await runner("git", ["diff", "--patch", "--no-color", "HEAD", "--", relativePath], options)).stdout
      patchHash = createHash("sha256").update(patch).digest("hex")
    } else {
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-diff-"))
      const outputPath = path.join(temporary, "patch")
      try {
        await runner("git", ["diff", "--patch", "--no-color", `--output=${outputPath}`, "HEAD", "--", relativePath], options)
        const size = (await fs.stat(outputPath)).size
        patchHash = await sha256File(outputPath)
        patch = size > MAX_WORKSPACE_PATCH_BYTES ? "" : await fs.readFile(outputPath, "utf8")
        if (size > MAX_WORKSPACE_PATCH_BYTES) {
          const identity = { path: relativePath, state: "oversize" as const, status, baseHash, patchHash }
          return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "PATCH_TOO_LARGE" }
        }
      } finally {
        await fs.rm(temporary, { recursive: true, force: true })
      }
    }
  } catch (error) {
    if (!isMaxBufferFailure(error)) return unavailable(relativePath)
    const identity = { path: relativePath, state: "oversize" as const, status, baseHash, patchHash: null }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "PATCH_TOO_LARGE" }
  }
  if (Buffer.byteLength(patch, "utf8") > MAX_WORKSPACE_PATCH_BYTES) {
    const identity = { path: relativePath, state: "oversize" as const, status, baseHash, patchHash }
    return { ...identity, patch: "", fingerprint: fingerprint(identity), reason: "PATCH_TOO_LARGE" }
  }
  const state = patch.length > 0 || status.length > 0 ? "modified" as const : "clean" as const
  const identity = { path: relativePath, state, status, baseHash, patchHash }
  return { ...identity, patch, fingerprint: fingerprint(identity), reason: null }
}
