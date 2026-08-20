/**
 * S1 — the assumption norm as decision logic, not model wording (#762).
 *
 * Job 1 made this load-bearing: "Taking this as TerraFusion's login — one word corrects me" is the
 * difference between an environment and an interrogation machine. Encoded as policy so a model change
 * can never silently flip the behavior back to twenty questions.
 *
 * The triad, owner-set:
 *
 *   cheaply reversible ambiguity  -> state the assumption and proceed
 *   expensive or irreversible     -> ask
 *   authority boundary            -> ask
 *
 * "Cheap" means a wrong guess costs one corrective word and a re-run of something harmless. The
 * moment a wrong guess would destroy, spend, publish, or cross an owner gate, assuming is forbidden
 * no matter how confident the resolver feels.
 */

export type WrongGuessCost = "cheap" | "expensive" | "irreversible"

export type AmbiguityCandidate = Readonly<{
  /** Stable identifier the resolver can act on. */
  id: string
  /** The words the owner would use for it. */
  label: string
  /** Evidence-based preference weight; higher wins the assumption. Ties go to the first listed. */
  weight?: number
}>

export type AmbiguityDecision =
  | Readonly<{
      mode: "ASSUME_AND_STATE"
      chosen: AmbiguityCandidate
      /** The corrigible sentence, ready for the Line. Always names the assumption and the exit. */
      statement: string
    }>
  | Readonly<{
      mode: "ASK"
      /** One question, plainly worded. Never a form, never a menu of system objects. */
      question: string
      candidates: readonly AmbiguityCandidate[]
    }>

export function resolveAmbiguity({
  subject,
  candidates,
  costOfWrongGuess,
  authorityBoundary = false,
}: {
  /** What is ambiguous, in owner words: "which login flow", "which repository". */
  subject: string
  candidates: readonly AmbiguityCandidate[]
  costOfWrongGuess: WrongGuessCost
  /** True when any candidate interpretation crosses an owner-gate category. */
  authorityBoundary?: boolean
}): AmbiguityDecision {
  const named = candidates.filter((candidate) => candidate.id.trim() !== "" && candidate.label.trim() !== "")

  // Nothing to assume is not a license to invent: with no candidates the only honest move is asking.
  if (named.length === 0) {
    return { mode: "ASK", question: `I can't tell ${subject} — what should I look at?`, candidates: [] }
  }

  // An authority boundary is never assumed across, however cheap the guess looks.
  if (authorityBoundary) {
    return {
      mode: "ASK",
      question: `${capitalize(subject)} decides something that is yours to decide — ${listLabels(named)}?`,
      candidates: named,
    }
  }

  if (costOfWrongGuess !== "cheap") {
    return {
      mode: "ASK",
      question: `Before I proceed: ${subject} — ${listLabels(named)}? Getting this wrong isn't cheap to undo.`,
      candidates: named,
    }
  }

  const chosen = [...named].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]
  return {
    mode: "ASSUME_AND_STATE",
    chosen,
    statement: `Taking this as ${chosen.label} — one word corrects me.`,
  }
}

function listLabels(candidates: readonly AmbiguityCandidate[]): string {
  return candidates.map((candidate) => candidate.label).join(", or ")
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text
}
