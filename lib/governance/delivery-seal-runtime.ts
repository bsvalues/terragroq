import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { promisify } from "node:util"

import { pool } from "@/lib/db"
import {
  DeliverySealError,
  deliverySigningKeyFromBase64,
  issueLoomCodexDeliverySeal,
  type MeasuredDelivery,
  type WilliamOSDeliverySeal,
} from "@/lib/governance/delivery-seal"
import { deriveCodexAssignment } from "@/lib/loom/codex-assignment"

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

export async function inspectGitDelivery(
  projectRoot: string,
  baseSha: string,
  commitSha: string,
  requestedPaths: readonly string[],
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
    if (paths.length !== 1) invalid("one persisted Codex assignment must deliver one exact selected path")
    const deliveredBytes = await gitBytes(root, ["show", `${measuredCommit}:${paths[0]}`])
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

async function loadEvent(userId: string, threadId: string, assignmentHash: string, entityType: string) {
  const result = await pool.query(
    `SELECT "id", "metadata" FROM "governance_event"
      WHERE "userId" = $1 AND "entityType" = $2 AND "entityId" = $3
        AND "metadata"->>'assignmentHash' = $4
      ORDER BY "createdAt" DESC LIMIT 1`,
    [userId, entityType, threadId, assignmentHash],
  )
  const row = result.rows[0] as { id?: unknown; metadata?: unknown } | undefined
  return row && Number.isSafeInteger(Number(row.id)) ? { eventId: Number(row.id), metadata: row.metadata } : null
}

export async function issuePersistedCodexDeliverySeal(input: Readonly<{
  userId: string
  threadId: string
  assignmentHash: string
  commitSha: string
}>): Promise<WilliamOSDeliverySeal> {
  const signingKey = deliverySigningKeyFromBase64(process.env.WILLIAMOS_DELIVERY_SEAL_PRIVATE_KEY_B64)
  return issueLoomCodexDeliverySeal(input, {
    loadAssignment: (userId, threadId, assignmentHash) => loadEvent(userId, threadId, assignmentHash, "loom_codex_assignment"),
    loadReady: (userId, threadId, assignmentHash) => loadEvent(userId, threadId, assignmentHash, "loom_codex_ready"),
    deriveCurrentAssignment: async (userId, worldId, projectRoot) => deriveCodexAssignment({ userId, worldId, projectRoot }),
    inspectDelivery: inspectGitDelivery,
    signingKey,
    recordSeal: async (userId, threadId, assignmentEventId, readyEventId, seal) => {
      const result = await pool.query(
        `INSERT INTO "governance_event"
          ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
          VALUES ($1, 'EVIDENCE_RECORDED', 'williamos_delivery_seal', $2, 'williamos',
            'WilliamOS sealed an existing Space assignment for delivery', $3::jsonb)
          RETURNING "id"`,
        [userId, seal.signature, JSON.stringify({
          assignmentEventId,
          readyEventId,
          threadId,
          assignmentHash: seal.payload.assignment.assignmentHash,
          seal,
        })],
      )
      if (!result.rows[0]?.id) throw new Error("DELIVERY_SEAL_NOT_DURABLE")
    },
    now: () => new Date(),
  })
}
