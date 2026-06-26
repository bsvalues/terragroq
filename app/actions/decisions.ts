"use server"

import { db } from "@/lib/db"
import { decision, type Decision } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { and, desc, eq, ilike, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getDecisions() {
  const userId = await getUserId()
  return db
    .select()
    .from(decision)
    .where(eq(decision.userId, userId))
    .orderBy(desc(decision.createdAt))
}

export async function searchDecisions(term: string) {
  const userId = await getUserId()
  const q = `%${term}%`
  return db
    .select()
    .from(decision)
    .where(
      and(
        eq(decision.userId, userId),
        or(
          ilike(decision.title, q),
          ilike(decision.decision, q),
          ilike(decision.rationale, q),
          ilike(decision.scope, q),
        ),
      ),
    )
    .orderBy(desc(decision.createdAt))
}

// Active, accepted decisions — consumed by the agent context injector.
export async function getActiveDecisions(userId: string) {
  return db
    .select()
    .from(decision)
    .where(and(eq(decision.userId, userId), eq(decision.status, "accepted")))
    .orderBy(desc(decision.authority), desc(decision.createdAt))
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Compute the next ADR-style reference (ADR-0001, ADR-0002, …) per operator.
async function nextRef(userId: string): Promise<string> {
  const rows = await db
    .select({ ref: decision.ref })
    .from(decision)
    .where(eq(decision.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/ADR-(\d+)/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `ADR-${String(max + 1).padStart(4, "0")}`
}

function splitList(v?: string): string[] {
  if (!v) return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

export async function createDecision(input: {
  title: string
  context?: string
  decision: string
  rationale?: string
  consequences?: string
  status?: string
  authority?: string
  owner?: string
  scope?: string
  evidence?: string
  tags?: string
  reviewAt?: string
}): Promise<Decision> {
  const userId = await getUserId()
  const ref = await nextRef(userId)
  const status = input.status ?? "proposed"
  const [row] = await db
    .insert(decision)
    .values({
      userId,
      ref,
      title: input.title,
      context: input.context ?? null,
      decision: input.decision,
      rationale: input.rationale ?? null,
      consequences: input.consequences ?? null,
      status,
      authority: input.authority ?? "advisory",
      owner: input.owner?.trim() || "Bill",
      scope: input.scope ?? null,
      evidence: splitList(input.evidence),
      tags: splitList(input.tags),
      reviewAt: input.reviewAt ? new Date(input.reviewAt) : null,
      decidedAt: status === "accepted" ? new Date() : null,
    })
    .returning()

  await logEvent({
    userId,
    type: "decision.created",
    summary: `Logged ${ref}: ${input.title}`,
    register: "decisions",
    refId: row.id,
  })
  revalidatePath("/decisions")
  return row
}

export async function updateDecisionStatus(id: number, status: string) {
  const userId = await getUserId()
  await db
    .update(decision)
    .set({
      status,
      decidedAt: status === "accepted" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  await logEvent({
    userId,
    type: "decision.status",
    summary: `Decision #${id} -> ${status}`,
    register: "decisions",
    refId: id,
  })
  revalidatePath("/decisions")
}

export async function setDecisionAuthority(id: number, authority: string) {
  const userId = await getUserId()
  await db
    .update(decision)
    .set({ authority, updatedAt: new Date() })
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  await logEvent({
    userId,
    type: "decision.authority",
    summary: `Decision #${id} authority -> ${authority}`,
    register: "decisions",
    refId: id,
  })
  revalidatePath("/decisions")
}

export async function linkEvidence(id: number, evidence: string) {
  const userId = await getUserId()
  const [current] = await db
    .select({ evidence: decision.evidence })
    .from(decision)
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  if (!current) return
  const merged = Array.from(new Set([...current.evidence, ...splitList(evidence)]))
  await db
    .update(decision)
    .set({ evidence: merged, updatedAt: new Date() })
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  await logEvent({
    userId,
    type: "decision.evidence",
    summary: `Linked evidence to decision #${id}`,
    register: "decisions",
    refId: id,
  })
  revalidatePath("/decisions")
}

// Supersession: create a replacement decision and link both directions.
export async function supersedeDecision(
  oldId: number,
  input: {
    title: string
    decision: string
    rationale?: string
    context?: string
    consequences?: string
    authority?: string
    scope?: string
    evidence?: string
    tags?: string
  },
): Promise<Decision> {
  const userId = await getUserId()
  const [old] = await db
    .select()
    .from(decision)
    .where(and(eq(decision.id, oldId), eq(decision.userId, userId)))
  if (!old) throw new Error("Decision not found")

  const ref = await nextRef(userId)
  const [replacement] = await db
    .insert(decision)
    .values({
      userId,
      ref,
      title: input.title,
      context: input.context ?? null,
      decision: input.decision,
      rationale: input.rationale ?? null,
      consequences: input.consequences ?? null,
      status: "accepted",
      authority: input.authority ?? old.authority,
      owner: old.owner,
      scope: input.scope ?? old.scope,
      evidence: splitList(input.evidence),
      tags: splitList(input.tags),
      supersedesId: old.id,
      decidedAt: new Date(),
    })
    .returning()

  await db
    .update(decision)
    .set({
      status: "superseded",
      supersededById: replacement.id,
      updatedAt: new Date(),
    })
    .where(and(eq(decision.id, oldId), eq(decision.userId, userId)))

  await logEvent({
    userId,
    type: "decision.superseded",
    summary: `${old.ref ?? `#${old.id}`} superseded by ${ref}`,
    register: "decisions",
    refId: replacement.id,
    metadata: { supersedes: old.id },
  })
  revalidatePath("/decisions")
  return replacement
}

export async function deleteDecision(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .select({ locked: decision.locked })
    .from(decision)
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  if (row?.locked) {
    throw new Error("This is a locked governance decision and cannot be deleted.")
  }
  await db
    .delete(decision)
    .where(and(eq(decision.id, id), eq(decision.userId, userId)))
  revalidatePath("/decisions")
}

/* ------------------------------------------------------------------ */
/* Seed: the required governance decisions from the playbook          */
/* ------------------------------------------------------------------ */

const GOVERNANCE_SEEDS: Array<{
  title: string
  decision: string
  rationale: string
  authority: string
  scope: string
  evidence: string[]
  tags: string[]
}> = [
  {
    title: "Phase 6 remains intentionally blocked",
    decision: "Phase 6 proactive intelligence stays closed as an expansion gate.",
    rationale:
      "Phase 6 is not a production gap; it is an expansion gate that may only open after an explicit operator authorization packet.",
    authority: "binding",
    scope: "global",
    evidence: ["Playbook: Phase 6 Status", "Required phrase: Authorize Phase 6 proactive intelligence"],
    tags: ["phase6", "expansion-gate"],
  },
  {
    title: "Research Drop Zone is intake-only",
    decision: "Captured research is non-canon intake until explicitly reviewed.",
    rationale: "Unreviewed intake must be separated from canon to prevent memory rot.",
    authority: "binding",
    scope: "memory",
    evidence: ["Playbook: Final Product Definition #4"],
    tags: ["intake", "memory"],
  },
  {
    title: "External workers are proposal-only",
    decision: "External workers may propose; WilliamOS governs. No write/commit/promote authority.",
    rationale: "Authority must never silently expand to external workers.",
    authority: "binding",
    scope: "workers",
    evidence: ["Playbook: governing line", "Stop Conditions"],
    tags: ["workers", "delegation"],
  },
  {
    title: "v1.3.0 is the stable baseline",
    decision: "v1.3.0 is the stable local operator baseline tag and must not be moved.",
    rationale: "Baseline tags anchor recoverability and must remain immutable.",
    authority: "informational",
    scope: "release",
    evidence: ["v1.3.0 -> 2c44ff2a00bd28a312cd23b28a3011fa9261e20f"],
    tags: ["release", "baseline"],
  },
  {
    title: "v1.3.1 is the runtime-hardening tag",
    decision: "v1.3.1 is the local hardening tag for Ollama startup/runtime reliability; do not move it.",
    rationale: "Hardening tag records a known-good runtime state for rollback.",
    authority: "informational",
    scope: "release",
    evidence: ["v1.3.1 -> 4676792cf529bf211374a844e75b977b957509d1"],
    tags: ["release", "runtime"],
  },
  {
    title: "14B is the production default model",
    decision: "qwen2.5:14b-instruct-q4_K_M is the production default model.",
    rationale: "A single explicit production model keeps runtime behavior predictable and auditable.",
    authority: "binding",
    scope: "runtime",
    evidence: ["Playbook: Track A Current State"],
    tags: ["runtime", "model"],
  },
  {
    title: "7B is env override only",
    decision: "The 7B model is available only as an environment override / dev option.",
    rationale: "Smaller models must not silently replace the production default.",
    authority: "advisory",
    scope: "runtime",
    evidence: ["Playbook: Track A Current State"],
    tags: ["runtime", "model"],
  },
  {
    title: "Cloud fallback is disabled by default",
    decision: "Cloud and external runtimes stay disabled unless explicitly approved. No silent fallback.",
    rationale: "Local-first authority and provenance require that private vault content never leaves silently.",
    authority: "binding",
    scope: "runtime",
    evidence: ["Playbook: Forbidden Without New WO", "Stop Conditions"],
    tags: ["runtime", "local-first"],
  },
]

export async function seedGovernanceDecisions(): Promise<{ created: number }> {
  const userId = await getUserId()
  const existing = await db
    .select({ title: decision.title })
    .from(decision)
    .where(and(eq(decision.userId, userId), eq(decision.locked, true)))
  const have = new Set(existing.map((e) => e.title))

  let created = 0
  for (const seed of GOVERNANCE_SEEDS) {
    if (have.has(seed.title)) continue
    const ref = await nextRef(userId)
    const [row] = await db
      .insert(decision)
      .values({
        userId,
        ref,
        title: seed.title,
        decision: seed.decision,
        rationale: seed.rationale,
        status: "accepted",
        authority: seed.authority,
        owner: "Bill",
        scope: seed.scope,
        evidence: seed.evidence,
        tags: seed.tags,
        locked: true,
        decidedAt: new Date(),
      })
      .returning()
    await logEvent({
      userId,
      type: "decision.seeded",
      summary: `Seeded governance decision ${ref}: ${seed.title}`,
      register: "decisions",
      refId: row.id,
    })
    created++
  }
  revalidatePath("/decisions")
  return { created }
}
