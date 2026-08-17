import { appendGovernanceEvent } from "@/lib/governance/events"

/**
 * Receipts for everything the workroom actually does.
 *
 * The workroom can run processes, write files and drive a model. Those are the capabilities this
 * product exists to provide -- but the doctrine it is built on does not forbid mutation, it forbids
 * mutation that leaves no trace: loops may plan and act, they may not *silently* mutate. Shipping the
 * capability without the record was the omission, not the capability.
 *
 * So every run is bracketed: one event when it starts, one when it ends carrying the outcome. The
 * provider and model are recorded on every model turn, because the provider doctrine requires
 * selection to be operator-visible and receipt-recorded -- an answer that cannot be traced to the
 * provider that produced it is exactly the "provider-derived authority" the doctrine rules out.
 */

export interface LoomRunReceipt {
  userId: string
  /** "operation" | "agent" | "edit" -- what kind of work this was. */
  kind: string
  /** The operation id, model name, or file path this run concerned. */
  subject: string
  metadata?: Record<string, unknown>
}

export async function recordLoomStart({ userId, kind, subject, metadata }: LoomRunReceipt): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "LOOP_STARTED",
    entityType: `loom_${kind}`,
    entityId: subject,
    actor: "loom",
    reason: `workroom ${kind}: ${subject}`,
    after: { kind, subject, ...metadata },
    metadata,
  })
}

export async function recordLoomEnd({
  userId,
  kind,
  subject,
  outcome,
  metadata,
}: LoomRunReceipt & { outcome: Record<string, unknown> }): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "LOOP_STOPPED",
    entityType: `loom_${kind}`,
    entityId: subject,
    actor: "loom",
    reason: `workroom ${kind} finished: ${subject}`,
    after: { kind, subject, ...outcome },
    metadata: { ...metadata, ...outcome },
  })
}

/**
 * Record what a model attempt actually did to the workspace.
 *
 * Kept distinct from the start/stop pair because this one carries the adapter's own verdict --
 * whether edits verified, how many attempts it took, and whether the workspace was restored. That is
 * the evidence a reader needs to decide whether to trust the change, and it is worth being able to
 * find on its own rather than buried inside a stop event.
 */
export async function recordLoomEvidence({
  userId,
  subject,
  receipt,
}: {
  userId: string
  subject: string
  receipt: Record<string, unknown> | null
}): Promise<void> {
  await appendGovernanceEvent({
    userId,
    eventType: "EVIDENCE_RECORDED",
    entityType: "loom_edit",
    entityId: subject,
    actor: "loom",
    // An unreadable receipt is recorded as unreadable rather than omitted: a missing evidence row
    // would read as "no edit happened", which is the one thing it does not mean.
    reason: receipt === null ? `structured edit on ${subject}: receipt unreadable` : `structured edit on ${subject}`,
    after: receipt ?? { unreadable: true },
    metadata: receipt ?? { unreadable: true },
  })
}
