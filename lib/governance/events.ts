// Append-only governance event log (event sourcing). The most important
// governance state changes are never recorded as silent in-place edits — they
// also append an immutable event carrying before/after content hashes so the
// history of how a state came to exist is reconstructable and tamper-evident.

import { db } from "@/lib/db"
import { governanceEvent } from "@/lib/db/schema"
import { hashRecord } from "./hash"

// The closed set of durable governance event types.
export const GOVERNANCE_EVENT_TYPES = [
  "GOAL_CREATED",
  "WO_CLASSIFIED",
  "WO_READY_FOR_APPROVAL",
  "WO_AUTHORIZED",
  "WO_TRANSITION",
  "AUTHORITY_GRANTED",
  "AUTHORITY_REVOKED",
  "AUTHORITY_EXPIRED",
  "LOOP_STARTED",
  "LOOP_STOPPED",
  "EVIDENCE_RECORDED",
  "DECISION_ACCEPTED",
  "DOCTRINE_CHANGED",
  "LOCK_CREATED",
  "LOCK_RELEASED",
  "CONFLICT_DETECTED",
  "CONFLICT_RESOLVED",
  "AGENT_CLAIM_INGESTED",
  "TRUTH_RECORDED",
  "TRUTH_STALE",
  "IDEA_PARKED",
  "IDEA_PROMOTED",
] as const

export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number]

export interface AppendEventInput {
  userId: string
  eventType: GovernanceEventType
  entityType?: string
  entityId?: string | number
  actor?: string
  reason?: string
  // Prior + next snapshots; hashed automatically for tamper-evidence.
  before?: unknown
  after?: unknown
  evidenceId?: number
  metadata?: Record<string, unknown>
}

// Append a single governance event. Best-effort: governance logging must never
// itself become a failure that blocks the operator, so it swallows write errors
// after surfacing them to the server console.
export async function appendGovernanceEvent(input: AppendEventInput): Promise<void> {
  try {
    await db.insert(governanceEvent).values({
      userId: input.userId,
      eventType: input.eventType,
      entityType: input.entityType ?? null,
      entityId: input.entityId != null ? String(input.entityId) : null,
      actor: input.actor ?? "operator",
      reason: input.reason ?? null,
      beforeHash: input.before !== undefined ? hashRecord(input.before) : null,
      afterHash: input.after !== undefined ? hashRecord(input.after) : null,
      evidenceId: input.evidenceId ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (err) {
    console.log("[v0] appendGovernanceEvent failed:", (err as Error).message)
  }
}
