/**
 * Summoning surfaces (phase 3 of the primary experience replacement).
 *
 * The old product made Projects, Activity and System into APPLICATIONS: destinations with routes, a
 * permanent explorer nailed to one side and inspector tabs nailed to the other. That is the shape that
 * taught every agent WilliamOS was a website with sections, and it is the shape the owner ordered
 * removed. The capabilities were never the problem — being *places* was.
 *
 * So they become surfaces the world summons when they are relevant and drops when they are not. "Show
 * TerraFusion projects" opens a project surface; it does not navigate anywhere, and nothing is left
 * nailed to the screen afterwards.
 *
 * This module is pure and deliberately conservative. The lesson already paid for in the identity
 * classifier applies here too: a matcher that fires on any appearance of a word does not help an
 * operator, it hijacks their sentences. "Open the projects page source" is a request about code, not a
 * request for the project registry.
 */

export type SummonedSurface = "project" | "activity" | "evidence" | "work-orders" | "decisions"

/**
 * An operational request — show/open/edit a file, page, route, component — is about code, and must
 * reach normal handling even when it names one of these words.
 */
const OPERATIONAL = /\b(source|file|route|endpoint|component|repo|repository|commit|branch|import|function)\b/i

/** The project registry: what work exists, what is active, what is on standby. */
const PROJECT =
  /\b(show|open|list|bring up|pull up|what|which)\b[^?]*\bprojects?\b|\bprojects? (surface|registry|list)\b/i

/** What the runtime and lanes are doing right now. */
const ACTIVITY =
  // "what's" carries no space, so the contraction has to be part of the verb alternative rather than
  // a separate word — the kind of gap that silently drops the most natural phrasing an owner uses.
  /\bwhat(?:'s|s|\s+is)\s+(hermes|the runtime|the lane|the worker|it)\s+doing\b|\b(show|open|bring up)\b[^?]*\b(activity|execution|runtime|lanes?)\b|\bwhat(?:'s|s|\s+is)\s+running\b/i

/**
 * Work orders: the governed units of delivery. Migrated from the /work-orders route, which held this
 * as a destination with a permanent page around it.
 */
const WORK_ORDERS =
  /\b(show|open|list|bring up|pull up|what)\b[^?]*\bwork[ -]?orders?\b|\bwork[ -]?orders?\b\s*(surface|queue|list)\b/i

/**
 * The decision register: ADR-style records carrying authority, evidence and supersession lineage.
 * Migrated from /decisions, which held the register as a destination.
 */
const DECISIONS =
  /\b(show|open|list|bring up|pull up|what)\b[^?]*\bdecisions?\b|\bdecision (register|queue|log)\b/i

/** The record: evidence, proof, receipts, the technical detail behind a result. */
const EVIDENCE =
  /\b(show|open|bring up|give me|i need)\b[^?]*\b(evidence|proof|receipts?|technical details?|the record)\b|\bwhat proves\b/i

/**
 * Which surface, if any, this sentence summons.
 *
 * Returns null for everything else, so ordinary conversation and real work are never swallowed by a
 * matcher. Order matters only where a sentence could plausibly be read two ways; each pattern is
 * anchored to a request shape ("show me…", "what is X doing"), not to a bare noun.
 */
export function classifySummon(text: string): SummonedSurface | null {
  if (OPERATIONAL.test(text)) return null
  if (WORK_ORDERS.test(text)) return "work-orders"
  if (DECISIONS.test(text)) return "decisions"
  if (EVIDENCE.test(text)) return "evidence"
  if (ACTIVITY.test(text)) return "activity"
  if (PROJECT.test(text)) return "project"
  return null
}

/**
 * Sentences that DISMISS a surface. The owner said it plainly: "and when those aren't useful anymore,
 * they disappear." A surface you can only accumulate is a panel with extra steps.
 */
const DISMISS = /\b(hide|close|dismiss|get rid of|drop|remove)\b[^?]*\b(browser|diff|tests?|trace|source|project|activity|evidence|work[ -]?orders?|decisions?|surface|panel|logs?|it|that|them|everything|all)\b/i

export function classifyDismissal(text: string): "all" | string | null {
  if (!DISMISS.test(text)) return null
  if (/\b(everything|all|them)\b/i.test(text)) return "all"
  // Work orders first: "work order" contains no other surface name, but listing it ahead of the
  // single-word alternatives keeps the match unambiguous as this list grows with each migration.
  const named = /\b(work[ -]?orders?|decisions?|browser|diff|tests?|trace|source|project|activity|evidence|logs?)\b/i.exec(text)
  if (!named) return "all"
  const subject = named[1].toLowerCase()
  // "logs" is what an owner calls the trace surface; honour their word, not ours.
  if (subject.startsWith("log")) return "trace"
  if (subject === "test") return "tests"
  if (/^work/.test(subject)) return "work-orders"
  if (/^decision/.test(subject)) return "decisions"
  return subject
}
