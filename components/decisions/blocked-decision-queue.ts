import type { Decision } from "@/lib/db/schema"

export type BlockedDecisionQueueItem = {
  ref: string
  title: string
  authority: string
  evidenceState: "present" | "required"
  nextMove: string
}

export type BlockedDecisionQueueSurface = {
  title: string
  description: string
  items: BlockedDecisionQueueItem[]
  emptyState: {
    title: string
    description: string
  }
  safety: {
    readOnly: true
    approvesDecision: false
    grantsAuthority: false
    executesWork: false
    writesProduction: false
  }
}

export function getBlockedDecisionQueueSurface(decisions: Decision[]): BlockedDecisionQueueSurface {
  const items = decisions
    .filter((decision) => decision.status === "proposed")
    .map((decision): BlockedDecisionQueueItem => {
      const evidenceState = decision.evidence.length > 0 ? "present" : "required"

      return {
        ref: decision.ref ?? `ADR-${decision.id}`,
        title: decision.title,
        authority: decision.authority,
        evidenceState,
        nextMove:
          evidenceState === "present"
            ? "Review evidence, accept or reject the authority call, then return to Work Orders."
            : "Attach evidence or rationale before the decision can unblock governed work.",
      }
    })

  return {
    title: "Blocked Decision Queue",
    description:
      "Proposed decisions are authority blockers. WilliamOS can show the queue and needed evidence, but it cannot approve, reject, or grant authority by itself.",
    items,
    emptyState: {
      title: "No blocked decisions",
      description:
        "When proposed decisions are waiting for Primary review, they appear here before new goals or Work Orders can advance.",
    },
    safety: {
      readOnly: true,
      approvesDecision: false,
      grantsAuthority: false,
      executesWork: false,
      writesProduction: false,
    },
  }
}
