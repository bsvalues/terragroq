/**
 * Grounding for the Line (#762 real-operator acceptance, 2026-08-21).
 *
 * A real-operator test caught the environment answering "who are you" as a generic assistant and
 * inventing projects when asked what work is in flight. The cause: every non-login sentence fell
 * through to a free-form model with no WilliamOS grounding, which hallucinates. The product
 * distinction WilliamOS exists to eliminate is exactly this — a generic chatbot sitting inside
 * WilliamOS versus WilliamOS itself.
 *
 * The guarantee is two-layered, because a classifier alone can be paraphrased around (Codex P1):
 *  1. Identity / project / current-work questions are classified and answered DETERMINISTICALLY,
 *     never routed to the model.
 *  2. Whatever still reaches the model carries `groundingFacts()` in its system prompt — the real
 *     identity and the real registered projects — so the model path is never ungrounded and has real
 *     data instead of a vacuum to fill.
 * The classifier is anchored to awareness/metadata questions so it does not swallow operational
 * requests ("show me the projects page source" is not a projects question — Codex P2), and answers
 * respect `project.lifecycle` so standby/archived projects are never reported as current work.
 */

export type GroundedKind = "identity" | "projects" | "current-work"

export type ProjectRow = Readonly<{ name: string; lifecycle: string }>

/** The Work-Order fields the Line surfaces — a subset of the real `work_order` row. */
export type WorkOrderRow = Readonly<{
  ref: string | null
  title: string
  status: string
  priority: string
  scope: string | null
  lane: string | null
  evidence: readonly string[]
}>

// An operational request (show/open/edit a page, source, file, route, component) is not a metadata
// question, even when it mentions "projects". These must reach normal handling, not a registry list.
const OPERATIONAL = /\b(source|page|code|file|route|url|endpoint|repository|repo|component|render|screenshot|open|edit|deploy|build|log)\b/i

const IDENTITY =
  /\b(who (are|is) (you|williamos)|what (are|is) (you|williamos)|what can you do|introduce yourself|tell me about (yourself|williamos)|your name|are you an? (chatbot|chat ?bot|bot|assistant|ai))\b/i

// Awareness of the project SET: "what/which projects", "do we have / are there projects", "name /
// list our projects", "our projects", "the projects we are working on".
const PROJECTS =
  /\b(what|which|tell me (more )?about|do we have|are there|is there|name|list)\b[^?]*\bprojects?\b|\b(our|the) projects?\b/i

// Current work: a first-person-plural question about what is being done, or what is in flight. Not
// "the login status currently" — that needs the work object, not just the word "currently".
const CURRENT_WORK =
  /\bwhat (are|'?re) we\b[^?]*\b(doing|working on|building|up to)\b|\bwhat('?s| is) (in flight|in progress|underway|on the go)\b|\bwhere are we\b/i

/** Classify a sentence that must be answered from grounded state, or null to fall through normally. */
export function classifyGrounded(text: string): GroundedKind | null {
  if (OPERATIONAL.test(text)) return null
  // Current-work before projects: "what are we working on across the projects" is current-work.
  if (CURRENT_WORK.test(text)) return "current-work"
  if (PROJECTS.test(text)) return "projects"
  if (IDENTITY.test(text)) return "identity"
  return null
}

/** The known project a current-work question is scoped to ("...on TerraFusion"), or null for all. */
export function matchKnownProject(text: string, projects: readonly ProjectRow[]): string | null {
  const lower = text.toLowerCase()
  // Longest name first, so "TerraFusion OS" wins over a bare "TerraFusion".
  const byLength = projects.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length)
  return byLength.find((name) => lower.includes(name.toLowerCase())) ?? null
}

/** WilliamOS in its actual role — not a generic assistant. Deterministic, so it cannot drift. */
export function groundedIdentity(): string {
  return (
    "I'm WilliamOS — the Primary Operator's sovereign command environment for governed development " +
    "work, not a general chat assistant. I run real work through governed lanes with authority, " +
    "evidence, and receipts across the lab (HERMES, ATLAS, AEGIS) and projects like TerraFusion. " +
    "Tell me an outcome you want and I assemble the working world for it — the real page, the real " +
    "diff, the real tests — rather than describing what I could do."
  )
}

function names(projects: readonly ProjectRow[], lifecycle: string): string[] {
  return projects.filter((p) => p.lifecycle === lifecycle).map((p) => p.name).filter(Boolean)
}

