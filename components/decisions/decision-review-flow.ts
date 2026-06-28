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
  tab: "active" | "proposed" | "superseded" | "all"
}

export function getDecisionReviewFlow(counts: DecisionReviewCounts): DecisionReviewFlow {
  if (counts.proposed > 0) {
    return {
      title: "Review proposed decisions",
      description: `${counts.proposed} proposed decision${counts.proposed === 1 ? "" : "s"} need acceptance, rejection, or more evidence.`,
      action: "Open proposed queue",
      tab: "proposed",
    }
  }

  if (counts.active > 0) {
    return {
      title: "Audit active doctrine inputs",
      description: "Accepted decisions are the current operating context. Review evidence before starting related work.",
      action: "Review active decisions",
      tab: "active",
    }
  }

  if (counts.superseded > 0) {
    return {
      title: "Inspect decision lineage",
      description: "Only superseded decisions exist. Use lineage to understand what changed before creating a replacement.",
      action: "Review superseded lineage",
      tab: "superseded",
    }
  }

  return {
    title: "Log the first decision",
    description: "Capture the current operating call before work depends on undocumented assumptions.",
    action: "Log decision",
    tab: "all",
  }
}
