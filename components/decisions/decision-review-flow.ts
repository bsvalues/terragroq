export type DecisionReviewCounts = {
  active: number
  proposed: number
  superseded: number
  all: number
}

export type DecisionReviewFlow = {
  title: string
  description: string
  action: string
  homeSignal: string
  queueLabel: string
  nextMove: string
  boundary: string
  tab: "active" | "proposed" | "superseded" | "all"
}

export function getDecisionReviewFlow(counts: DecisionReviewCounts): DecisionReviewFlow {
  if (counts.proposed > 0) {
    return {
      title: "Review proposed decisions",
      description: `${counts.proposed} proposed decision${counts.proposed === 1 ? "" : "s"} need acceptance, rejection, or more evidence.`,
      action: "Open proposed queue",
      homeSignal: "Home routed here because authority is waiting.",
      queueLabel: "Primary decision queue",
      nextMove: "Resolve the proposed call, then return Home to classify the next objective.",
      boundary: "Decision review records authority. It does not execute work or grant runtime access.",
      tab: "proposed",
    }
  }

  if (counts.active > 0) {
    return {
      title: "Audit active doctrine inputs",
      description: "Accepted decisions are the current operating context. Review evidence before starting related work.",
      action: "Review active decisions",
      homeSignal: "Home has no proposed decision blocker.",
      queueLabel: "Accepted operating context",
      nextMove: "Use active decisions as constraints before drafting the next Work Order.",
      boundary: "Accepted decisions inform future work, but this surface does not run Work Orders.",
      tab: "active",
    }
  }

  if (counts.superseded > 0) {
    return {
      title: "Inspect decision lineage",
      description: "Only superseded decisions exist. Use lineage to understand what changed before creating a replacement.",
      action: "Review superseded lineage",
      homeSignal: "Home found no active or proposed decision blocker.",
      queueLabel: "Historical authority trail",
      nextMove: "Review lineage, then log a replacement only if the current doctrine is unclear.",
      boundary: "Lineage is evidence. It does not change current authority by itself.",
      tab: "superseded",
    }
  }

  return {
    title: "Log the first decision",
    description: "Capture the current operating call before work depends on undocumented assumptions.",
    action: "Log decision",
    homeSignal: "Home needs an authority baseline.",
    queueLabel: "Empty decision register",
    nextMove: "Record the first call, then use Work Orders for scoped implementation.",
    boundary: "Logging a decision creates context; it does not execute implementation.",
    tab: "all",
  }
}
