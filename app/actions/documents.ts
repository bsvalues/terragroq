"use server"

import { db } from "@/lib/db"
import { document, documentChunk } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { chunkText, embedTexts, embedText, toVectorLiteral } from "@/lib/ai/embeddings"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getDocuments() {
  const userId = await getUserId()
  return db
    .select({
      id: document.id,
      title: document.title,
      source: document.source,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      status: document.status,
      createdAt: document.createdAt,
    })
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.createdAt))
}

export async function ingestDocument(input: { title: string; content: string; source?: string }) {
  const userId = await getUserId()
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) throw new Error("Title and content are required")

  const [doc] = await db
    .insert(document)
    .values({ userId, title, content, source: input.source, status: "indexing" })
    .returning()

  const chunks = chunkText(content)
  if (chunks.length > 0) {
    const embeddings = await embedTexts(chunks)
    await db.insert(documentChunk).values(
      chunks.map((c, i) => ({
        userId,
        documentId: doc.id,
        chunkIndex: i,
        content: c,
        embedding: embeddings[i],
      })),
    )
  }

  await db
    .update(document)
    .set({ chunkCount: chunks.length, status: "indexed", updatedAt: new Date() })
    .where(and(eq(document.id, doc.id), eq(document.userId, userId)))

  await logEvent({
    userId,
    type: "document.ingested",
    summary: `Indexed "${title}" (${chunks.length} chunks)`,
    register: "documents",
    refId: doc.id,
  })

  revalidatePath("/documents")
  revalidatePath("/")
  return { id: doc.id, chunkCount: chunks.length }
}

export async function deleteDocument(id: number) {
  const userId = await getUserId()
  await db.delete(documentChunk).where(and(eq(documentChunk.documentId, id), eq(documentChunk.userId, userId)))
  await db.delete(document).where(and(eq(document.id, id), eq(document.userId, userId)))
  await logEvent({ userId, type: "document.deleted", summary: `Removed document #${id}`, register: "documents", refId: id })
  revalidatePath("/documents")
}

// Vector retrieval used by the governed chat.
export async function searchDocuments(userId: string, query: string, limit = 6) {
  const queryEmbedding = await embedText(query)
  const literal = toVectorLiteral(queryEmbedding)

  return db
    .select({
      id: documentChunk.id,
      documentId: documentChunk.documentId,
      content: documentChunk.content,
      title: document.title,
      source: document.source,
      similarity: sql<number>`1 - (${documentChunk.embedding} <=> ${literal}::vector)`,
    })
    .from(documentChunk)
    .innerJoin(document, eq(document.id, documentChunk.documentId))
    .where(eq(documentChunk.userId, userId))
    .orderBy(sql`${documentChunk.embedding} <=> ${literal}::vector`)
    .limit(limit)
}
