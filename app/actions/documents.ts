"use server"

import { db } from "@/lib/db"
import { document, documentChunk, eventLog, project, workbenchThread } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import {
  chunkText,
  embedTexts,
  embedText,
  toVectorLiteral,
} from "@/lib/ai/embeddings"
import { logEvent } from "@/lib/registers/events"
import {
  assertGenericDocumentDeletionAllowed,
  assertHistoricalProjectContextReplay,
  buildHistoricalProjectContextArchiveUpdate,
  buildHistoricalProjectContextInsert,
  getHistoricalProjectContextCandidate,
  getHistoricalProjectContextCatalog,
} from "@/lib/history/historical-project-context"
import { and, desc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getDocuments() {
  const userId = await getUserId()
  return db
    .select()
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.status, "indexed")))
    .orderBy(desc(document.createdAt))
}

// Historical context is authenticated and explicitly scoped. It is never a
// general corpus read and is not consumed by chat retrieval.
export async function getHistoricalProjectContext(projectKey: string, threadId?: string) {
  const userId = await getUserId()
  const [targetProject] = await db
    .select()
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.key, projectKey)))
  if (!targetProject) {
    throw new Error(`HISTORICAL_PROJECT_CONTEXT_PROJECT_NOT_FOUND:${projectKey}`)
  }

  if (threadId !== undefined) {
    const [thread] = await db
      .select()
      .from(workbenchThread)
      .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.id, threadId)))
    if (!thread) throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_NOT_FOUND:${threadId}`)
    if (thread.projectId !== targetProject.id) {
      throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_SCOPE_MISMATCH:${threadId}`)
    }
  }

  const rows = await db
    .select()
    .from(document)
    .where(and(
      eq(document.userId, userId),
      eq(document.projectId, targetProject.id),
    ))
  const byCandidateId = new Map(
    rows
      .filter((row) => row.historicalCandidateId !== null)
      .filter((row) => threadId === undefined || row.threadId === null || row.threadId === threadId)
      .map((row) => [row.historicalCandidateId, row]),
  )

  return getHistoricalProjectContextCatalog().flatMap((candidate) => {
    if (candidate.targetProjectKey !== projectKey) return []
    const row = byCandidateId.get(candidate.candidateId)
    if (!row) return []
    return [assertHistoricalProjectContextReplay(row, candidate, {
      userId,
      projectId: targetProject.id,
      threadId: row.threadId,
    })]
  })
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

export async function promoteHistoricalProjectContext(candidateId: string, threadId?: string) {
  const userId = await getUserId()
  const candidate = getHistoricalProjectContextCandidate(candidateId)
  const boundThreadId = threadId ?? null
  const result = await db.transaction(async (transaction) => {
    const [targetProject] = await transaction
      .select()
      .from(project)
      .where(and(
        eq(project.userId, userId),
        eq(project.key, candidate.targetProjectKey),
      ))
    if (!targetProject) {
      throw new Error(`HISTORICAL_PROJECT_CONTEXT_PROJECT_NOT_FOUND:${candidate.targetProjectKey}`)
    }

    if (threadId !== undefined) {
      const [thread] = await transaction
        .select()
        .from(workbenchThread)
        .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.id, threadId)))
      if (!thread) throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_NOT_FOUND:${threadId}`)
      if (thread.projectId !== targetProject.id) {
        throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_SCOPE_MISMATCH:${threadId}`)
      }
    }

    const [existing] = await transaction
      .select()
      .from(document)
      .where(and(
        eq(document.userId, userId),
        eq(document.historicalCandidateId, candidateId),
      ))
    if (existing) {
      return {
        row: assertHistoricalProjectContextReplay(existing, candidate, {
          userId,
          projectId: targetProject.id,
          threadId: boundThreadId,
        }),
        replayed: true,
      }
    }

    const [created] = await transaction
      .insert(document)
      .values(buildHistoricalProjectContextInsert(
        userId,
        targetProject.id,
        candidate,
        boundThreadId,
      ))
      .onConflictDoNothing()
      .returning()

    if (!created) {
      const [replay] = await transaction
        .select()
        .from(document)
        .where(and(
          eq(document.userId, userId),
          eq(document.historicalCandidateId, candidateId),
        ))
      if (!replay) throw new Error(`HISTORICAL_PROJECT_CONTEXT_PROMOTION_CONFLICT:${candidateId}`)
      return {
        row: assertHistoricalProjectContextReplay(replay, candidate, {
          userId,
          projectId: targetProject.id,
          threadId: boundThreadId,
        }),
        replayed: true,
      }
    }

    await transaction.insert(eventLog).values({
      userId,
      type: "document.historical_project_context_created",
      summary: `Recorded non-authoritative private Project context ${candidate.claimId}`,
      register: "corpus",
      refId: created.id,
      metadata: {
        candidateId: candidate.candidateId,
        projectKey: candidate.targetProjectKey,
        threadId: boundThreadId,
      },
    })
    return { row: created, replayed: false }
  })
  return result
}

