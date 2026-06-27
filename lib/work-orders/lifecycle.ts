import type { WorkOrder } from "@/lib/db/schema"

/* ------------------------------------------------------------------ */
/* Work Order lifecycle — pure helpers (no server boundary)            */
/* ------------------------------------------------------------------ */

// The governed 8-status lifecycle.
export const WO_STATUSES = [
  "draft",
  "proposed",
  "approved",
  "active",
  "blocked",
  "review",
  "closed",
  "aborted",
] as const

export type WoStatus = (typeof WO_STATUSES)[number]

export const TERMINAL_WO_STATUSES: WoStatus[] = ["closed", "aborted"]
export const OPEN_WO_STATUSES: WoStatus[] = WO_STATUSES.filter(
  (status): status is WoStatus => !TERMINAL_WO_STATUSES.includes(status as WoStatus),
)

// Allowed transitions. Anything not listed is rejected.
export const TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  draft: ["proposed", "aborted"],
  proposed: ["approved", "draft", "aborted"],
  approved: ["active", "aborted"],
  active: ["blocked", "review", "aborted"],
  blocked: ["active", "aborted"],
  review: ["closed", "active", "aborted"],
  closed: [], // terminal
  aborted: [], // terminal
}

export function canTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as WoStatus]
  return Array.isArray(allowed) && allowed.includes(to as WoStatus)
}

/* ------------------------------------------------------------------ */
/* Approval-readiness gate (§9.2)                                      */
/* ------------------------------------------------------------------ */

// A work order may not be AUTHORIZED (proposed → approved) unless every
// precondition the playbook requires is satisfied. Pure check — returns the
// list of what's missing so the UI can show the operator exactly what to fix.
export function checkApprovalReadiness(wo: WorkOrder): {
  ready: boolean
  missing: string[]
} {
  const missing: string[] = []
  if (!wo.scope || wo.scope.trim().length === 0) missing.push("Scope must be defined")
  if (!wo.authorityLevel) missing.push("Authority level must be declared")
  if (wo.forbiddenFiles.length === 0) missing.push("Blocked actions / forbidden files must be declared")
  if (wo.acceptanceCriteria.length === 0) missing.push("Acceptance criteria must exist")
  if (wo.validators.length === 0) missing.push("A validation method must exist")
  return { ready: missing.length === 0, missing }
}

// Authority above A1 always requires an explicit operator approval act.
export function requiresExplicitApproval(authorityLevel: string): boolean {
  const m = authorityLevel.match(/^A(\d)/)
  return m ? Number.parseInt(m[1], 10) > 1 : false
}

// Build the operator-grade closure report from the WO object. Pure function of
// the stored record — no side effects.
export function buildClosureReport(wo: WorkOrder): string {
  const list = (arr: string[]) =>
    arr.length > 0 ? arr.map((x) => `  - ${x}`).join("\n") : "  (none)"
  return [
    `RESULT: ${wo.result ?? "PENDING"}`,
    `WORK ORDER: ${wo.ref ?? `#${wo.id}`} — ${wo.title}`,
    wo.lane ? `LANE: ${wo.lane}` : null,
    wo.phase ? `PHASE: ${wo.phase}` : null,
    `STATUS: ${wo.status}`,
    wo.goal ? `GOAL: ${wo.goal}` : null,
    "",
    "ALLOWED FILES:",
    list(wo.allowedFiles),
    "FORBIDDEN FILES:",
    list(wo.forbiddenFiles),
    "VALIDATORS:",
    list(wo.validators),
    "STOP CONDITIONS:",
    list(wo.stopConditions),
    "EVIDENCE:",
    list(wo.evidence),
    "",
    `COMMIT: ${wo.commitRef ?? "(none)"}${wo.commitAllowed ? "" : "  [gate closed]"}`,
    `TAG: ${wo.tagRef ?? "(none)"}${wo.tagAllowed ? "" : "  [gate closed]"}`,
    `PUSH GATE: ${wo.pushAllowed ? "OPEN" : "closed"}`,
    `CLOSED AT: ${wo.closedAt ? new Date(wo.closedAt).toISOString() : "(open)"}`,
  ]
    .filter((l) => l !== null)
    .join("\n")
}
