"use server"

import { db } from "@/lib/db"
import { doctrine } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import {
  assertGenericDoctrineMutationAllowed,
  assertHistoricalDoctrineReplay,
  buildHistoricalDoctrineArchiveUpdate,
  buildHistoricalDoctrineInsert,
  getHistoricalDoctrineCandidate,
  getHistoricalDoctrineCatalog,
} from "@/lib/history/historical-doctrine"
import { and, desc, eq, ilike, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getDoctrine() {
  const userId = await getUserId()
  return db
    .select()
    .from(doctrine)
    .where(eq(doctrine.userId, userId))
    .orderBy(desc(doctrine.priority), desc(doctrine.createdAt))
}

// Active doctrine injected into the governed chat system prompt.
export async function getActiveDoctrine(userId: string) {
  return db
    .select()
    .from(doctrine)
    .where(
      and(
        eq(doctrine.userId, userId),
        eq(doctrine.active, true),
        eq(doctrine.status, "active"),
      ),
    )
    .orderBy(desc(doctrine.priority))
}

export async function searchDoctrine(query: string) {
  const userId = await getUserId()
  if (!query.trim()) return getDoctrine()
  const q = `%${query.trim()}%`
  return db
    .select()
    .from(doctrine)
    .where(
      and(
        eq(doctrine.userId, userId),
        or(
          ilike(doctrine.title, q),
          ilike(doctrine.statement, q),
          ilike(doctrine.ref, q),
        ),
      ),
    )
    .orderBy(desc(doctrine.priority), desc(doctrine.createdAt))
}

// Historical inputs remain a separate, non-authoritative lifecycle even though
// Doctrine owns their durable records.
export async function getHistoricalDoctrineInputs() {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(doctrine)
    .where(eq(doctrine.userId, userId))
  const byCandidateId = new Map(
    rows
      .filter((row) => row.historicalCandidateId !== null)
      .map((row) => [row.historicalCandidateId, row]),
  )

  return getHistoricalDoctrineCatalog().flatMap((candidate) => {
    const row = byCandidateId.get(candidate.candidateId)
    return row ? [assertHistoricalDoctrineReplay(row, candidate)] : []
  })
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Allocate the next RULE-#### reference for this operator.
async function nextRuleRef(userId: string): Promise<string> {
  const rows = await db
    .select({ ref: doctrine.ref })
    .from(doctrine)
    .where(eq(doctrine.userId, userId))
  let max = 0
  for (const r of rows) {
    const m = r.ref?.match(/^RULE-(\d+)$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `RULE-${String(max + 1).padStart(4, "0")}`
}


/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

async function getHistoricalDoctrineRow(userId: string, candidateId: string) {
  const [row] = await db
    .select()
    .from(doctrine)
    .where(and(
      eq(doctrine.userId, userId),
      eq(doctrine.historicalCandidateId, candidateId),
    ))
  return row
}

export async function promoteHistoricalDoctrineInput(candidateId: string) {
  const userId = await getUserId()
  const candidate = getHistoricalDoctrineCandidate(candidateId)
  const existing = await getHistoricalDoctrineRow(userId, candidateId)
  if (existing) {
    return { row: assertHistoricalDoctrineReplay(existing, candidate), replayed: true }
  }

  const [created] = await db
    .insert(doctrine)
    .values(buildHistoricalDoctrineInsert(userId, candidate))
    .onConflictDoNothing()
    .returning()

  if (!created) {
    const replay = await getHistoricalDoctrineRow(userId, candidateId)
    if (!replay) throw new Error(`HISTORICAL_DOCTRINE_PROMOTION_CONFLICT:${candidateId}`)
    return { row: assertHistoricalDoctrineReplay(replay, candidate), replayed: true }
  }

  await logEvent({
    userId,
    type: "doctrine.historical_input_created",
    summary: `Recorded non-authoritative historical Doctrine input ${candidate.claimId}`,
    register: "doctrine",
    refId: created.id,
  })
  revalidatePath("/doctrine")
  return { row: created, replayed: false }
}

export async function archiveHistoricalDoctrineInput(candidateId: string) {
  const userId = await getUserId()
  const candidate = getHistoricalDoctrineCandidate(candidateId)
  const existing = await getHistoricalDoctrineRow(userId, candidateId)
  if (!existing) throw new Error(`HISTORICAL_DOCTRINE_NOT_FOUND:${candidateId}`)
  assertHistoricalDoctrineReplay(existing, candidate)

  const update = buildHistoricalDoctrineArchiveUpdate(existing)
  if (!update) return { row: existing, replayed: true }

  const [archived] = await db
    .update(doctrine)
    .set({ ...update, updatedAt: new Date() })
    .where(and(
      eq(doctrine.userId, userId),
      eq(doctrine.historicalCandidateId, candidateId),
      eq(doctrine.status, "historical_input"),
    ))
    .returning()

  if (!archived) {
    const replay = await getHistoricalDoctrineRow(userId, candidateId)
    if (!replay) throw new Error(`HISTORICAL_DOCTRINE_ARCHIVE_CONFLICT:${candidateId}`)
    assertHistoricalDoctrineReplay(replay, candidate)
    if (replay.status !== "historical_archived") {
      throw new Error(`HISTORICAL_DOCTRINE_ARCHIVE_CONFLICT:${candidateId}`)
    }
    return { row: replay, replayed: true }
  }

  await logEvent({
    userId,
    type: "doctrine.historical_input_archived",
    summary: `Archived non-authoritative historical Doctrine input ${candidate.claimId}`,
    register: "doctrine",
    refId: archived.id,
  })
  revalidatePath("/doctrine")
  return { row: archived, replayed: false }
}

export async function createDoctrine(input: {
  title: string
  statement: string
  category?: string
  scope?: string
  priority?: number
  allowed?: string[]
  forbidden?: string[]
  requiresApproval?: string[]
  evidence?: string[]
}) {
  const userId = await getUserId()
  const ref = await nextRuleRef(userId)
  const [row] = await db
    .insert(doctrine)
    .values({
      userId,
      ref,
      title: input.title,
      statement: input.statement,
      category: input.category ?? "principle",
      scope: input.scope ?? null,
      priority: input.priority ?? 0,
      allowed: input.allowed ?? [],
      forbidden: input.forbidden ?? [],
      requiresApproval: input.requiresApproval ?? [],
      evidence: input.evidence ?? [],
    })
    .returning()

  await logEvent({
    userId,
    type: "doctrine.created",
    summary: `Ratified doctrine ${ref}: ${input.title}`,
    register: "doctrine",
    refId: row.id,
  })
  revalidatePath("/doctrine")
  return row
}

export async function toggleDoctrine(id: number, active: boolean) {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(doctrine)
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  if (!row) return
  assertGenericDoctrineMutationAllowed(row)
  await db
    .update(doctrine)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  revalidatePath("/doctrine")
}

export async function linkDoctrineEvidence(id: number, evidence: string) {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(doctrine)
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  if (!row) throw new Error("Doctrine not found")
  assertGenericDoctrineMutationAllowed(row)
  const next = [...row.evidence, evidence.trim()].filter(Boolean)
  await db
    .update(doctrine)
    .set({ evidence: next, updatedAt: new Date() })
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  await logEvent({
    userId,
    type: "doctrine.evidence_linked",
    summary: `Linked evidence to ${row.ref ?? `#${id}`}`,
    register: "doctrine",
    refId: id,
  })
  revalidatePath("/doctrine")
}

// Supersede an existing rule with a new one, preserving lineage.
export async function supersedeDoctrine(
  oldId: number,
  input: {
    title: string
    statement: string
    category?: string
    scope?: string
    priority?: number
    allowed?: string[]
    forbidden?: string[]
    requiresApproval?: string[]
    evidence?: string[]
  },
) {
  const userId = await getUserId()
  const [old] = await db
    .select()
    .from(doctrine)
    .where(and(eq(doctrine.id, oldId), eq(doctrine.userId, userId)))
  if (!old) throw new Error("Doctrine not found")
  assertGenericDoctrineMutationAllowed(old)

  const ref = await nextRuleRef(userId)
  const [next] = await db
    .insert(doctrine)
    .values({
      userId,
      ref,
      title: input.title,
      statement: input.statement,
      category: input.category ?? old.category,
      scope: input.scope ?? old.scope,
      priority: input.priority ?? old.priority,
      allowed: input.allowed ?? old.allowed,
      forbidden: input.forbidden ?? old.forbidden,
      requiresApproval: input.requiresApproval ?? old.requiresApproval,
      evidence: input.evidence ?? [],
      supersedesId: oldId,
    })
    .returning()

  await db
    .update(doctrine)
    .set({
      status: "superseded",
      active: false,
      supersededById: next.id,
      updatedAt: new Date(),
    })
    .where(and(eq(doctrine.id, oldId), eq(doctrine.userId, userId)))

  await logEvent({
    userId,
    type: "doctrine.superseded",
    summary: `${ref} supersedes ${old.ref ?? `#${oldId}`}: ${input.title}`,
    register: "doctrine",
    refId: next.id,
  })
  revalidatePath("/doctrine")
  return next
}

export async function deleteDoctrine(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(doctrine)
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  if (row) assertGenericDoctrineMutationAllowed(row)
  if (row?.locked) {
    throw new Error("Locked governance doctrine cannot be deleted; supersede it instead")
  }
  await db
    .delete(doctrine)
    .where(and(eq(doctrine.id, id), eq(doctrine.userId, userId)))
  revalidatePath("/doctrine")
}

/* ------------------------------------------------------------------ */
/* Enforcement                                                        */
/* ------------------------------------------------------------------ */

export type DoctrineVerdict = {
  verdict: "allowed" | "forbidden" | "requires_approval" | "unspecified"
  matches: { ref: string | null; title: string; reason: string }[]
}

// Validate a free-text action description against active doctrine. Forbidden
// wins over requires-approval, which wins over explicitly allowed.
export async function validateAction(action: string): Promise<DoctrineVerdict> {
  const userId = await getUserId()
  const rules = await getActiveDoctrine(userId)
  const text = action.toLowerCase()

  const forbidden: DoctrineVerdict["matches"] = []
  const approval: DoctrineVerdict["matches"] = []
  const allowed: DoctrineVerdict["matches"] = []

  for (const r of rules) {
    for (const f of r.forbidden) {
      if (f && text.includes(f.toLowerCase()))
        forbidden.push({ ref: r.ref, title: r.title, reason: f })
    }
    for (const a of r.requiresApproval) {
      if (a && text.includes(a.toLowerCase()))
        approval.push({ ref: r.ref, title: r.title, reason: a })
    }
    for (const a of r.allowed) {
      if (a && text.includes(a.toLowerCase()))
        allowed.push({ ref: r.ref, title: r.title, reason: a })
    }
  }

  if (forbidden.length > 0) return { verdict: "forbidden", matches: forbidden }
  if (approval.length > 0)
    return { verdict: "requires_approval", matches: approval }
  if (allowed.length > 0) return { verdict: "allowed", matches: allowed }
  return { verdict: "unspecified", matches: [] }
}

/* ------------------------------------------------------------------ */
/* Seeds — the 7 required doctrine rules from the playbook            */
/* ------------------------------------------------------------------ */

const DOCTRINE_SEEDS: {
  title: string
  statement: string
  category: string
  scope: string
  priority: number
  allowed: string[]
  forbidden: string[]
  requiresApproval: string[]
}[] = [
  {
    title: "Claude Code may not push by default",
    statement:
      "Claude Code operates without push authority. Pushing to any remote requires explicit per-action operator approval.",
    category: "guardrail",
    scope: "workers/claude-code",
    priority: 9,
    allowed: ["read", "edit local", "propose"],
    forbidden: ["push", "git push", "publish"],
    requiresApproval: ["commit", "merge"],
  },
  {
    title: "Codex is audit/evidence scout by default",
    statement:
      "Codex acts as a read-only audit and evidence-gathering scout. It may inspect and report but may not mutate state without authorization.",
    category: "policy",
    scope: "workers/codex",
    priority: 7,
    allowed: ["read", "audit", "gather evidence", "report"],
    forbidden: ["write", "delete", "push", "mutate config"],
    requiresApproval: ["commit", "promote"],
  },
  {
    title: "Workers propose; WilliamOS governs",
    statement:
      "External workers may only propose changes. WilliamOS holds authority over writes, promotions, and commits. No worker self-approves.",
    category: "principle",
    scope: "governance/delegation",
    priority: 10,
    allowed: ["propose", "draft", "suggest"],
    forbidden: ["self-approve", "worker write authority", "auto-commit"],
    requiresApproval: ["write", "promote", "commit"],
  },
  {
    title: "Research intake is non-canon until reviewed",
    statement:
      "All captured research enters as unreviewed intake. It must never be treated as canon until explicitly reviewed and promoted by the operator.",
    category: "policy",
    scope: "memory/intake",
    priority: 8,
    allowed: ["capture", "embed", "tag as intake"],
    forbidden: ["auto-canon", "treat intake as canon"],
    requiresApproval: ["promote to canon"],
  },
  {
    title: "No silent model fallback",
    statement:
      "Model runtime selection is explicit and visible. The system must never silently fall back to another provider or model.",
    category: "guardrail",
    scope: "runtime/model",
    priority: 9,
    allowed: ["explicit runtime selection", "show provenance"],
    forbidden: ["silent fallback", "auto-switch", "provider relay switching"],
    requiresApproval: ["change runtime", "enable cloud"],
  },
  {
    title: "No Phase 6 without explicit authorization",
    statement:
      "Phase 6 proactive intelligence is an expansion gate, intentionally blocked. It may only open with the exact operator authorization phrase.",
    category: "guardrail",
    scope: "governance/phase6",
    priority: 10,
    allowed: [],
    forbidden: [
      "phase 6",
      "proactive intelligence",
      "autonomous background agents",
      "proactive behavior",
    ],
    requiresApproval: ["authorize phase 6 proactive intelligence"],
  },
  {
    title: "No generated artifact commit without classification",
    statement:
      "Generated reports, intake notes, local config, daily notes, screenshots, and runtime residue may not be committed without explicit classification.",
    category: "policy",
    scope: "governance/commits",
    priority: 7,
    allowed: ["commit classified source"],
    forbidden: ["commit unclassified artifact", "commit runtime residue"],
    requiresApproval: ["commit generated artifact"],
  },
]

export async function seedGovernanceDoctrine() {
  const userId = await getUserId()
  const existing = await db
    .select({ title: doctrine.title })
    .from(doctrine)
    .where(eq(doctrine.userId, userId))
  const have = new Set(existing.map((r) => r.title))

  let created = 0
  let n = 0
  const base = await nextRuleRef(userId)
  const counter = Number(base.match(/RULE-(\d+)/)?.[1] ?? "1")

  for (const seed of DOCTRINE_SEEDS) {
    if (have.has(seed.title)) continue
    const ref = `RULE-${String(counter + n).padStart(4, "0")}`
    n++
    const [row] = await db
      .insert(doctrine)
      .values({
        userId,
        ref,
        title: seed.title,
        statement: seed.statement,
        category: seed.category,
        scope: seed.scope,
        priority: seed.priority,
        active: true,
        status: "active",
        allowed: seed.allowed,
        forbidden: seed.forbidden,
        requiresApproval: seed.requiresApproval,
        locked: true,
      })
      .returning()
    await logEvent({
      userId,
      type: "doctrine.seeded",
      summary: `Seeded governance doctrine ${ref}: ${seed.title}`,
      register: "doctrine",
      refId: row.id,
    })
    created++
  }

  revalidatePath("/doctrine")
  return { created }
}
