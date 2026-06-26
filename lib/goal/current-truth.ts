// Current Truth — the snapshot of authoritative state the operator must read
// before acting (counters the "assume instead of verify" mistake, MP-006). The
// raw numbers are gathered by the server action; everything here is pure shaping
// and presentation so it stays testable and deterministic.

export interface CurrentTruth {
  capturedAt: string // ISO timestamp
  activeWorkOrders: number
  blockedWorkOrders: number
  openGoals: number
  forbiddenDoctrineRules: number
  approvalGatedRules: number
  lastEventSummary: string | null
  lastEventAt: string | null
  // Highest authority currently granted in the environment. The console runs
  // read-only by default, so this is A0 unless an operator has elevated it.
  grantedAuthority: string
}

export interface TruthLine {
  label: string
  value: string
  tone: "neutral" | "info" | "warn" | "danger" | "success"
}

// Turn the snapshot into display lines with a tone for each, so the UI never has
// to recompute severity. Pure function of the snapshot.
export function truthLines(t: CurrentTruth): TruthLine[] {
  return [
    {
      label: "Granted authority",
      value: t.grantedAuthority,
      tone: t.grantedAuthority === "A0_READ_ONLY" ? "success" : "warn",
    },
    {
      label: "Active work orders",
      value: String(t.activeWorkOrders),
      tone: t.activeWorkOrders > 0 ? "info" : "neutral",
    },
    {
      label: "Blocked work orders",
      value: String(t.blockedWorkOrders),
      tone: t.blockedWorkOrders > 0 ? "warn" : "neutral",
    },
    {
      label: "Open goals",
      value: String(t.openGoals),
      tone: t.openGoals > 0 ? "info" : "neutral",
    },
    {
      label: "Forbidden doctrine rules",
      value: String(t.forbiddenDoctrineRules),
      tone: t.forbiddenDoctrineRules > 0 ? "danger" : "neutral",
    },
    {
      label: "Approval-gated rules",
      value: String(t.approvalGatedRules),
      tone: t.approvalGatedRules > 0 ? "warn" : "neutral",
    },
    {
      label: "Last activity",
      value: t.lastEventSummary ?? "(none recorded)",
      tone: "neutral",
    },
  ]
}
