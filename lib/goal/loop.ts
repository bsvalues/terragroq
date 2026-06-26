// The /loop verifier core — READ-ONLY by design. A loop never executes work; it
// gathers current truth, evaluates a classified goal against it, and reports
// whether the operator is clear to proceed. The single exported guard
// `refuseExecution` exists so callers have one obvious place that proves the
// console will not act on its own.

import type { Classification } from "./classifier"
import type { CurrentTruth } from "./current-truth"
import { authorityRank } from "./taxonomy"

export type CheckStatus = "pass" | "warn" | "fail"

export interface LoopCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface LoopReport {
  command: string
  clearToProceed: boolean
  blockedReason: string | null
  checks: LoopCheck[]
  // Always false from a loop. Present so the UI can state it explicitly.
  willExecute: false
}

// Evaluate a classified goal against current truth. Pure function — no writes.
export function runLoopVerifier(cls: Classification, truth: CurrentTruth): LoopReport {
  const checks: LoopCheck[] = []

  // 1. Doctrine forbidden check
  checks.push({
    id: "doctrine",
    label: "Doctrine — no forbidden match",
    status: cls.verdict === "refuse" ? "fail" : "pass",
    detail:
      cls.verdict === "refuse"
        ? "Goal matched a blocking pattern or forbidden rule."
        : "No forbidden doctrine rule blocks this goal.",
  })

  // 2. Authority posture
  const elevated = authorityRank(cls.authority) > authorityRank("A1_DRAFT")
  checks.push({
    id: "authority",
    label: "Authority within read/draft posture",
    status: elevated ? "warn" : "pass",
    detail: elevated
      ? `Goal needs ${cls.authority}; console grants ${truth.grantedAuthority}. Approval required before execution.`
      : `Goal needs ${cls.authority}; within the console's read-only posture.`,
  })

  // 3. Mistake patterns
  const blocking = cls.mistakePatterns.filter((m) => m.severity === "block")
  const warns = cls.mistakePatterns.filter((m) => m.severity === "warn")
  checks.push({
    id: "mistakes",
    label: "Mistake patterns",
    status: blocking.length > 0 ? "fail" : warns.length > 0 ? "warn" : "pass",
    detail:
      blocking.length > 0
        ? `Blocking: ${blocking.map((m) => m.id).join(", ")}.`
        : warns.length > 0
          ? `Cautions: ${warns.map((m) => m.id).join(", ")}.`
          : "No known mistake patterns detected.",
  })

  // 4. Environment state
  checks.push({
    id: "environment",
    label: "Environment is in a known state",
    status: truth.forbiddenDoctrineRules >= 0 ? "pass" : "warn",
    detail: `${truth.activeWorkOrders} active / ${truth.blockedWorkOrders} blocked work orders; truth captured ${truth.capturedAt}.`,
  })

  const hasFail = checks.some((c) => c.status === "fail")
  const clearToProceed = !hasFail && cls.verdict === "allow"
  const blockedReason = hasFail
    ? "One or more checks failed."
    : cls.verdict === "requires_approval"
      ? "Approval required before this goal can proceed."
      : null

  return { command: cls.command, clearToProceed, blockedReason, checks, willExecute: false }
}

// The console never executes. This guard is the single source of that truth.
export function refuseExecution(): { ok: false; reason: string } {
  return {
    ok: false,
    reason:
      "The Goal Console is read-only. It classifies, verifies, and drafts work orders, but never executes changes. Convert to a work order and obtain explicit approval to act.",
  }
}
