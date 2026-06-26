"use server"

import { db } from "@/lib/db"
import { memoryFact } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { embedText, toVectorLiteral } from "@/lib/ai/embeddings"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Authority lifecycle                                                 */
/* ------------------------------------------------------------------ */

// Ordered authority states. Promotion may only advance toward canon from a
// reviewed state; demotion returns canon facts to working memory.
const AUTHORITY_STATES = [
  "intake",
  "unreviewed",
  "working",
  "reviewed",
  "canon",
  "deprecated",
  "superseded",
  "archived",
] as const

type Authority = (typeof AUTHORITY_STATES)[number]

// States excluded from semantic recall — they are no longer trustworthy canon.
const NON_RECALLABLE: Authority[] = ["deprecated", "superseded", "archived"]

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getMemoryFacts() {
  const userId = await getUserId()
  return db
    .select()
    .from(memoryFact)
    .where(eq(memoryFact.userId, userId))
    .orderBy(desc(memoryFact.pinned), desc(memoryFact.createdAt))
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createMemoryFact(input: {
  content: string
  kind?: string
  source?: string
  confidence?: string
  tags?: string[]
  pinned?: boolean
}) {
  const userId = await getUserId()
  const embedding = await embedText(input.content)

  const [row] = await db
    .insert(memoryFact)
    .values({
      userId,
      content: input.content,
      kind: input.kind ?? "fact",
      source: input.source ?? null,
      confidence: input.confidence ?? "medium",
      // New captures always enter as unreviewed intake — never canon by default.
      authority: "unreviewed",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      embedding,
    })
    .returning()

  await logEvent({
    userId,
    type: "memory.created",
    summary: `Committed memory (unreviewed): ${input.content.slice(0, 80)}`,
    register: "memory",
    refId: row.id,
  })
  revalidatePath("/memory")
  return row
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

export async function updateMemoryFact(
  id: number,
  input: {
    content?: string
    kind?: string
    confidence?: string
    source?: string | null
    tags?: string[]
  },
) {
  const userId = await getUserId()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.confidence !== undefined) patch.confidence = input.confidence
  if (input.source !== undefined) patch.source = input.source
  if (input.tags !== undefined) patch.tags = input.tags

  // Re-embed when the content itself changes so recall stays accurate.
  if (input.content !== undefined) {
    patch.content = input.content
    patch.embedding = await embedText(input.content)
  }

  const [row] = await db
    .update(memoryFact)
    .set(patch)
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()

  await logEvent({
    userId,
    type: "memory.edited",
    summary: `Edited memory #${id}`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
  return row
}

/* ------------------------------------------------------------------ */
/* Governance transitions                                              */
/* ------------------------------------------------------------------ */

// Mark a fact reviewed — the prerequisite for canon promotion (evidence gate).
export async function reviewMemoryFact(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .update(memoryFact)
    .set({ authority: "reviewed", reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()
  await logEvent({
    userId,
    type: "memory.reviewed",
    summary: `Reviewed memory #${id}`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
  return row
}

// Approval-gated canon promotion: only a reviewed fact may become canon.
export async function promoteToCanon(id: number) {
  const userId = await getUserId()
  const [current] = await db
    .select()
    .from(memoryFact)
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .limit(1)

  if (!current) throw new Error("Fact not found")
  if (current.authority !== "reviewed") {
    throw new Error("Canon promotion requires a reviewed fact with evidence")
  }

  const [row] = await db
    .update(memoryFact)
    .set({ authority: "canon", reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()
  await logEvent({
    userId,
    type: "memory.promoted",
    summary: `Promoted memory #${id} to canon`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
  return row
}

// Demote canon back to working memory.
export async function demoteFromCanon(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .update(memoryFact)
    .set({ authority: "working", updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()
  await logEvent({
    userId,
    type: "memory.demoted",
    summary: `Demoted memory #${id} from canon`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
  return row
}

// Toggle the stale flag — a soft signal that a fact may be out of date.
export async function setMemoryStale(id: number, stale: boolean) {
  const userId = await getUserId()
  const [row] = await db
    .update(memoryFact)
    .set({ stale, updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()
  await logEvent({
    userId,
    type: stale ? "memory.staled" : "memory.unstaled",
    summary: `${stale ? "Marked" : "Cleared"} stale on memory #${id}`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
  return row
}

// Archive a fact — removes it from recall without destroying provenance.
export async function archiveMemoryFact(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .update(memoryFact)
    .set({ authority: "archived", updatedAt: new Date() })
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
    .returning()
  await logEvent({
    userId,
    type: "memory.archived",
    summary: `Archived memory #${id}`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
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
  await db
    .delete(memoryFact)
    .where(and(eq(memoryFact.id, id), eq(memoryFact.userId, userId)))
  await logEvent({
    userId,
    type: "memory.deleted",
    summary: `Removed memory #${id}`,
    register: "memory",
    refId: id,
  })
  revalidatePath("/memory")
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export async function exportMemory() {
  const userId = await getUserId()
  const rows = await db
    .select({
      id: memoryFact.id,
      content: memoryFact.content,
      kind: memoryFact.kind,
      authority: memoryFact.authority,
      confidence: memoryFact.confidence,
      stale: memoryFact.stale,
      tags: memoryFact.tags,
      source: memoryFact.source,
      pinned: memoryFact.pinned,
      reviewedAt: memoryFact.reviewedAt,
      lastUsedAt: memoryFact.lastUsedAt,
      createdAt: memoryFact.createdAt,
      updatedAt: memoryFact.updatedAt,
    })
    .from(memoryFact)
    .where(eq(memoryFact.userId, userId))
    .orderBy(desc(memoryFact.createdAt))

  await logEvent({
    userId,
    type: "memory.exported",
    summary: `Exported ${rows.length} memory facts`,
    register: "memory",
  })
  return {
    exportedAt: new Date().toISOString(),
    count: rows.length,
    facts: rows,
  }
}

/* ------------------------------------------------------------------ */
/* Authority-aware semantic recall (used by the governed chat)         */
/* ------------------------------------------------------------------ */

export async function searchMemory(userId: string, query: string, limit = 5) {
  const embedding = await embedText(query)
  const literal = toVectorLiteral(embedding)
  const rows = await db
    .select({
      id: memoryFact.id,
      content: memoryFact.content,
      kind: memoryFact.kind,
      authority: memoryFact.authority,
      confidence: memoryFact.confidence,
      stale: memoryFact.stale,
      similarity: sql<number>`1 - (${memoryFact.embedding} <=> ${literal}::vector)`,
    })
    .from(memoryFact)
    .where(
      and(
        eq(memoryFact.userId, userId),
        // Exclude deprecated / superseded / archived facts from recall.
        notInArray(memoryFact.authority, NON_RECALLABLE),
      ),
    )
    .orderBy(sql`${memoryFact.embedding} <=> ${literal}::vector`)
    .limit(limit)

  // Stamp last-used so memory rot (never-recalled facts) is visible.
  if (rows.length > 0) {
    await db
      .update(memoryFact)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(memoryFact.userId, userId),
          inArray(
            memoryFact.id,
            rows.map((r) => r.id),
          ),
        ),
      )
  }

  return rows
}
