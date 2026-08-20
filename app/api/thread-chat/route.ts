import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { and, asc, eq } from "drizzle-orm"

import { getUserId } from "@/lib/session"
import { db } from "@/lib/db"
import { project, workbenchThread, workbenchThreadMessage } from "@/lib/db/schema"
import { CHAT_MODEL } from "@/lib/ai/config"
import { williamosInference } from "@/lib/ai/provider"
import {
  appendThreadMessage,
  buildThreadSystemPrompt,
  listThreadConversation,
  THREAD_MESSAGE_LIMIT,
  type ThreadConversationRepository,
  type ThreadMessage,
} from "@/lib/workbench/thread-conversation"

// A local model composing a considered reply can exceed a polite web timeout; the conversation is
// worth the wait, and the client streams tokens as they come.
export const maxDuration = 120

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

  async insertMessage(userId, message) {
    await db.insert(workbenchThreadMessage).values({
      id: message.id,
      userId,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })
  },

  async touchThread(userId, threadId) {
    await db
      .update(workbenchThread)
      .set({ updatedAt: new Date() })
      .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.id, threadId)))
  },
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user")
  if (!last?.parts) return ""
  return last.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
}

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400 })
  }
  const threadId = typeof (body as { threadId?: unknown })?.threadId === "string" ? (body as { threadId: string }).threadId : null
  const messages = Array.isArray((body as { messages?: unknown })?.messages)
    ? ((body as { messages: UIMessage[] }).messages)
    : null
  if (!threadId || !messages) return Response.json({ error: "INVALID_BODY" }, { status: 400 })

  const thread = await repository.getThread(userId, threadId)
  if (!thread) return Response.json({ error: "THREAD_NOT_FOUND" }, { status: 404 })
  const projectRow = await repository.getProject(userId, thread.projectId)

  const ownerText = lastUserText(messages)
  if (!ownerText.trim()) return Response.json({ error: "MESSAGE_EMPTY" }, { status: 400 })

  // The owner's words persist before any model runs: a reply that fails must never cost the message.
  await appendThreadMessage({ repository, userId, threadId, role: "owner", content: ownerText })

  // History comes from what is persisted, so the conversation survives reloads and other devices see
  // the same thread. The client's transient view is not the source of truth; this table is.
  const history = await listThreadConversation({ repository, userId, threadId })
  const modelMessages: UIMessage[] = history.slice(-THREAD_MESSAGE_LIMIT).map((message) => ({
    id: message.id,
    role: message.role === "owner" ? "user" : "assistant",
    parts: [{ type: "text", text: message.content }],
  }))

  let result
  try {
    result = streamText({
      model: williamosInference(CHAT_MODEL),
      system: buildThreadSystemPrompt({
        projectName: projectRow?.name ?? "this project",
        threadTitle: thread.title,
      }),
      messages: await convertToModelMessages(modelMessages),
      onFinish: async ({ text }) => {
        const reply = text.trim()
        if (!reply) return
        try {
          await appendThreadMessage({ repository, userId, threadId, role: "williamos", content: reply })
        } catch {
          // Persistence of the reply is best effort inside the stream teardown; the owner's message
          // and the streamed text already reached them, and the next turn re-reads persisted history.
        }
      },
    })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Conversation runtime unavailable", { status: 502 })
  }

  return result.toUIMessageStreamResponse()
}
