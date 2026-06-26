// WO-018 — Conflict Register (pure helpers).
//
// A Second Brain that leads must catch contradictions. This module holds the
// pure severity model and detectors so they are deterministic and testable.
// Persistence + blocking enforcement live in app/actions/conflicts.ts.

export const CONFLICT_SEVERITIES = ["low", "medium", "high", "critical"] as const
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number]

// High-risk conflicts (high/critical) block loops and transitions until resolved.
export function isBlockingSeverity(severity: string): boolean {
  return severity === "high" || severity === "critical"
}

export interface DetectedConflict {
  detectedBetween: string
  severity: ConflictSeverity
  system?: string
  description: string
  doctrineRule?: string
}

// Detect contradictions between an asserted intent and the current posture.
// Deterministic keyword/state checks — no I/O.
export function detectConflicts(input: {
  intent: string
  activeLocks: { kind: string; title: string; scope?: string | null }[]
  woReadOnly?: boolean
  loopWantsMutation?: boolean
}): DetectedConflict[] {
  const out: DetectedConflict[] = []
  const text = input.intent.toLowerCase()
  const goAhead = /\b(let'?s go|go ahead|just do it|ship it|proceed|send it)\b/.test(text)

  for (const lock of input.activeLocks) {
    const kind = lock.kind.toUpperCase()
    if ((kind === "HOLD" || kind === "STOP" || kind === "FREEZE") && goAhead) {
      out.push({
        detectedBetween: `operator intent ("${input.intent.trim()}") vs active ${kind} lock "${lock.title}"`,
        severity: kind === "STOP" ? "critical" : "high",
        system: lock.scope ?? undefined,
        description: `Vague go-ahead cannot release a ${kind} lock. Use the explicit release protocol.`,
        doctrineRule: "Locks are released only by explicit protocol, never by vague language.",
      })
    }
    if (kind === "STOP" && /(clean|cleanup|mutate|delete|refactor|fix)\b/.test(text)) {
      out.push({
        detectedBetween: `mutation intent vs STOP lock "${lock.title}"`,
        severity: "critical",
        system: lock.scope ?? undefined,
        description: "Mutation requested while a STOP lock is active. Evidence-only is the safe alternative.",
        doctrineRule: "No mutation under STOP.",
      })
    }
  }

  if (input.woReadOnly && input.loopWantsMutation) {
    out.push({
      detectedBetween: "read-only work order vs execute loop request",
      severity: "high",
      description: "A read-only work order cannot host a mutating loop. Escalate for explicit authority.",
      doctrineRule: "Loop authority may not exceed work order scope.",
    })
  }

  return out
}
