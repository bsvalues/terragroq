import { pool } from "@/lib/db"

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
  mode: "agent" | "review"
  path: string | null
}

export interface LoomCodexThreadDescriptor {
  owner: string
  provider: string | null
  mode: string | null
  workspace: string | null
}

export async function commitCodexThreadReady(input: {
  threadId: string
  owner: string
  workspace: string
}): Promise<void> {
  const metadata = {
    provider: "Codex",
    mode: "delegate",
    workspace: input.workspace,
    committed: true,
  }
  // Unlike the best-effort general receipt logger, this write is a product state transition. A
  // rejected insert must reject the turn; otherwise the browser could report a durable session that
  // the next request is unable to authenticate and resume.
  await pool.query(
    `INSERT INTO "governance_event"
      ("userId", "eventType", "entityType", "entityId", "actor", "reason", "metadata")
      VALUES ($1, 'EVIDENCE_RECORDED', 'loom_codex_ready', $2, 'loom',
        'Codex delegate session committed ready', $3::jsonb)`,
    [input.owner, input.threadId, JSON.stringify(metadata)],
  )
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
    return {
      owner: row.userId,
      mode: metadata?.mode === "review" ? "review" : "agent",
      path: typeof metadata?.path === "string" ? metadata.path : null,
    }
  } catch {
    return null
  }
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
    return {
      owner: row.userId,
      provider: typeof metadata?.provider === "string" ? metadata.provider : null,
      mode: typeof metadata?.mode === "string" ? metadata.mode : null,
      workspace: typeof metadata?.workspace === "string" ? metadata.workspace : null,
    }
  } catch {
    return null
  }
}
