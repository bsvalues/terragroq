import { pool } from "@/lib/db"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"

/**
 * Who a workroom thread belongs to, and whether this caller may resume it.
 *
 * The agent route mints a session id, hands it to the CLI, and sends it to the browser. Resuming
 * replays that thread's entire history -- the prompts, the reasoning, the files it looked at. The id
 * was validated for SHAPE and then trusted, so any authenticated caller holding someone else's id
 * could resume their conversation and read all of it. Shape is not ownership.
 *
 * The decision is kept separate from the lookup for the same reason the authority check is: the rule
 * is what needs testing, and it should not require a database to state it.
 */

export interface ThreadResumeVerdict {
  ok: boolean
  failure?: "THREAD_NOT_FOUND" | "THREAD_NOT_YOURS"
  detail?: string
}

export interface LoomThreadDescriptor {
  owner: string
  mode: "agent" | "review" | "preview" | null
  path: string | null
  provider?: string
  workContextReceipt?: string
  forkedFrom?: string
  worldId?: string
  evidenceFingerprint?: string
  repositoryResourceKey?: string
  repositoryIdentity?: string
  repositoryMountKey?: string
  observedRevision?: string
}

export interface LoomCodexThreadDescriptor {
  owner: string
  provider: string | null
  mode: string | null
  workspace: string | null
  worldId: string | null
  outcomeKey: string | null
  workOrderId: number | null
  grantId: number | null
  assignmentHash: string | null
  selectedPath: string | null
  repositoryResourceKey?: string
  repositoryIdentity?: string
  repositoryMountKey?: string
  observedRevision?: string
}

type ThreadRepositoryIdentity = Readonly<{
  repositoryResourceKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
}>

type ThreadRepositoryIdentityVerdict =
  | Readonly<{ status: "legacy" }>
  | Readonly<{ status: "valid"; identity: ThreadRepositoryIdentity }>
  | Readonly<{ status: "invalid" }>

function threadRepositoryIdentity(metadata: Record<string, unknown> | null): ThreadRepositoryIdentityVerdict {
  const values = [
    metadata?.repositoryResourceKey,
    metadata?.repositoryIdentity,
    metadata?.repositoryMountKey,
    metadata?.observedRevision,
  ]
  if (values.every((value) => value === undefined || value === null)) return { status: "legacy" }
  const repositoryResourceKey = metadata?.repositoryResourceKey
  const repositoryIdentity = metadata?.repositoryIdentity
  const repositoryMountKey = metadata?.repositoryMountKey
  const observedRevision = metadata?.observedRevision
  if (typeof repositoryResourceKey !== "string"
    || typeof repositoryIdentity !== "string"
    || typeof repositoryMountKey !== "string"
    || typeof observedRevision !== "string"
    || !/^[a-f0-9]{40,64}$/.test(observedRevision)) {
    return { status: "invalid" }
  }
  const selection = resolveWorkspaceRepositorySelection(
    repositoryResourceKey === "williamos" ? "williamos" : "terrafusion",
    repositoryResourceKey,
  )
  if (!selection.ok
    || selection.repository.identity !== repositoryIdentity
    || selection.repository.mountKey !== repositoryMountKey) {
    return { status: "invalid" }
  }
  return {
    status: "valid",
    identity: { repositoryResourceKey, repositoryIdentity, repositoryMountKey, observedRevision },
  }
}

/**
 * Decide whether a resume may proceed.
 *
 * An unknown thread is refused rather than started fresh. Silently converting "resume this" into
 * "begin a new conversation" hides the interesting case -- a caller asking for a thread that is not
 * theirs looks identical to a typo, and only one of those is worth knowing about.
 */
export function assertThreadResume(input: {
  resuming: boolean
  owner: string | null
  userId: string
}): ThreadResumeVerdict {
  if (!input.resuming) return { ok: true }
  if (input.owner === null) {
    return { ok: false, failure: "THREAD_NOT_FOUND", detail: "no workroom thread was ever started under that id" }
  }
  if (input.owner !== input.userId) {
    return { ok: false, failure: "THREAD_NOT_YOURS", detail: "that thread belongs to another operator" }
  }
  return { ok: true }
}

/**
 * Find the operator who started a thread, from the receipt written when it began.
 *
 * An unreadable ledger returns null, which the rule above treats as refusal. A lookup that cannot be
 * performed is not permission to proceed.
 */
