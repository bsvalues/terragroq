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

/**
 * "What are we doing right now" — honest about the seam. The live Work Order / evidence state is not
 * yet wired into this surface (acceptance criterion 5), so name the active projects from the register
 * but do not invent in-flight task state.
 */
export function groundedCurrentWork(projects: readonly ProjectRow[]): string {
  const active = names(projects, "active")
  const anchor =
    active.length > 0
      ? ` The register shows active: ${join(active)} — but not the live task or evidence state behind them.`
      : " Nothing is marked active in the register, and I won't invent work that isn't there."
  return (
    "I don't have the governed Work Order and evidence state wired into this surface yet, so I can't " +
    "tell you what's in flight without inventing it — and I won't." +
    anchor +
    " Name a specific piece of work and I'll assemble the world for it now."
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
