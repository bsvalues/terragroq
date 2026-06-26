"use server"

import { db } from "@/lib/db"
import { workOrder } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getWorkOrders() {
  const userId = await getUserId()
  return db
    .select()
    .from(workOrder)
    .where(eq(workOrder.userId, userId))
    .orderBy(desc(workOrder.createdAt))
}

export async function createWorkOrder(input: {
  title: string
  description?: string
  priority?: string
  status?: string
  assignee?: string
}) {
  const userId = await getUserId()
  const [row] = await db
    .insert(workOrder)
    .values({
      userId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      status: input.status ?? "backlog",
      assignee: input.assignee ?? null,
    })
    .returning()

  await logEvent({
    userId,
    type: "work_order.created",
    summary: `Opened work order: ${input.title}`,
    register: "work-orders",
    refId: row.id,
  })
  revalidatePath("/work-orders")
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
    register: "work-orders",
    refId: id,
  })
  revalidatePath("/work-orders")
}

export async function deleteWorkOrder(id: number) {
  const userId = await getUserId()
  await db
    .delete(workOrder)
    .where(and(eq(workOrder.id, id), eq(workOrder.userId, userId)))
  revalidatePath("/work-orders")
}
