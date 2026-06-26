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
