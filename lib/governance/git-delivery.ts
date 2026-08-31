import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { promisify } from "node:util"

import { DeliverySealError, type MeasuredDelivery } from "./delivery-seal.ts"

const runFile = promisify(execFile)
const COMMIT = /^[0-9a-f]{40}$/i

function invalid(detail: string): never {
  throw new DeliverySealError("DELIVERY_SEAL_DIFF_INVALID", detail)
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await runFile("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16_000_000,
    windowsHide: true,
  })
  return result.stdout
}

async function gitBytes(root: string, args: readonly string[]): Promise<Buffer> {
  const result = await runFile("git", ["-C", root, ...args], {
    encoding: "buffer",
    maxBuffer: 16_000_000,
    windowsHide: true,
  })
  return result.stdout
}

function canonicalRemote(value: string): string {
  const trimmed = value.trim().replace(/\.git$/i, "").replace(/\/$/, "")
  const scp = /^git@([^:]+):(.+)$/.exec(trimmed)
  if (scp) return `https://${scp[1].toLowerCase()}/${scp[2]}`
  try {
    const url = new URL(trimmed)
    if (!url.hostname || !url.pathname || url.username || url.password) invalid("the repository origin is not a canonical public identity")
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/$/, "")
  } catch {
    invalid("the repository origin is not a canonical URL")
  }
}

function normalizedPaths(root: string, values: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const raw of values) {
    const candidate = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "")
    const absolute = path.resolve(root, candidate)
    const relative = path.relative(path.resolve(root), absolute).replace(/\\/g, "/")
    if (!candidate || candidate !== relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
      invalid("the delivery path is not canonical and repository-relative")
    }
    seen.add(relative)
  }
  return [...seen].sort()
}

/** Measure an exact assignment patch using only Git and Node built-ins. */
export async function inspectGitDelivery(
  projectRoot: string,
  baseSha: string,
  commitSha: string,
  requestedPaths: readonly string[],
  options: Readonly<{ allowMultiple?: boolean }> = {},
): Promise<MeasuredDelivery> {
  const root = path.resolve(projectRoot)
  if (!COMMIT.test(baseSha) || !COMMIT.test(commitSha)) invalid("the delivery commits are malformed")
  const paths = normalizedPaths(root, requestedPaths)
  if (paths.length === 0) invalid("the delivery has no assigned paths")
  try {
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim()
    if (path.resolve(top) !== root) invalid("the assignment workspace is not the exact Git worktree root")
    const measuredBase = (await git(root, ["rev-parse", `${baseSha}^{commit}`])).trim().toLowerCase()
    const measuredCommit = (await git(root, ["rev-parse", `${commitSha}^{commit}`])).trim().toLowerCase()
    if (measuredBase !== baseSha.toLowerCase() || measuredCommit !== commitSha.toLowerCase()) invalid("the exact delivery commits are unavailable")
    await git(root, ["merge-base", "--is-ancestor", measuredBase, measuredCommit])
    const changed = (await git(root, ["diff", "--name-only", "-z", measuredBase, measuredCommit, "--", ...paths]))
      .split("\0").filter(Boolean).map((item) => item.replace(/\\/g, "/")).sort()
    if (JSON.stringify(changed) !== JSON.stringify(paths)) invalid("the exact assignment paths are not all changed by this commit")
    const patch = await git(root, ["diff", "--binary", "--full-index", "--no-ext-diff", measuredBase, measuredCommit, "--", ...paths])
    if (!patch) invalid("the assignment patch is empty")
    if (paths.length !== 1 && !options.allowMultiple) invalid("one persisted Codex assignment must deliver one exact selected path")
    const deliveredBytes = paths.length === 1
      ? await gitBytes(root, ["show", `${measuredCommit}:${paths[0]}`])
      : Buffer.concat(await Promise.all(paths.map(async (deliveryPath) => {
          const bytes = await gitBytes(root, ["show", `${measuredCommit}:${deliveryPath}`])
          return Buffer.concat([Buffer.from(`${deliveryPath}\0${bytes.length}\0`, "utf8"), bytes])
        })))
    const origin = canonicalRemote(await git(root, ["remote", "get-url", "origin"]))
    return {
      repository: origin,
      baseSha: measuredBase,
      commitSha: measuredCommit,
      paths,
      patchDigest: createHash("sha256").update(patch, "utf8").digest("hex"),
      contentDigest: createHash("sha256").update(deliveredBytes).digest("hex"),
    }
  } catch (error) {
    if (error instanceof DeliverySealError) throw error
    invalid("the exact assignment delivery could not be measured from Git")
  }
}