function join(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? ""
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`
}

/**
 * "What projects" from the real register, lifecycle-aware. Active is current work; standby is named
 * separately; archived is not reported as ongoing. Empty is answered honestly, never invented.
 */
export function composeProjectsAnswer(projects: readonly ProjectRow[]): string {
  const active = names(projects, "active")
  const standby = names(projects, "standby")
  if (active.length === 0 && standby.length === 0) {
    return (
      "No active or standby projects are registered here, so I won't name any — inventing a list is " +
      "exactly the failure this surface is built to avoid. Register the project/work state and I'll " +
      "answer from it."
    )
  }
  if (active.length === 0) {
    return (
      `Nothing is marked active right now. Registered on standby: ${join(standby)}. I'm reading the ` +
      `register, not guessing — say the word and I'll pick one up.`
    )
  }
  const standbyNote = standby.length > 0 ? ` Also registered, on standby: ${join(standby)}.` : ""
  return (
    `Currently active: ${join(active)}.${standbyNote} That's the governed register as it stands — ` +
    `I'm reading it, not guessing. Ask about any one and I'll pull what this surface actually has.`
  )
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
// Work that is genuinely in flight — not a draft, and not finished/abandoned.
const DORMANT_STATUS = new Set(["draft", "closed", "aborted", "done", "cancelled"])

/** True when the work order plausibly belongs to the named project (ref/title/scope/lane mention it). */
function matchesProject(wo: WorkOrderRow, project: string): boolean {
  const needle = project.toLowerCase()
  return [wo.ref, wo.title, wo.scope, wo.lane].some((f) => (f ?? "").toLowerCase().includes(needle))
}

/**
 * "What are we doing right now [on <project>]" — read from the REAL work orders (criterion 4). Reports
 * the in-flight work highest-priority first, with status, blockers, and latest evidence, or says
 * honestly that nothing is in flight. Never invents work. Takes the rows so it is unit-testable.
 */
export function composeCurrentWork(workOrders: readonly WorkOrderRow[], project?: string): string {
  const scoped = project ? workOrders.filter((wo) => matchesProject(wo, project)) : workOrders
  const active = scoped
    .filter((wo) => !DORMANT_STATUS.has(wo.status.toLowerCase()))
    .slice()
    .sort((a, b) => (PRIORITY_RANK[a.priority.toLowerCase()] ?? 2) - (PRIORITY_RANK[b.priority.toLowerCase()] ?? 2))

  const label = project ? ` on ${project}` : ""
  if (active.length === 0) {
    return (
      `Nothing is in flight${label} right now — no active work order in the register, and I won't ` +
      `invent one. Name a piece of work and I'll assemble the world for it.`
    )
  }

  const lines = active.slice(0, 5).map((wo) => {
    const id = wo.ref ? `${wo.ref} ` : ""
    const blocked = wo.status.toLowerCase() === "blocked" ? " — BLOCKED" : ""
    const ev = wo.evidence.length > 0 ? `; latest evidence: ${wo.evidence[wo.evidence.length - 1]}` : "; no evidence yet"
    return `• ${id}${wo.title} [${wo.priority}/${wo.status}${blocked}]${ev}`
  })
  const more = active.length > 5 ? `\n(+${active.length - 5} more active)` : ""
  const top = active[0]
  return (
    `In flight${label}, highest priority first:\n${lines.join("\n")}${more}\n\n` +
    `Highest priority is ${top.ref ? `${top.ref} ` : ""}"${top.title}" (${top.priority}). ` +
    `Say "continue the highest-priority${label} work" and I'll take it through the governed path. ` +
    `I'm reading the register, not guessing.`
  )
}

/**
 * A compact grounding block for the free-form model's system prompt — the second layer. Anything the
 * classifier misses still answers against these real facts instead of a vacuum, and is told to refuse
 * rather than invent beyond them.
 */
export function groundingFacts(projects: readonly ProjectRow[]): string {
  const active = names(projects, "active")
  const standby = names(projects, "standby")
  const registry =
    active.length === 0 && standby.length === 0
      ? "No projects are registered."
      : `Registered projects — active: ${active.join(", ") || "none"}; standby: ${standby.join(", ") || "none"}.`
  return (
    `You ARE WilliamOS, the Primary Operator's sovereign command environment (lab: HERMES, ATLAS, ` +
    `AEGIS). ${registry} Do not name any project, system, or work item not listed here; if asked ` +
    `about anything you have not been given, say you don't have that governed state rather than ` +
    `inventing it.`
  )
}
