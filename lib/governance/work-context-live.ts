import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/**
 * The facts a lane is not allowed to assert about itself.
 *
 * A receipt whose premises are all supplied by the agent proves only that the agent can type. Current
 * main and the controlling instruction chain are therefore measured here, server-side, and merged
 * over anything the caller claimed. What the lane still supplies -- its Work Order, its reservation,
 * its subsystem search -- is exactly the part a machine cannot check for it, and that part is
 * recorded so a wrong claim is attributable rather than deniable.
 */

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()

/** The instruction chain whose content the receipt is bound to. */
export const DOCTRINE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/governance/multi-agent-operator-playbook.md",
  "docs/governance/sovereign-runtime-and-review-supersession.md",
] as const

export interface LiveWorkContext {
  mainSha: string
  doctrineDigest: string
  /** Files that could not be read, so a missing doctrine file is visible rather than silently skipped. */
  missingDoctrine: string[]
}

/**
 * Read current origin/main after fetching it.
 *
 * Fetching first is the whole point: `git rev-parse origin/main` against a stale remote ref returns
 * yesterday's truth with total confidence, which is the failure mode the gate exists to stop.
 */
export async function measureCurrentMain(): Promise<string | null> {
  try {
    await run("git", ["fetch", "--quiet", "origin", "main"], { cwd: PROJECT_ROOT, timeout: 60_000, windowsHide: true })
  } catch {
    // A fetch failure must not fall back to the cached ref: unknown is safer than confidently stale.
    return null
  }
  try {
    const { stdout } = await run("git", ["rev-parse", "origin/main"], { cwd: PROJECT_ROOT, timeout: 30_000, windowsHide: true })
    const sha = stdout.trim()
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null
  } catch {
    return null
  }
}

/** Hash the controlling documents as they are on disk, so a doctrine change invalidates receipts. */
export async function measureDoctrineDigest(): Promise<{ digest: string; missing: string[] }> {
  const hash = crypto.createHash("sha256")
  const missing: string[] = []
  for (const relative of DOCTRINE_FILES) {
    try {
      const content = await fs.readFile(path.join(PROJECT_ROOT, relative), "utf8")
      // Normalise line endings: a checkout that differs only by CRLF is not a doctrine change.
      hash.update(`${relative}:${content.replace(/\r\n/g, "\n")}`)
    } catch {
      missing.push(relative)
      hash.update(`${relative}:MISSING`)
    }
  }
  return { digest: hash.digest("hex"), missing }
}

export async function measureLiveWorkContext(): Promise<LiveWorkContext | null> {
  const [mainSha, doctrine] = await Promise.all([measureCurrentMain(), measureDoctrineDigest()])
  if (!mainSha) return null
  return { mainSha, doctrineDigest: doctrine.digest, missingDoctrine: doctrine.missing }
}