export async function archiveHistoricalProjectContext(candidateId: string) {
  const userId = await getUserId()
  const candidate = getHistoricalProjectContextCandidate(candidateId)
  return db.transaction(async (transaction) => {
    const [targetProject] = await transaction
      .select()
      .from(project)
      .where(and(
        eq(project.userId, userId),
        eq(project.key, candidate.targetProjectKey),
      ))
    if (!targetProject) {
      throw new Error(`HISTORICAL_PROJECT_CONTEXT_PROJECT_NOT_FOUND:${candidate.targetProjectKey}`)
    }

    const [existing] = await transaction
      .select()
      .from(document)
      .where(and(
        eq(document.userId, userId),
        eq(document.historicalCandidateId, candidateId),
      ))
    if (!existing) throw new Error(`HISTORICAL_PROJECT_CONTEXT_NOT_FOUND:${candidateId}`)
    assertHistoricalProjectContextReplay(existing, candidate, {
      userId,
      projectId: targetProject.id,
      threadId: existing.threadId,
    })

    if (existing.threadId !== null) {
      const [thread] = await transaction
        .select()
        .from(workbenchThread)
        .where(and(eq(workbenchThread.userId, userId), eq(workbenchThread.id, existing.threadId)))
      if (!thread) {
        throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_NOT_FOUND:${existing.threadId}`)
      }
      if (thread.projectId !== targetProject.id) {
        throw new Error(`HISTORICAL_PROJECT_CONTEXT_THREAD_SCOPE_MISMATCH:${existing.threadId}`)
      }
    }

    const update = buildHistoricalProjectContextArchiveUpdate(existing)
    if (!update) return { row: existing, replayed: true }

    const [archived] = await transaction
      .update(document)
      .set({ ...update, updatedAt: new Date() })
      .where(and(
        eq(document.userId, userId),
        eq(document.historicalCandidateId, candidateId),
        eq(document.status, "private_project_context"),
      ))
      .returning()
    if (!archived) {
      const [replay] = await transaction
        .select()
        .from(document)
        .where(and(
          eq(document.userId, userId),
          eq(document.historicalCandidateId, candidateId),
        ))
      if (!replay) throw new Error(`HISTORICAL_PROJECT_CONTEXT_ARCHIVE_CONFLICT:${candidateId}`)
      assertHistoricalProjectContextReplay(replay, candidate, {
        userId,
        projectId: targetProject.id,
        threadId: replay.threadId,
      })
      if (replay.status !== "archived_private_project_context") {
        throw new Error(`HISTORICAL_PROJECT_CONTEXT_ARCHIVE_CONFLICT:${candidateId}`)
      }
      return { row: replay, replayed: true }
    }

    await transaction.insert(eventLog).values({
      userId,
      type: "document.historical_project_context_archived",
      summary: `Archived non-authoritative private Project context ${candidate.claimId}`,
      register: "corpus",
      refId: archived.id,
      metadata: { candidateId: candidate.candidateId },
    })
    return { row: archived, replayed: false }
  })
}

export async function deleteDocument(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, userId)))
  if (row) assertGenericDocumentDeletionAllowed(row)
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
    .where(and(
      eq(documentChunk.userId, userId),
      eq(document.userId, userId),
      eq(document.status, "indexed"),
    ))
    .orderBy(sql`${documentChunk.embedding} <=> ${literal}::vector`)
    .limit(limit)
}
