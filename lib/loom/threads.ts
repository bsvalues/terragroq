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
export async function loomThreadOwner(sessionId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT "userId" FROM "governance_event"
        WHERE "entityType" = 'loom_agent' AND "entityId" = $1
        ORDER BY "createdAt" ASC LIMIT 1`,
      [sessionId],
    )
    return (result.rows[0]?.userId as string | undefined) ?? null
  } catch {
    return null
  }
}
