/**
 * Admit an ordinary-language objective as durable work.
 *
 * #871 boundary 1: an objective submitted to WilliamOS returned a page to navigate to. Nothing was
 * recorded, so there was nothing to refer to later, nothing to resume, and no way to ask "has this
 * already been done" -- which is how the same PACS work was rediscovered and nearly redone.
 *
 * What this deliberately does NOT do is interpret the objective. The previous behaviour classified
 * intent with regexes and returned a destination; expanding those patterns would only teach the
 * classifier more phrasings while leaving the actual defect -- nothing becomes work -- in place. #871
 * rules that out explicitly. Admission is therefore unconditional for a well-formed objective: the
 * system records that it was asked, by whom, and gives it an identity.
 *
 * Admission is not authorisation. The work order is created as a draft with no authority, because
 * being asked to do something has never been the same as being permitted to do it.
 */

export const MAX_OBJECTIVE_LENGTH = 2000
const MAX_TITLE_LENGTH = 120

export interface AdmissionVerdict {
  ok: boolean
  failure?: "OBJECTIVE_EMPTY" | "OBJECTIVE_TOO_LONG"
  detail?: string
}

export function assertAdmissible(raw: unknown): AdmissionVerdict {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, failure: "OBJECTIVE_EMPTY", detail: "an objective is required" }
  }
  if (raw.trim().length > MAX_OBJECTIVE_LENGTH) {
    return {
      ok: false,
      failure: "OBJECTIVE_TOO_LONG",
      detail: `an objective may be at most ${MAX_OBJECTIVE_LENGTH} characters`,
    }
  }
  return { ok: true }
}

/** Collapse whitespace so the same objective submitted twice is recognisably the same text. */
export function normaliseObjective(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

/**
 * A short title for the work order, taken from the objective itself.
 *
 * Cut at a word boundary rather than mid-word: this string is what a human scans in a list, and
 * "Determine what the recovered OMEN Bent" reads as corruption rather than as a title.
 */
export function objectiveTitle(objective: string): string {
  const normalised = normaliseObjective(objective)
  const firstSentence = normalised.split(/(?<=[.?!])\s/)[0] ?? normalised
  const candidate = firstSentence.length <= MAX_TITLE_LENGTH ? firstSentence : normalised
  if (candidate.length <= MAX_TITLE_LENGTH) return candidate
  const cut = candidate.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
