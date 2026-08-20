"use server"

import { and, asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { project, workbenchThread, workbenchThreadMessage } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import {
  listThreadConversation,
  type ThreadConversationRepository,
  type ThreadMessage,
} from "@/lib/workbench/thread-conversation"

const repository: ThreadConversationRepository = {
  async getThread(userId, threadId) {
    const rows = await db
      .select({
        id: workbenchThread.id,
        userId: workbenchThread.userId,
        projectId: workbenchThread.projectId,
        title: workbenchThread.title,
      })
      .from(workbenchThread)
      .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.id, threadId)))
      .limit(1)
    return rows[0] ?? null
  },

  async getProject(userId, projectId) {
    const rows = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.userId, userId), eq(project.id, projectId)))
      .limit(1)
    return rows[0] ?? null
  },

  async listMessages(userId, threadId, limit) {
    const rows = await db
      .select({
        id: workbenchThreadMessage.id,
        threadId: workbenchThreadMessage.threadId,
        role: workbenchThreadMessage.role,
        content: workbenchThreadMessage.content,
        createdAt: workbenchThreadMessage.createdAt,
      })
      .from(workbenchThreadMessage)
      .where(and(eq(workbenchThreadMessage.userId, userId), eq(workbenchThreadMessage.threadId, threadId)))
      .orderBy(asc(workbenchThreadMessage.createdAt), asc(workbenchThreadMessage.id))
      .limit(limit)
    return rows as ThreadMessage[]
  },

  async insertMessage() {
    throw new Error("READ_ONLY_ACTION")
  },

  async touchThread() {
    throw new Error("READ_ONLY_ACTION")
  },
}

export type ThreadConversationEntry = Readonly<{
  id: string
  role: "owner" | "williamos"
  content: string
  createdAt: string
}>

/** The persisted conversation of one owned Thread, oldest first. Writing goes through the chat API. */
export async function getThreadConversation(threadId: string): Promise<ThreadConversationEntry[]> {
  // The whole body fails closed to an empty history -- including session resolution, which throws
  // outside a real request scope (jsdom renders of the shell). A missing history renders the empty
  // state; it must never reject into the component as an unhandled rejection.
  try {
    const userId = await getUserId()
    if (!userId) return []
    const messages = await listThreadConversation({ repository, userId, threadId })
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    }))
  } catch {
    return []
  }
}
