/**
 * Recording a decision from the Line.
 *
 * The /decisions route held an ADR authoring form. Unlike the work-order form — which was a second
 * way to do what naming an outcome already does — recording a decision with rationale and
 * consequences is a governance ACT with no environment equivalent, so it had to exist here before
 * that route could be deleted. Migrating a capability means the capability survives.
 *
 * This is a WRITE reached by typing a sentence, which makes accidental firing the whole risk. It
 * follows the discipline already paid for by START_WORK: an explicit trigger, and a hard refusal on
 * anything interrogative, negated, or hypothetical. "Should we record a decision about Postgres?" must
 * never record a decision about Postgres.
 */

export type RecordedDecision = Readonly<{
  title: string
  decision: string
  rationale: string | null
}>

/**
 * The explicit act. A bare "decide" or a passing mention of the word "decision" is not enough: the
 * owner must be saying "write this down", and the sentence must carry the thing to write.
 */
const TRIGGER = /\b(record|log|capture|write down|note)\b[^:]{0,24}\bdecisions?\b\s*[:\-—]?\s*|^\s*decision\s*[:\-—]\s*|^\s*decide\s*[:\-—]\s*/i

/**
 * Anything that makes the sentence non-committal. Questions, negations and hypotheticals all reach
 * ordinary handling instead — a governance record must never be created by a sentence that was
 * wondering aloud.
 */
const NOT_COMMITTAL =
  /\?|\b(don'?t|do not|never|shouldn'?t|should not|can'?t|cannot|won'?t|no need)\b|\b(should|would|could|might|maybe|perhaps|if|whether|suppose|what if|how do i|can i|do we)\b/i

/** Rationale, when the owner supplies one in the same breath. */
const BECAUSE = /\s+\b(because|since|as|so that)\b\s+/i

/** A title long enough to identify the decision, short enough to read in a register. */
const MAX_TITLE = 120
const MAX_TEXT = 2000

/**
 * The decision this sentence records, or null when the sentence is not recording one.
 *
 * Null is the safe answer and the common one: everything that is not an explicit, committal record
 * falls through to normal handling rather than silently entering the governance register.
 */
export function classifyDecisionRecord(text: string): RecordedDecision | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_TEXT) return null
  if (NOT_COMMITTAL.test(trimmed)) return null

  const match = TRIGGER.exec(trimmed)
  if (!match) return null
  // Only a leading trigger records: "the report mentions we should record a decision" is discussion
  // about recording, not an instruction to record.
  if (match.index !== 0) return null

  const body = trimmed.slice(match.index + match[0].length).trim()
  // A trigger with nothing after it is an intention, not a decision. Refusing here is what makes the
  // Line ask rather than file an empty governance record.
  if (body.length < 8) return null

  const split = BECAUSE.exec(body)
  const statement = (split ? body.slice(0, split.index) : body).trim().replace(/[.\s]+$/, "")
  const rationale = split ? body.slice(split.index + split[0].length).trim().replace(/[.\s]+$/, "") : null
  if (statement.length < 8) return null

  return {
    title: statement.length > MAX_TITLE ? `${statement.slice(0, MAX_TITLE - 1).trimEnd()}…` : statement,
    // The decision text keeps the owner's whole sentence, rationale included: the register should read
    // the way they said it, not the way this parser chopped it.
    decision: body,
    rationale: rationale && rationale.length > 0 ? rationale : null,
  }
}

/**
 * What the Line says after recording.
 *
 * It states the authority it actually used. The Line records decisions as PROPOSED and ADVISORY —
 * binding authority is minted by the governed authorization path with evidence behind it, and a
 * sentence typed into a conversational input is not that. Saying so plainly is the difference between
 * a register the owner can trust and one that quietly inflates its own weight.
 */
export function composeDecisionRecorded(ref: string | null, recorded: RecordedDecision): string {
  const named = ref ? `${ref}` : "the decision"
  return (
    `Recorded ${named}: "${recorded.title}"${recorded.rationale ? ` — because ${recorded.rationale}` : ""}. ` +
    `It is in the register as proposed and advisory. Binding authority comes from the governed ` +
    `authorization path with evidence behind it, not from a sentence here, so I did not claim it.`
  )
}

