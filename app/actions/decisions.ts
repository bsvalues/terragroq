"use server"

import { db } from "@/lib/db"
import { decision } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getDecisions() {
  const userId = await getUserId()
  return db.select().from(decision).where(eq(decision.userId, userId)).orderBy(desc(decision.createdAt))
}

export async function createDecision(input: {
  title: string
  context?: string
  decision: string
  rationale?: string
  consequences?: string
  status?: string
}) {
  const userId = await getUserId()
  if (!input.title.trim() || !input.decision.trim()) throw new Error("Title and decision are required")

  const [row] = await db
    .insert(decision)
    .values({
      userId,
      title: input.title.trim(),
      context: input.context,
      decision: input.decision.trim(),
      rationale: input.rationale,
      consequences: input.consequences,
      status: input.status ?? "proposed",
      decidedAt: input.status === "accepted" ? new Date() : null,
    })
    .returning()

  await logEvent({
    userId,
    type: "decision.created",
    summary: `Logged decision: ${row.title}`,
    register: "decisions",
    refId: row.id,
  })

  revalidatePath("/decisions")
  revalidatePath("/")
  return row
}

export async function updateDecisionStatus(id: number, status: string) {
  const userId = await getUserId()
  await db
    .update(decision)
    .set({ status, decidedAt: status === "accepted" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))

  await logEvent({
    userId,
    type: "decision.status",
    summary: `Decision #${id} -> ${status}`,
    register: "decisions",
    refId: id,
  })
  revalidatePath("/decisions")
  revalidatePath("/")
}

export async function deleteDecision(id: number) {
  const userId = await getUserId()
  await db.delete(decision).where(and(eq(decision.id, id), eq(decision.userId, userId)))
  revalidatePath("/decisions")
}
