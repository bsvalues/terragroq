/**
 * Rules for what a capability measurement is allowed to conclude (#905).
 *
 * Kept in its own module with no side effects, so the rules can be tested without running a
 * measurement. The instrument that performs one is a script: importing it starts work.
 */

/**
 * What a failed dispatch is allowed to mean.
 *
 * `MEASURED_INCAPABLE` is a claim about a model, and it may only be made when the model actually ran
 * and returned something inadequate. The first measurement of `hermes-local` nearly recorded that
 * verdict twice for failures outside the model boundary:
 *
 *   PROCESS_WALL:pwsh   the invoker crashed because the inference upstream was unreachable -- the
 *                       `ollama` container sat on the default bridge network instead of the one its
 *                       own compose stack declares. The model was never asked a question.
 *   PATCH_EMPTY_WALL    the model had already written a correct function, and collection looked for
 *                       it with `git diff --cached` in a tree where the change was unstaged.
 *
 * A contaminated verdict is worse than no verdict, because the next model comparison inherits it and
 * starts from a lie. Matching is anchored deliberately: a model that echoes a wall name in its own
 * output must not be able to talk its way out of an incapable verdict.
 */
export function classifyDispatchFailure(message) {
  const text = String(message ?? "")
  const provider = /^PROVIDER_LANE_([A-Z_]+)/.exec(text)
  if (provider) return { verdict: `BLOCKED_${provider[1]}`, aboutTheModel: false }
  if (/^PROCESS_WALL:/.test(text)) return { verdict: "BLOCKED_INVOKER_PROCESS_FAILED", aboutTheModel: false }
  // Collection defects are ours. An empty patch is a statement about the lane only once the collection
  // is known to have looked in the tree the provider actually edits.
  if (/^PATCH_EMPTY_WALL$/.test(text)) return { verdict: "BLOCKED_PATCH_COLLECTION", aboutTheModel: false }
  return { verdict: "MEASURED_INCAPABLE", aboutTheModel: true }
}
