"use server"

import { db } from "@/lib/db"
import { agentClaim, type AgentClaim } from "@/lib/db/schema"
import { getUserId } from "@/lib/session"
import { logEvent } from "@/lib/registers/events"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { nextRef } from "@/lib/governance/refs"
import { classifyAgentClaim } from "@/lib/governance/agent-claims"
import { recordConflict } from "@/app/actions/conflicts"
import { desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getAgentClaims(limit = 50): Promise<AgentClaim[]> {
  const userId = await getUserId()
  return db
    .select()
    .from(agentClaim)
    .where(eq(agentClaim.userId, userId))
    .orderBy(desc(agentClaim.createdAt))
    .limit(limit)
}

/* ------------------------------------------------------------------ */
/* Writes                                                            */
/* ------------------------------------------------------------------ */

export interface IngestClaimInput {
  agent: string
  claim: string
  workOrderId?: number
  evidenceId?: number
  command?: string
  repo?: string
  branch?: string
  head?: string
  // Operator/system signal that this claim contradicts a known truth/record.
  contradicts?: boolean
}

// Ingest an agent claim as UNTRUSTED. It is classified, never auto-promoted to
// Current Truth. CONFLICTING claims spawn a ConflictRecord automatically.
export async function ingestAgentClaim(
  input: IngestClaimInput,
): Promise<{ claim: AgentClaim; classification: string; questions: string[] }> {
  const userId = await getUserId()
  const hasEvidence = Boolean(input.evidenceId) || Boolean(input.command && input.head && input.repo)
  const result = classifyAgentClaim({
    claim: input.claim,
    hasEvidence,
    contradicts: input.contradicts,
  })

  const ref = await nextRef(agentClaim as never, "CLAIM", userId)

  // A conflicting claim registers a conflict first so we can link it.
  let conflictId: number | null = null
  if (result.classification === "CONFLICTING") {
    const conflict = await recordConflict({
      detectedBetween: `agent "${input.agent}" claim vs existing truth`,
      severity: "high",
      description: input.claim,
      workOrderId: input.workOrderId,
      doctrineRule: "Agent claims may not override verified truth.",
    })
    conflictId = conflict.id
  }

  const [row] = await db
    .insert(agentClaim)
    .values({
      userId,
      ref,
      agent: input.agent,
      claim: input.claim,
      classification: result.classification,
      workOrderId: input.workOrderId ?? null,
      evidenceId: input.evidenceId ?? null,
      command: input.command ?? null,
      repo: input.repo ?? null,
      branch: input.branch ?? null,
      head: input.head ?? null,
      conflictId,
      status: "open",
    })
    .returning()

  await appendGovernanceEvent({
    userId,
    eventType: "AGENT_CLAIM_INGESTED",
    entityType: "agent_claim",
    entityId: row.id,
    reason: result.reason,
    after: { classification: result.classification, agent: input.agent },
    metadata: { classification: result.classification },
  })
  await logEvent({
    userId,
    type: "agent_claim.ingested",
    summary: `${ref} [${result.classification}] from ${input.agent}: ${input.claim.slice(0, 80)}`,
    register: "agent-claims",
    refId: row.id,
  })
  revalidatePath("/goal-console")
  return { claim: row, classification: result.classification, questions: result.questions }
}
