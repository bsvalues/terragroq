/**
 * Grounding for the Line (#762 real-operator acceptance, 2026-08-21).
 *
 * A real-operator test caught the environment answering "who are you" as a generic assistant and
 * inventing projects ("an AI chatbot for customer support", "a community event planning tool") when
 * asked what work is in flight. The cause: every non-login sentence fell through to a free-form model
 * with no WilliamOS grounding, which cheerfully hallucinates. The product distinction WilliamOS
 * exists to eliminate is exactly this — a generic chatbot sitting inside WilliamOS versus WilliamOS
 * itself.
 *
 * The fix is structural, not a better prompt: identity and project/current-work questions are
 * answered from grounded, deterministic sources and NEVER routed to the free-form model, so
 * fabrication is not merely discouraged — it is unreachable on these paths. Where the governed state
 * is not yet wired into this surface, the honest answer is "I don't have that", never an invention.
 */

export type GroundedKind = "identity" | "projects" | "current-work"

const IDENTITY = /\b(who are you|what are you|what can you do|introduce yourself|your name|are you an? (chatbot|chat ?bot|bot|assistant|ai))\b/i
const PROJECTS = /\b(what|which|tell me (more )?about|list|show)\b[^?]*\bprojects?\b/i
const CURRENT_WORK = /\b(what('?s| is| are we)?|status|where are we|what's going on)\b[^?]*\b(working on|in flight|in progress|right now|currently|doing (right )?now|underway)\b/i

/** Classify a sentence that must be answered from grounded state, or null to fall through normally. */
export function classifyGrounded(text: string): GroundedKind | null {
  // Current-work is checked before projects: "what are we working on with the projects" is a
  // current-work question, and both patterns can match it.
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

/**
 * Answer "what projects" from the real registered projects. Takes the rows rather than fetching, so
 * the anti-fabrication guarantee is unit-testable. Empty is answered honestly, never invented.
 */
export function composeProjectsAnswer(projects: readonly { name: string }[]): string {
  const names = projects.map((p) => p.name).filter(Boolean)
  if (names.length === 0) {
    return (
      "No projects are registered in this environment yet, so I won't name any — inventing a list is " +
      "exactly the failure this surface is built to avoid. Register the project/work state and I'll " +
      "answer from it."
    )
  }
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  return (
    `The projects registered here: ${list}. That's the governed list as it stands — I'm reading it, ` +
    `not guessing. Ask about any one and I'll pull what this surface actually has for it.`
  )
}

/**
 * "What are we doing right now" — honest about the seam. The governed Work Order / evidence state is
 * not yet wired into this surface (real-operator acceptance criterion 5), so rather than invent
 * in-flight work, say what is and isn't available.
 */
export function groundedCurrentWork(projects: readonly { name: string }[]): string {
  const known = projects.map((p) => p.name).filter(Boolean)
  const anchor = known.length > 0 ? ` I can see the registered projects (${known.join(", ")}), ` : " "
  return (
    "I don't have the governed Work Order and evidence state wired into this surface yet, so I can't " +
    "tell you what's in flight without inventing it — and I won't." +
    anchor +
    "but not the live task/resource state behind them. Name a specific piece of work and I'll assemble " +
    "the world for it now."
  )
}
