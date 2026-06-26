"use server"

import { db } from "@/lib/db"
import { parkedIdea, type ParkedIdea } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { nextRef } from "@/lib/governance/refs"
import { createDecision } from "@/app/actions/decisions"
import { createWorkOrder } from "@/app/actions/work-orders"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getParkedIdeas(limit = 100): Promise<ParkedIdea[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(parkedIdea)
    .where(eq(parkedIdea.userId, userId))
    .orderBy(desc(parkedIdea.createdAt))
    .limit(limit)
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface ParkIdeaInput {
  idea: string
  lane?: string
  whyItMatters?: string
  whyNotNow?: string
  maturity?: string
  unlockCondition?: string
  promoteRequires?: string
}

// Capture vision without activating it. A parked idea is inert — it cannot spawn
// loops or work until it is explicitly promoted through a decision record.
export async function parkIdea(input: ParkIdeaInput): Promise<ParkedIdea> {
  const userId = await getUserId()
  const ref = await nextRef(parkedIdea as never, "IDEA", userId)
  const [row] = await db
    .insert(parkedIdea)
    .values({
      userId,
      ref,
      idea: input.idea,
      lane: input.lane ?? null,
      whyItMatters: input.whyItMatters ?? null,
      whyNotNow: input.whyNotNow ?? null,
      maturity: input.maturity ?? "seed",
      unlockCondition: input.unlockCondition ?? null,
      promoteRequires: input.promoteRequires ?? null,
      status: "parked",
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "IDEA_PARKED",
    entityType: "parked_idea",
    entityId: row.id,
    reason: input.whyNotNow,
    after: { idea: input.idea, status: "parked" },
  })
  await logEvent({
    userId,
    type: "idea.parked",
    summary: `${ref}: parked — ${input.idea}`,
    register: "vault",
    refId: row.id,
  })
  revalidatePath("/goal-console")
  return row
}

// Promote a parked idea into active work. This REQUIRES a decision record — the
// only legitimate path out of the vault — and produces a draft work order.
export async function promoteIdea(
  id: number,
  input: { decisionRationale: string; whatItUnlocks?: string },
): Promise<{ ok: boolean; reason: string; workOrderId?: number }> {
  const userId = await getUserId()
  const [idea] = await db
    .select()
    .from(parkedIdea)
    .where(and(eq(parkedIdea.id, id), eq(parkedIdea.userId, userId)))
    .limit(1)
  if (!idea) throw new Error("Parked idea not found")
  if (idea.status !== "parked") return { ok: false, reason: `Idea is already ${idea.status}.` }
  if (!input.decisionRationale.trim() || input.decisionRationale.trim().length < 8) {
    return { ok: false, reason: "Promotion requires a substantive decision rationale." }
  }

  // 1. Mint the decision record that authorizes leaving the vault.
  const decision = await createDecision({
    title: `Promote parked idea ${idea.ref ?? `#${id}`}`,
    context: `Idea: ${idea.idea}\nWhy it matters: ${idea.whyItMatters ?? "(n/a)"}\nWhy it was parked: ${idea.whyNotNow ?? "(n/a)"}`,
    decision: `Promote "${idea.idea}" out of the Not-Now Vault into a draft work order.`,
    rationale: input.decisionRationale,
    consequences: input.whatItUnlocks ? `Unlocks: ${input.whatItUnlocks}` : undefined,
    status: "accepted",
    authority: "binding",
  })

  // 2. Produce a draft work order (no authority — stays a draft).
  const wo = await createWorkOrder({
    title: idea.idea,
    goal: idea.whyItMatters ?? idea.idea,
    lane: idea.lane ?? undefined,
    linkedDecisionId: decision.id,
  })

  // 3. Mark the idea promoted and link the WO.
  await db
    .update(parkedIdea)
    .set({ status: "promoted", promotedWorkOrderId: wo.id, updatedAt: new Date() })
    .where(and(eq(parkedIdea.id, id), eq(parkedIdea.userId, userId)))

  await appendGovernanceEvent({
    userId,
    eventType: "IDEA_PROMOTED",
    entityType: "parked_idea",
    entityId: id,
    reason: input.decisionRationale,
    before: { status: "parked" },
    after: { status: "promoted", workOrderId: wo.id, decisionId: decision.id },
  })
  await logEvent({
    userId,
    type: "idea.promoted",
    summary: `${idea.ref ?? `#${id}`}: promoted → ${wo.ref ?? `WO #${wo.id}`} (via ${decision.ref ?? `decision #${decision.id}`})`,
    register: "vault",
    refId: id,
  })
  revalidatePath("/goal-console")
  return { ok: true, reason: "Idea promoted to a draft work order.", workOrderId: wo.id }
}

export async function dropIdea(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .update(parkedIdea)
    .set({ status: "dropped", updatedAt: new Date() })
    .where(and(eq(parkedIdea.id, id), eq(parkedIdea.userId, userId)))
  revalidatePath("/goal-console")
}
