/**
 * Whether a proposed action needs the owner, or may proceed through engineering gates.
 *
 * The kernel could already refuse an action (`isOwnerWall`) and could already carry a work order whose
 * `ownerGateRequired` flag was decided by whoever wrote the row. What it could never do is look at work
 * it had just identified and answer "may I do this?" -- so every finding terminated at *awaiting your
 * direction*, including findings whose answer policy already contained. That is the babysitting defect
 * in one sentence: the system equated **I found the next work** with **ask the owner whether to do it**.
 *
 * The owner is interrupted for six things and nothing else:
 *
 *   money · destructive irreversible action · policy choice · credentials and identity ·
 *   scope change · competing business priorities
 *
 * Everything else is ordinary engineering and goes through implementation, independent review,
 * validation and merge, which are gates of a different kind: they judge the work, not the authority.
 *
 * Classification reads **declared effects, never prose.** An action states what it does and the policy
 * answers; it does not guess intent from a summary. Inferring authority from free text is how a lane
 * talks itself into a permission, and this codebase has already been bitten once by a parser that read
 * meaning out of a description (`parseProjectionIssue`).
 */

/** The only reasons a bounded engineering action stops for the owner. */
export const OWNER_GATES = Object.freeze({
  MONEY: "spends money or commits to a cost",
  DESTRUCTIVE: "destroys or moves data with no verified copy elsewhere",
  POLICY: "changes a reviewed policy, doctrine, or an identity pin",
  CREDENTIALS: "handles credentials, secrets, or machine identity",
  SCOPE: "falls outside the authorised objective's scope",
  PRIORITY: "competes with another business priority the owner ranks",
})

/**
 * Declared effects of a proposed action.
 *
 * Absent fields mean "no such effect", which is the safe default only because the caller is required to
 * declare positively. An action that cannot describe its own effects is not classified as harmless --
 * see `unclassifiable`.
 */
export function classifyProposedAction(action) {
  const declared = action?.effects
  if (!declared || typeof declared !== "object") {
    return {
      gated: true,
      gate: "SCOPE",
      reason: "the action declared no effects, so nothing can be said about it",
      unclassifiable: true,
    }
  }

  const gates = []
  if (declared.spendsMoney) gates.push("MONEY")
  if (declared.touchesCredentials) gates.push("CREDENTIALS")
  if (declared.changesReviewedPolicy) gates.push("POLICY")
  if (declared.outsideObjectiveScope) gates.push("SCOPE")
  if (declared.competesWithPriority) gates.push("PRIORITY")

  // Destruction gates on evidence, not on the word "delete". Removing a copy that is provably
  // duplicated elsewhere is cleanup; removing the only copy is the owner's call. The difference is a
  // verified duplicate, and "verified" means someone checked -- not that it seems likely.
  const destroys = Array.isArray(declared.destroys) ? declared.destroys : []
  const unverified = destroys.filter((target) => !target?.verifiedCopyElsewhere)
  if (unverified.length > 0) gates.push("DESTRUCTIVE")

  // Irreversibility is its own gate even without destruction: an action nobody can undo deserves the
  // owner regardless of how reversible its author believes it to be.
  if (declared.irreversible) gates.push("DESTRUCTIVE")

  if (gates.length === 0) {
    return {
      gated: false,
      gate: null,
      reason: "bounded engineering inside an authorised objective; review and validation are the gates",
      unclassifiable: false,
    }
  }

  const gate = gates[0]
  return {
    gated: true,
    gate,
    gates: [...new Set(gates)],
    reason: OWNER_GATES[gate],
    unclassifiable: false,
    ...(unverified.length > 0 ? { unverified: unverified.map((target) => target.path) } : {}),
  }
}

/**
 * What the owner should see, in the two shapes the owner-facing state is allowed to take.
 *
 * Anything ungated is progress and must never arrive as a question.
 */
export function ownerFacingState(classification) {
  return classification.gated
    ? `Blocked · owner decision required: ${classification.reason}`
    : "Working · proceeding automatically · no action required"
}
