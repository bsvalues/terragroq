"use server"

import { db } from "@/lib/db"
import { doctrine } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, asc, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getDoctrine() {
  const userId = await getUserId()
  return db
    .select()
    .from(doctrine)
    .where(eq(doctrine.userId, userId))
    .orderBy(desc(doctrine.priority), asc(doctrine.createdAt))
}

export async function createDoctrine(input: {
  title: string
  statement: string
  category?: string
  priority?: number
}) {
  const userId = await getUserId()
  if (!input.title.trim() || !input.statement.trim()) throw new Error("Title and statement are required")

  const [row] = await db
    .insert(doctrine)
    .values({
      userId,
      title: input.title.trim(),
      statement: input.statement.trim(),
      category: input.category ?? "principle",
      priority: input.priority ?? 0,
    })
    .returning()

  await logEvent({
    userId,
    type: "doctrine.created",
    summary: `Added doctrine: ${row.title}`,
    register: "doctrine",
    refId: row.id,
  })

  revalidatePath("/doctrine")
  revalidatePath("/")
  return row
}

export async function toggleDoctrine(id: number, active: boolean) {
  const userId = await getUserId()
  await db
    .update(doctrine)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  revalidatePath("/doctrine")
}

export async function deleteDoctrine(id: number) {
  const userId = await getUserId()
  await db.delete(doctrine).where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  revalidatePath("/doctrine")
}

// Active doctrine used to govern the chat system prompt.
export async function getActiveDoctrine(userId: string) {
  return db
    .select()
    .from(doctrine)
    .where(and(eq(doctrine.userId, userId), eq(doctrine.active, true)))
    .orderBy(desc(doctrine.priority))
}
