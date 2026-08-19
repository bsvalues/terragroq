import { randomUUID } from "node:crypto"

import { pool } from "@/lib/db"

/**
 * Durable thread bindings (#884, finishing the declared gap).
 *
 * The projection shipped in #885 assembled an answer by re-deriving from the work order every time,
 * which met the acceptance criterion and left the thread itself implicit. A thread that exists only as
 * a query cannot be listed, linked to, or carried forward, and nothing else can attach to it.
 *
 * These write the rows the workbench model already defined: a `workbench_thread`, and one
 * `workbench_thread_source` per thing the thread is built from. Bindings are references -- sourceType
 * and sourceId -- never copies. The read side still re-derives each source's CURRENT state, because a
 * copied verdict is stale the moment its source moves, which is the failure this whole outcome exists
 * to prevent.
 *
 * The schema allows exactly one `root` binding per source, so the objective's work order is the root
 * and everything the objective produced hangs beneath it.
 */

/**
 * Roles the table permits: root, and everything else.
 *
 * The meaning of a binding lives in its sourceType, not in a role vocabulary invented alongside it.
 * One root per source is enforced by the schema, which is what makes an objective resolve to exactly
 * one thread.
 */
export type BindingRole = "root" | "member"

/**
 * The project a thread belongs to.
 *
 * An objective does not name one, so this prefers an explicit key, falls back to the only project when
 * there is exactly one, and otherwise creates a dedicated home rather than guessing between several. A
 * thread filed under the wrong project is worse than one filed under an obvious default.
 */
export async function resolveThreadProject(userId: string, preferredKey?: string): Promise<number> {
  if (preferredKey) {
    const named = await pool.query('SELECT "id" FROM project WHERE "userId" = $1 AND "key" = $2 LIMIT 1', [
      userId,
      preferredKey,
    ])
    if (named.rows[0]) return named.rows[0].id as number
  }
  const existing = await pool.query('SELECT "id" FROM project WHERE "userId" = $1', [userId])
  if (existing.rowCount === 1) return existing.rows[0].id as number

  const home = await pool.query('SELECT "id" FROM project WHERE "userId" = $1 AND "key" = $2 LIMIT 1', [
    userId,
    "operator",
  ])
  if (home.rows[0]) return home.rows[0].id as number

  const created = await pool.query(
    'INSERT INTO project ("userId","key","name","lifecycle") VALUES ($1,$2,$3,$4) RETURNING "id"',
    [userId, "operator", "Operator objectives", "active"],
  )
  return created.rows[0].id as number
}

/** Create the thread for an admitted objective and bind the work order as its root. */
export async function createObjectiveThread(input: {
  userId: string
  projectId: number
  workOrderRef: string
  title: string
}): Promise<string> {
  const threadId = randomUUID()
  // One transaction: a thread whose root binding failed is unreadable and unresolvable, and the first
  // attempt at this left exactly that behind when a check constraint rejected the binding.
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      'INSERT INTO workbench_thread ("id","userId","projectId","title") VALUES ($1,$2,$3,$4)',
      [threadId, input.userId, input.projectId, input.title.slice(0, 200)],
    )
    await client.query(
      `INSERT INTO workbench_thread_source ("userId","threadId","sourceType","sourceId","role")
       VALUES ($1,$2,'work_order',$3,'root')`,
      [input.userId, threadId, input.workOrderRef],
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  return threadId
}

/**
 * Bind a source to a thread, once.
 *
 * Re-binding the same source is a no-op rather than an error: a thread read after a second
 * reconciliation should not fail, and it should not accumulate duplicate rows describing one fact.
 */
export async function bindThreadSource(input: {
  userId: string
  threadId: string
  sourceType: string
  sourceId: string
  role: BindingRole
}): Promise<void> {
  await pool.query(
    `INSERT INTO workbench_thread_source ("userId","threadId","sourceType","sourceId","role")
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING`,
    [input.userId, input.threadId, input.sourceType, input.sourceId, input.role],
  )
  await pool.query('UPDATE workbench_thread SET "updatedAt" = now() WHERE "id" = $1 AND "userId" = $2', [
    input.threadId,
    input.userId,
  ])
}

export interface ThreadBinding {
  sourceType: string
  sourceId: string
  role: string
}

/** What a thread is built from. The read side resolves each of these to its current state. */
export async function threadBindings(userId: string, threadId: string): Promise<ThreadBinding[]> {
  const rows = await pool.query(
    `SELECT "sourceType", "sourceId", "role" FROM workbench_thread_source
      WHERE "userId" = $1 AND "threadId" = $2 ORDER BY "id"`,
    [userId, threadId],
  )
  return rows.rows as ThreadBinding[]
}

/** Find the thread whose root is this work order, so an objective resolves to its own thread. */
export async function threadForWorkOrder(userId: string, workOrderRef: string): Promise<string | null> {
  const rows = await pool.query(
    `SELECT "threadId" FROM workbench_thread_source
      WHERE "userId" = $1 AND "sourceType" = 'work_order' AND "sourceId" = $2 AND "role" = 'root'
      LIMIT 1`,
    [userId, workOrderRef],
  )
  return (rows.rows[0]?.threadId as string | undefined) ?? null
}
