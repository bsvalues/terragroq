"use server"

import { db } from "@/lib/db"
import { document, documentChunk } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import {
  chunkText,
  embedTexts,
  embedText,
  toVectorLiteral,
} from "@/lib/ai/embeddings"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getDocuments() {
  const userId = await getUserId()
  return db
    .select()
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.createdAt))
}

export async function ingestDocument(input: {
  title: string
  content: string
  source?: string
}) {
  const userId = await getUserId()
  const chunks = chunkText(input.content)
  const embeddings = await embedTexts(chunks)

  const [doc] = await db
    .insert(document)
    .values({
      userId,
      title: input.title,
      content: input.content,
      source: input.source ?? null,
      chunkCount: chunks.length,
      status: "indexed",
    })
    .returning()

  if (chunks.length > 0) {
    await db.insert(documentChunk).values(
      chunks.map((chunk, i) => ({
        userId,
        documentId: doc.id,
        chunkIndex: i,
        content: chunk,
        embedding: embeddings[i],
      })),
    )
  }

  await logEvent({
    userId,
    type: "document.ingested",
    summary: `Ingested "${input.title}" (${chunks.length} chunks)`,
    register: "corpus",
    refId: doc.id,
  })
  revalidatePath("/corpus")
  return doc
}

export async function deleteDocument(id: number) {
  const userId = await getUserId()
  await db
    .delete(documentChunk)
    .where(and(eq(documentChunk.documentId, id), eq(documentChunk.userId, userId)))
  await db
    .delete(document)
    .where(and(eq(document.id, id), eq(document.userId, userId)))
  await logEvent({
    userId,
    type: "document.deleted",
    summary: `Removed document #${id}`,
    register: "corpus",
    refId: id,
  })
  revalidatePath("/corpus")
}

// Vector search over chunks, used by the governed chat for citations.
export async function searchCorpus(userId: string, query: string, limit = 5) {
  const embedding = await embedText(query)
  const literal = toVectorLiteral(embedding)
  return db
    .select({
      chunkId: documentChunk.id,
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
