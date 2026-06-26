// Goal Console taxonomy — the fixed vocabulary the /goal classifier maps into.
// Pure data + types. No side effects, no I/O. Shared by the engine, the server
// actions, and the UI so there is a single source of truth.

/* ------------------------------------------------------------------ */
/* Lanes — WHAT KIND of work the goal is                               */
/* ------------------------------------------------------------------ */

export const LANES = [
  {
    id: "docs",
    label: "Docs & Spec",
    description: "Documentation, specs, playbooks, plans. No runtime behavior.",
    baseRisk: "low",
  },
  {
    id: "ui",
    label: "UI Surface",
    description: "Client components, pages, styling. No data authority.",
    baseRisk: "low",
  },
  {
    id: "read_model",
    label: "Read Model",
    description: "Read-only queries, dashboards, reports, verifiers.",
    baseRisk: "low",
  },
  {
    id: "write_model",
    label: "Write Model",
    description: "Server actions that create or update records.",
    baseRisk: "medium",
  },
  {
    id: "schema",
    label: "Schema & Migration",
    description: "Database schema changes, migrations, indexes.",
    baseRisk: "high",
  },
  {
    id: "auth",
    label: "Auth & Access",
    description: "Authentication, sessions, permissions, secrets.",
    baseRisk: "high",
  },
  {
    id: "integration",
    label: "Integration",
    description: "Third-party services, external APIs, webhooks.",
    baseRisk: "medium",
  },
  {
    id: "release",
    label: "Release & Ops",
    description: "Commits, tags, pushes, deploys, env, infra.",
    baseRisk: "critical",
  },
] as const

export type LaneId = (typeof LANES)[number]["id"]

/* ------------------------------------------------------------------ */
/* Modes — HOW the work should proceed                                 */
/* ------------------------------------------------------------------ */

export const MODES = [
  { id: "inspect", label: "Inspect", description: "Look only. Gather context, report findings." },
  { id: "plan", label: "Plan", description: "Design an approach for approval. No changes." },
  { id: "draft", label: "Draft", description: "Produce a draft work order or document." },
  { id: "implement", label: "Implement", description: "Make scoped changes inside an approved WO." },
  { id: "verify", label: "Verify", description: "Run read-only validators against current state." },
  { id: "review", label: "Review", description: "Assess completed work against acceptance criteria." },
  { id: "operate", label: "Operate", description: "Release actions: commit, tag, push, deploy." },
] as const

export type ModeId = (typeof MODES)[number]["id"]

/* ------------------------------------------------------------------ */
/* Authority levels A0–A9 — WHAT the actor is permitted to do          */
/* ------------------------------------------------------------------ */

export const AUTHORITY_LEVELS = [
  { id: "A0_READ_ONLY", rank: 0, label: "A0 · Read-only", description: "Read and report. No writes of any kind." },
  { id: "A1_DRAFT", rank: 1, label: "A1 · Draft", description: "Produce drafts and proposals. Nothing persisted as authoritative." },
  { id: "A2_WRITE_OWN", rank: 2, label: "A2 · Write (own scope)", description: "Create/update records the actor owns, inside an approved WO." },
  { id: "A3_WRITE_SHARED", rank: 3, label: "A3 · Write (shared)", description: "Modify shared registers. Requires approval." },
  { id: "A4_SCHEMA", rank: 4, label: "A4 · Schema", description: "Additive schema changes. Requires approval." },
  { id: "A5_DESTRUCTIVE", rank: 5, label: "A5 · Destructive data", description: "Deletes / non-additive migrations. Explicit approval each time." },
  { id: "A6_AUTH", rank: 6, label: "A6 · Auth & secrets", description: "Touch auth, sessions, secrets. Explicit approval each time." },
  { id: "A7_COMMIT", rank: 7, label: "A7 · Commit", description: "Local commits. Requires approval." },
  { id: "A8_PUSH", rank: 8, label: "A8 · Push / PR", description: "Push to remote, open PRs. Requires approval." },
  { id: "A9_RELEASE", rank: 9, label: "A9 · Release", description: "Tag, deploy, production release. Highest authority." },
] as const

export type AuthorityId = (typeof AUTHORITY_LEVELS)[number]["id"]

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export type Verdict = "allow" | "requires_approval" | "refuse"

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function lane(id: string) {
  return LANES.find((l) => l.id === id)
}
export function mode(id: string) {
  return MODES.find((m) => m.id === id)
}
export function authority(id: string) {
  return AUTHORITY_LEVELS.find((a) => a.id === id)
}
export function authorityRank(id: string): number {
  return authority(id)?.rank ?? 0
}

// The default, safest posture for any newly classified goal.
export const DEFAULT_AUTHORITY: AuthorityId = "A0_READ_ONLY"

// Map a lane to the maximum authority its work could ever need. Used to cap and
// to decide whether a goal must route through approval before it can proceed.
export const LANE_MAX_AUTHORITY: Record<LaneId, AuthorityId> = {
  docs: "A2_WRITE_OWN",
  ui: "A2_WRITE_OWN",
  read_model: "A0_READ_ONLY",
  write_model: "A3_WRITE_SHARED",
  schema: "A4_SCHEMA",
  auth: "A6_AUTH",
  integration: "A3_WRITE_SHARED",
  release: "A9_RELEASE",
}
