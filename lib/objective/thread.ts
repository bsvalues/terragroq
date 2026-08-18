import type { ReconciliationVerdict } from "@/lib/resource/reconcile"
import type { ResourceRecord } from "@/lib/resource/resolve"

/**
 * Return the answer to the thread that asked.
 *
 * #871 boundary 6, and the one that decides whether the previous five are a product. The record, the
 * reconciliation, the refusal and the verification all existed; the operator was the one correlating
 * four endpoints by hand, which is the job the system was supposed to do -- and is how it ends up back
 * in a shell.
 *
 * Every item states its basis and state, using the vocabulary `lib/workbench/thread-projection.ts`
 * already declared: what was RECORDED is not what was observed as CURRENT, and a reader must be able to
 * tell which is which without asking anyone. Nothing here narrates. A thread that looks complete
 * because an agent described it is the billboard again, one level deeper.
 */

export type ThreadItemKind = "OWNER_INTENT" | "WILLIAMOS_RESPONSE" | "VALIDATION" | "DECISION"
export type ThreadTruthBasis = "PERSISTED" | "LIVE_OBSERVATION" | "INFERRED" | "UNKNOWN"
export type ThreadTruthState = "RECORDED" | "CURRENT" | "STALE" | "MISSING" | "CONFLICTING" | "UNKNOWN"

export interface ThreadItem {
  kind: ThreadItemKind
  /** The source this item is derived from, so a reader can go and check it. */
  source: { type: string; id: string }
  basis: ThreadTruthBasis
  state: ThreadTruthState
  summary: string
  detail?: string[]
}

export interface VerificationSummary {
  observedAt: string
  probed: number
  confirmed: number
  contradicted: number
  unreachable: number
  observations: Array<{ identity: string; detail: string; agrees: boolean | null }>
}

/**
 * Build the thread from sources, not from narration.
 *
 * Each argument is the CURRENT state of a source, re-read at projection time. Nothing is copied at
 * write time, because a copied verdict is stale the moment its source moves -- which is the failure this
 * whole outcome exists to prevent.
 */
export function buildThreadItems(input: {
  workOrderRef: string
  objective: string
  record: ResourceRecord | null
  reconciliation: ReconciliationVerdict | null
  refusal: { operation: string; refusal: string; detail: string } | null
  verification: VerificationSummary | null
}): ThreadItem[] {
  const items: ThreadItem[] = [
    {
      kind: "OWNER_INTENT",
      source: { type: "work_order", id: input.workOrderRef },
      basis: "PERSISTED",
      state: "RECORDED",
      summary: input.objective,
    },
  ]

  if (!input.record) {
    items.push({
      kind: "WILLIAMOS_RESPONSE",
      source: { type: "resource", id: "unknown" },
      basis: "UNKNOWN",
      state: "MISSING",
      summary: "No governed record exists for the resource this objective concerns.",
    })
    return items
  }

  items.push({
    kind: "WILLIAMOS_RESPONSE",
    source: { type: "resource", id: input.record.identity },
    basis: "PERSISTED",
    // An unratified record is recorded, not confirmed. Saying CURRENT would claim a check nobody made.
    state: "RECORDED",
    summary: input.record.ratified
      ? `${input.record.identity} is declared to ${input.record.workloadOwner?.identity ?? "no owner"}`
      : `${input.record.identity} is declared to ${input.record.workloadOwner?.identity ?? "no owner"} (record not ratified)`,
    detail: [
      ...input.record.sources.map((item) => `source: ${item.identity}`),
      ...input.record.completionEvidence.map((item) => `completion evidence: ${item.identity}`),
      ...input.record.derivatives.map((item) => `derivative: ${item.identity}`),
    ],
  })

  if (input.reconciliation) {
    items.push({
      kind: "VALIDATION",
      source: { type: "reconciliation", id: input.record.identity },
      basis: "PERSISTED",
      state: input.reconciliation.classification === "CONFLICTING" ? "CONFLICTING" : "RECORDED",
      summary: input.reconciliation.summary,
      detail: input.reconciliation.disagreements.map((item) => item.detail),
    })
  }

  if (input.verification) {
    const contradicted = input.verification.contradicted > 0
    items.push({
      kind: "VALIDATION",
      source: { type: "governance_event", id: `verification:${input.verification.observedAt}` },
      // This is the one item that came from looking rather than from the ledger.
      basis: "LIVE_OBSERVATION",
      state: contradicted ? "CONFLICTING" : input.verification.unreachable > 0 ? "UNKNOWN" : "CURRENT",
      summary:
        `${input.verification.confirmed} of ${input.verification.probed} recorded artefact(s) confirmed on the node` +
        (contradicted ? `, ${input.verification.contradicted} contradicted` : "") +
        (input.verification.unreachable > 0 ? `, ${input.verification.unreachable} unreachable` : ""),
      detail: input.verification.observations.map((item) => item.detail),
    })
  }

  if (input.refusal) {
    items.push({
      kind: "DECISION",
      source: { type: "conflict", id: input.refusal.refusal },
      basis: "PERSISTED",
      state: "RECORDED",
      summary: `${input.refusal.operation} was refused: ${input.refusal.refusal}`,
      detail: [input.refusal.detail],
    })
  }

  return items
}

/**
 * One sentence describing where the objective stands.
 *
 * Derived from the items rather than written alongside them, so it cannot drift from what the thread
 * actually contains.
 */
export function summariseThread(items: ThreadItem[]): string {
  const conflicting = items.filter((item) => item.state === "CONFLICTING")
  const observed = items.find((item) => item.basis === "LIVE_OBSERVATION")
  if (conflicting.length > 0) {
    return `Answered with an unresolved contradiction: ${conflicting[0].summary}`
  }
  if (observed) return `Answered and confirmed by observation: ${observed.summary}`
  return "Answered from recorded state; nothing has been observed."
}