/**
 * Superseding an existing decision.
 *
 * The register carries supersession lineage, which is the part that makes it a register rather than a
 * pile of notes: a decision that has been replaced must point at what replaced it. That capability
 * existed only in the retired ADR form, so it lives here now — the Line can replace a decision by
 * naming the one it replaces.
 */
export type SupersedingDecision = RecordedDecision & Readonly<{ supersedes: string }>

/**
 * "record a decision superseding ADR-0007: ..." — the ref is required and explicit.
 *
 * `ADR-` and not `DECISION-`. This pattern originally demanded `DECISION-<digits>`, a reference
 * format the register has never issued: `nextRef()` in `app/actions/decisions.ts` mints `ADR-0001`,
 * `ADR-0002`, and the Desk's decision surface prints exactly that. So the owner read `ADR-0007` off
 * their own screen, typed it back, and this refused to see a supersession at all — the sentence then
 * fell through to plain recording and filed a lineage-less decision titled "superseding ADR-0007:
 * …". Nothing errored. The capability the deletion of /decisions was justified by simply did not
 * exist, and the tests agreed with the bug because they were written against the same invented
 * format.
 */
const SUPERSEDE =
  /^\s*(?:record|log|capture|note)?\s*(?:a\s+)?decisions?\s+(?:that\s+)?supersed(?:es|ing)\s+(ADR-\d+)\s*[:\-—]?\s*/i

/**
 * The sentence is TRYING to supersede something, whether or not it named a reference this can
 * resolve.
 *
 * Refusing an unresolvable reference is not enough on its own: without this, "record a decision
 * superseding the old one: …" is null here, reaches `classifyDecisionRecord`, and records an
 * ordinary decision — the owner asked to replace a record and got a new unrelated one, silently.
 * The Line uses this to refuse and say what form it needs instead of writing the wrong thing.
 */
const SUPERSEDE_INTENT = /^\s*(?:record|log|capture|note)?\s*(?:a\s+)?decisions?\s+(?:that\s+)?supersed(?:es|ing)\b/i

export function mentionsSupersession(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_TEXT) return false
  if (NOT_COMMITTAL.test(trimmed)) return false
  return SUPERSEDE_INTENT.test(trimmed)
}

/** The reference form the register actually issues, normalized so ADR-7 finds ADR-0007. */
export function normalizeDecisionRef(raw: string): string {
  const match = /^ADR-(\d+)$/i.exec(raw.trim())
  if (!match) return raw.trim().toUpperCase()
  return `ADR-${match[1].padStart(4, "0")}`
}

/**
 * The superseding decision this sentence records, or null.
 *
 * Requires an explicit ADR-#### reference: replacing the wrong decision is worse than not replacing
 * one, so nothing here guesses which decision was meant. When the sentence clearly meant to supersede
 * and this returns null anyway, `mentionsSupersession` is what stops the Line writing something else.
 */
export function classifySupersedingDecision(text: string): SupersedingDecision | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_TEXT) return null
  if (NOT_COMMITTAL.test(trimmed)) return null
  const match = SUPERSEDE.exec(trimmed)
  if (!match) return null

  const body = trimmed.slice(match[0].length).trim()
  if (body.length < 8) return null
  const split = BECAUSE.exec(body)
  const statement = (split ? body.slice(0, split.index) : body).trim().replace(/[.\s]+$/, "")
  const rationale = split ? body.slice(split.index + split[0].length).trim().replace(/[.\s]+$/, "") : null
  if (statement.length < 8) return null

  return {
    supersedes: normalizeDecisionRef(match[1]),
    title: statement.length > MAX_TITLE ? `${statement.slice(0, MAX_TITLE - 1).trimEnd()}…` : statement,
    decision: body,
    rationale: rationale && rationale.length > 0 ? rationale : null,
  }
}

export function composeDecisionSuperseded(ref: string | null, recorded: SupersedingDecision): string {
  return (
    `Recorded ${ref ?? "the decision"}: "${recorded.title}", superseding ${recorded.supersedes}. ` +
    `${recorded.supersedes} stays in the register marked superseded rather than being deleted — the ` +
    `lineage is the point. The new record is proposed and advisory; binding authority still comes from ` +
    `the governed authorization path.`
  )
}
