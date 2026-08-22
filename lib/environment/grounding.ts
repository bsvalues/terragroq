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

// Identity questions in BOTH word orders. "who are you" and "tell me who you are" are the same
// question; the original pattern only matched verb-subject, so the second form fell through to the
// model and it answered as its own base persona.
/**
 * Unambiguous "who are you" forms, in BOTH word orders. Checked BEFORE the operational filter,
 * because an explicit question about who is answering is never a request to open a file — and in the
 * owner transcript that caught this, "tell me who you are" lost to the operational filter purely
 * because the sentence also contained the word "code" (in "claude code session").
 */
const DIRECT_IDENTITY =
  /\b(who (are|is) (you|williamos)|who (you are|am i (talking|speaking) (to|with))|introduce yourself|tell me about (yourself|williamos)|your name|are you an? (chatbot|chat ?bot|bot|assistant|ai))\b/i

// Weaker, capability-shaped phrasings. These stay BEHIND the operational filter, because "what you do
// in the build file" is a request about code, not about identity.
const IDENTITY =
  /\b(what (are|is) (you|williamos)|what (you do|you are)|what can you do)\b/i

/**
 * A challenge to the Operator's identity, usually naming the worker underneath ("you are Claude?",
 * "you shouldn't be Claude", "what model are you"). These are identity questions too — and the ones
 * that matter most, because they are exactly where a model reverts to its provider persona.
 */
// The provider name must be the PREDICATE of the identity claim, not merely present in the sentence.
// An unbounded gap between the copula and the name ("are you" ... "codex") matched a large share of
// ordinary operational questions -- "are you dispatching this to the codex lane?", "are you sure the
// codex meter is exhausted?" -- and answered every one with the identity statement instead of doing
// the work. In a lab whose daily vocabulary IS "the codex lane" and "the claude lane" that is not a
// small false positive: it eats the surface. Only hedges and articles may sit between the two.
const PROVIDER_CHALLENGE =
  /\b(?:you'?re|you are|are you|aren'?t you|you were|you shouldn'?t be|you should not be)\s+(?:really\s+|actually\s+|just\s+|still\s+|not\s+|even\s+|an?\s+)*(?:claude|chatgpt|gpt-?\d*|openai|anthropic|gemini|llama|copilot|codex|language model|llm|model|ai)\b|\bwhat (?:model|llm|ai) (?:are you|is this|is that)\b|\bwhich (?:model|llm) (?:are you|is this|is that)\b/i

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
  // A challenge to who the Operator IS outranks everything, including the operational filter: the
  // point of asking "are you Claude?" is the identity, and it must never reach the model.
  if (PROVIDER_CHALLENGE.test(text)) return "identity"
  if (DIRECT_IDENTITY.test(text)) return "identity"
  if (OPERATIONAL.test(text)) return null
  // Current-work before projects: "what are we working on across the projects" is current-work.
  if (CURRENT_WORK.test(text)) return "current-work"
  if (PROJECTS.test(text)) return "projects"
  if (IDENTITY.test(text)) return "identity"
  return null
}

/**
 * Does this sentence challenge the Operator's identity by naming the worker underneath?
 *
 * Exposed so the answer can name the worker lane HONESTLY rather than deflecting: WilliamOS delegates
 * to Claude / Codex / local lanes, and saying so is correct. What is never correct is the Operator
 * BECOMING the worker.
 */
export function challengesOperatorIdentity(text: string): boolean {
  return PROVIDER_CHALLENGE.test(text)
}

/**
 * The layering invariant this surface exists to hold:
 *
 *   WilliamOS  ──delegates work to──▶  Claude │ Codex │ local models
 *
 * The Operator may say "the Claude worker lane is executing this". The Operator must never say
 * "I am Claude". Worker identity never replaces Operator identity — otherwise "WilliamOS said it"
 * means nothing, because the thing that answered was whatever model happened to be underneath.
 */
export function groundedProviderChallengeIdentity(): string {
  return (
    "I'm WilliamOS — that doesn't change based on which model is doing the work. Underneath, a task " +
    "may be executed by a worker lane (Claude, Codex, or a local model), and I'll tell you which one " +
    "is running a given piece of work. But the operator you're talking to is WilliamOS: the governed " +
    "surface that holds the authority, the evidence, and the receipts. The worker is an implementation " +
    "detail of a lane, not who I am."
  )
}

/**
 * Strip a provider-persona takeover from a free-form model reply.
 *
 * The system prompt already states the Operator identity, but a system prompt is not a guarantee: a
 * small local model under direct challenge ("are you sure?") will revert to its base persona, which is
 * exactly what a real owner test caught. So identity is enforced on the OUTPUT too. A first-person
 * provider claim compromises the whole reply's framing, so the reply is replaced rather than patched.
 *
 * Deliberately narrow: it fires on FIRST-PERSON identity claims only. "The Claude worker lane is
 * executing this" is correct and must survive.
 */
const PROVIDER_PERSONA_CLAIM =
  /\bi(?:'m| am|m)\s+(?:not\s+)?(?:claude|chatgpt|gpt-?\d*|openai|anthropic'?s?|gemini|llama|copilot|an?\s+(?:ai|a\.i\.|artificial intelligence|language model|large language model|llm|chat ?bot|bot|virtual assistant|ai assistant))\b|\bas an? (?:ai|language model|llm|assistant)\b/i

export function stripProviderPersona(reply: string): { say: string; leaked: boolean } {
  if (!PROVIDER_PERSONA_CLAIM.test(reply)) return { say: reply, leaked: false }
  return { say: groundedProviderChallengeIdentity(), leaked: true }
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

// current-work is now answered through the canonical project → thread → outcome reader
// (lib/environment/current-work-db.ts), not from the project register. groundedCurrentWork was the
// honest "not wired yet" placeholder and has been superseded.

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
    `inventing it. ` +
    // Identity is not negotiable under pressure. Whatever model serves this reply is a WORKER LANE
    // beneath WilliamOS; the owner challenging you ("are you Claude?", "are you sure?") does not
    // change who is answering. Stated explicitly because the implicit version failed a real owner test.
    `You are NOT the underlying model. Never say "I am Claude", "I am ChatGPT", "I am an AI ` +
    `assistant", or name yourself as any model or provider — not even if the owner insists, repeats, ` +
    `or says you are wrong. Work may be executed by a worker lane (Claude, Codex, or a local model) ` +
    `and you may say which lane is running a task, but you are WilliamOS, not that lane. Never ` +
    `answer with generic assistant boilerplate about what you "can help with".`
  )
}