export async function loomThreadDescriptor(sessionId: string): Promise<LoomThreadDescriptor | null> {
  try {
    const result = await pool.query(
      `SELECT "userId", "metadata" FROM "governance_event"
        WHERE "entityType" = 'loom_agent' AND "entityId" = $1 AND "eventType" = 'LOOP_STARTED'
        ORDER BY "createdAt" ASC LIMIT 1`,
      [sessionId],
    )
    const row = result.rows[0] as { userId?: unknown; metadata?: unknown } | undefined
    if (typeof row?.userId !== "string") return null
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : null
    const repository = threadRepositoryIdentity(metadata)
    if (repository.status === "invalid") return null
    const provider = boundedMetadataString(metadata?.provider, 40)
    const workContextReceipt = boundedMetadataString(metadata?.workContextReceipt, 500)
    const worldId = boundedMetadataString(metadata?.worldId, 200)
    const evidenceFingerprint = typeof metadata?.evidenceFingerprint === "string"
      && /^[0-9a-f]{64}$/.test(metadata.evidenceFingerprint) ? metadata.evidenceFingerprint : null
    const forkedFrom = typeof metadata?.forkedFrom === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.forkedFrom)
      && metadata.forkedFrom !== sessionId ? metadata.forkedFrom : null
    return {
      owner: row.userId,
      mode: metadata?.mode === "review" || metadata?.mode === "agent" || metadata?.mode === "preview" ? metadata.mode : null,
      path: typeof metadata?.path === "string" ? metadata.path : null,
      ...(provider ? { provider } : {}),
      ...(workContextReceipt ? { workContextReceipt } : {}),
      ...(forkedFrom ? { forkedFrom } : {}),
      ...(worldId ? { worldId } : {}),
      ...(evidenceFingerprint ? { evidenceFingerprint } : {}),
      ...(repository.status === "valid" ? repository.identity : {}),
    }
  } catch {
    return null
  }
}

function boundedMetadataString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

export async function loomThreadOwner(sessionId: string): Promise<string | null> {
  return (await loomThreadDescriptor(sessionId))?.owner ?? null
}

/**
 * Read the immutable identity of a durable Codex product session.
 *
 * This deliberately does not reuse the legacy Claude descriptor's permissive defaults. A missing
 * provider, mode, or workspace is not a Codex session: resuming it would replay private history and
 * grant a workspace-writing agent authority under facts that were never recorded.
 */
export async function loomCodexThreadDescriptor(threadId: string): Promise<LoomCodexThreadDescriptor | null> {
  try {
    const result = await pool.query(
      `SELECT "userId", "metadata" FROM "governance_event"
        WHERE "entityType" = 'loom_codex_ready' AND "entityId" = $1
          AND "eventType" = 'EVIDENCE_RECORDED'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [threadId],
    )
    const row = result.rows[0] as { userId?: unknown; metadata?: unknown } | undefined
    const metadata = row?.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : null
    if (typeof row?.userId !== "string") return null
    if (metadata?.committed !== true) return null
    const repository = threadRepositoryIdentity(metadata)
    if (repository.status === "invalid") return null
    const workOrderId = typeof metadata.workOrderId === "number" && Number.isSafeInteger(metadata.workOrderId)
      ? metadata.workOrderId
      : null
    const grantId = typeof metadata.grantId === "number" && Number.isSafeInteger(metadata.grantId)
      ? metadata.grantId
      : null
    return {
      owner: row.userId,
      provider: typeof metadata?.provider === "string" ? metadata.provider : null,
      mode: typeof metadata?.mode === "string" ? metadata.mode : null,
      workspace: typeof metadata?.workspace === "string" ? metadata.workspace : null,
      worldId: typeof metadata?.worldId === "string" ? metadata.worldId : null,
      outcomeKey: typeof metadata?.outcomeKey === "string" ? metadata.outcomeKey : null,
      workOrderId,
      grantId,
      assignmentHash: typeof metadata?.assignmentHash === "string" ? metadata.assignmentHash : null,
      selectedPath: typeof metadata?.selectedPath === "string" ? metadata.selectedPath : null,
      ...(repository.status === "valid" ? repository.identity : {}),
    }
  } catch {
    return null
  }
}
