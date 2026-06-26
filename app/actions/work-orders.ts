"use server"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getWorkOrders() {
  const userId = await getUserId()
  return db.select().from(workOrder).where(eq(workOrder.userId, userId)).orderBy(desc(workOrder.createdAt))
}

export async function createWorkOrder(input: {
  title: string
  description?: string
  priority?: string
  assignee?: string
  linkedDecisionId?: number
}) {
  const userId = await getUserId()
  if (!input.title.trim()) throw new Error("Title is required")

  const [row] = await db
    .insert(workOrder)
    .values({
      userId,
      title: input.title.trim(),
      description: input.description,
      priority: input.priority ?? "medium",
      assignee: input.assignee,
      linkedDecisionId: input.linkedDecisionId,
    })
    .returning()

  await logEvent({
    userId,
    type: "work_order.created",
    summary: `Opened work order: ${row.title}`,
    register: "work_orders",
    refId: row.id,
  })

  revalidatePath("/work-orders")
  revalidatePath("/")
  return row
}

export async function updateWorkOrderStatus(id: number, status: string) {
  const userId = await getUserId()
  await db
    .update(workOrder)
    .set({
      status,
      completedAt: status === "done" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))

  await logEvent({
    userId,
    type: "work_order.status",
    summary: `Work order #${id} -> ${status}`,
    register: "work_orders",
    refId: id,
  })
  revalidatePath("/work-orders")
  revalidatePath("/")
}

export async function deleteWorkOrder(id: number) {
  const userId = await getUserId()
  await db.delete(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  revalidatePath("/work-orders")
}
