"use server"

import { db } from "@/lib/db"
import { memoryFact } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { embedText, toVectorLiteral } from "@/lib/ai/embeddings"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getMemoryFacts() {
  const userId = await getUserId()
  return db
    .select()
    .from(memoryFact)
    .where(eq(memoryFact.userId, userId))
    .orderBy(desc(memoryFact.pinned), desc(memoryFact.createdAt))
}

export async function createMemoryFact(input: {
  content: string
  kind?: string
  source?: string
  confidence?: string
  tags?: string[]
  pinned?: boolean
}) {
  const userId = await getUserId()
  const content = input.content.trim()
  if (!content) throw new Error("Content is required")

  const embedding = await embedText(content)

  const [row] = await db
    .insert(memoryFact)
    .values({
      userId,
      content,
      kind: input.kind ?? "fact",
      source: input.source,
      confidence: input.confidence ?? "medium",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      embedding,
    })
    .returning()

  await logEvent({
    userId,
    type: "memory.created",
    summary: `Captured memory: ${content.slice(0, 80)}`,
    register: "memory",
    refId: row.id,
  })

  revalidatePath("/memory")
  revalidatePath("/")
  return row
}

export async function togglePinMemory(id: number, pinned: boolean) {
  const userId = await getUserId()
  await db
    .update(memoryFact)
    .set({ pinned, updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
  revalidatePath("/memory")
}

export async function deleteMemoryFact(id: number) {
  const userId = await getUserId()
  await db.delete(memoryFact).where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
  await logEvent({ userId, type: "memory.deleted", summary: `Deleted memory #${id}`, register: "memory", refId: id })
  revalidatePath("/memory")
}

// Semantic recall used by the governed chat.
export async function searchMemory(userId: string, query: string, limit = 5) {
  const queryEmbedding = await embedText(query)
  const literal = toVectorLiteral(queryEmbedding)

  const rows = await db
    .select({
      id: memoryFact.id,
      content: memoryFact.content,
      kind: memoryFact.kind,
      confidence: memoryFact.confidence,
      similarity: sql<number>`1 - (${memoryFact.embedding} <=> ${literal}::vector)`,
    })
    .from(memoryFact)
    .where(eq(memoryFact.userId, userId))
    .orderBy(sql`${memoryFact.embedding} <=> ${literal}::vector`)
    .limit(limit)

  return rows
}
