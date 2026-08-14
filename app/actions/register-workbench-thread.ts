"use server"

import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  goal,
  outcomeQueueItem,
  project,
  workbenchThread,
  workbenchThreadSource,
} from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import {
  registerWorkbenchThread,
  type RegisterWorkbenchThreadResult,
  type ThreadRegistryStore,
  type ThreadRegistryTransaction,
  type WorkbenchThreadRootType,
} from "@/lib/workbench/thread-registry"

type ActionInput = Readonly<{
  projectId: number
  title: string
  root: Readonly<{ sourceType: WorkbenchThreadRootType; sourceId: string }>
}>

function canonicalGoalId(sourceId: string): number | null {
  if (!/^[1-9]\d*$/.test(sourceId)) return null
  const value = Number(sourceId)
  return Number.isSafeInteger(value) && String(value) === sourceId ? value : null
}

const store: ThreadRegistryStore = {
  transaction(operation) {
    return db.transaction(async (databaseTransaction) => {
      const transaction: ThreadRegistryTransaction = {
        async projectExists(identity) {
          const rows = await databaseTransaction.select({ id: project.id })
            .from(project)
            .where(and(eq(project.userId, identity.userId), eq(project.id, identity.projectId)))
            .limit(1)
          return rows.length === 1
        },

        async rootSourceExists(identity) {
          if (identity.sourceType === "goal") {
            const goalId = canonicalGoalId(identity.sourceId)
            if (goalId === null) return false
            const rows = await databaseTransaction.select({ id: goal.id })
              .from(goal)
              .where(and(eq(goal.userId, identity.userId), eq(goal.id, goalId)))
              .limit(1)
            return rows.length === 1
          }

          // sourceId for outcomes is the durable outcomeKey. Numeric database
          // row ids are deliberately not accepted as an alternate identity.
          const rows = await databaseTransaction.select({ outcomeKey: outcomeQueueItem.outcomeKey })
            .from(outcomeQueueItem)
            .where(and(
              eq(outcomeQueueItem.userId, identity.userId),
              eq(outcomeQueueItem.outcomeKey, identity.sourceId),
            ))
            .limit(1)
          return rows.length === 1 && rows[0]?.outcomeKey === identity.sourceId
        },

        async findRootBinding(identity) {
          const rows = await databaseTransaction.select({
            userId: workbenchThreadSource.userId,
            threadId: workbenchThreadSource.threadId,
            sourceType: workbenchThreadSource.sourceType,
            sourceId: workbenchThreadSource.sourceId,
            role: workbenchThreadSource.role,
          }).from(workbenchThreadSource)
            .where(and(
              eq(workbenchThreadSource.userId, identity.userId),
              eq(workbenchThreadSource.sourceType, identity.sourceType),
              eq(workbenchThreadSource.sourceId, identity.sourceId),
              eq(workbenchThreadSource.role, "root"),
            ))
            .limit(1)
          const row = rows[0]
          if (!row) return null
          return {
            userId: row.userId,
            threadId: row.threadId,
            sourceType: identity.sourceType,
            sourceId: row.sourceId,
            role: "root",
          }
        },

        async findThreadById(id) {
          const rows = await databaseTransaction.select({
            id: workbenchThread.id,
            userId: workbenchThread.userId,
            projectId: workbenchThread.projectId,
            title: workbenchThread.title,
            createdAt: workbenchThread.createdAt,
            updatedAt: workbenchThread.updatedAt,
          }).from(workbenchThread).where(eq(workbenchThread.id, id)).limit(1)
          return rows[0] ?? null
        },

        async insertThreadWithRoot(value) {
          const insertedThread = await databaseTransaction.insert(workbenchThread)
            .values(value.thread)
            .onConflictDoNothing()
            .returning({ id: workbenchThread.id })
          if (insertedThread.length !== 1) return "THREAD_ID_CONFLICT"

          const insertedRoot = await databaseTransaction.insert(workbenchThreadSource)
            .values(value.root)
            .onConflictDoNothing()
            .returning({ id: workbenchThreadSource.id })
          if (insertedRoot.length === 1) return "CREATED"

          // A concurrent owner of the globally unique tenant+root identity won.
          // Remove this transaction's unbound candidate before classification.
          await databaseTransaction.delete(workbenchThread).where(and(
            eq(workbenchThread.id, value.thread.id),
            eq(workbenchThread.userId, value.thread.userId),
          ))
          return "ROOT_CONFLICT"
        },
      }

      return operation(transaction)
    })
  },
}

export async function registerWorkbenchThreadAction(
  input: ActionInput,
): Promise<RegisterWorkbenchThreadResult> {
  const userId = await getUserId()
  return registerWorkbenchThread({ ...input, userId }, { store, generateOpaqueId: randomUUID })
}
