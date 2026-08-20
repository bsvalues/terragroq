/**
 * Whether a proposed action needs the owner, or may proceed through engineering gates.
 *
 * The kernel could already refuse an action (`isOwnerWall`) and could already carry a work order whose
 * `ownerGateRequired` flag was decided by whoever wrote the row. What it could never do is look at work
 * it had just identified and answer "may I do this?" -- so every finding terminated at *awaiting your
 * direction*, including findings whose answer policy already contained. That is the babysitting defect
 * in one sentence: the system equated **I found the next work** with **ask the owner whether to do it**.
 *
 * The categories are the playbook's, not invented here. Section 6 states that a materially new
 * *protected, production, destructive, financial, legal, credential, or scope-expanding* action still
 * requires a new owner decision. An earlier draft of this module named six gates from memory and
 * silently dropped production-data mutation, release and cutover authority, protected resources, and
 * unresolved legal, privacy or security risk. A policy that omits controlling gates does not merely
 * fail to stop -- it launders those actions as routine.
 *
 * Everything outside the list is ordinary engineering and goes through implementation, independent
 * review, validation and merge, which are gates of a different kind: they judge the work, not the
 * authority.
 *
 * Classification reads **declared effects, never prose.** An action states what it does and the policy
 * answers; it does not guess intent from a summary. Inferring authority from free text is how a lane
 * talks itself into a permission, and this codebase has already been bitten once by a parser that read
 * meaning out of a description (`parseProjectionIssue`).
 */

/** The only reasons a bounded engineering action stops for the owner. Canonical per playbook section 6. */
export const OWNER_GATES = Object.freeze({
  FINANCIAL: "spends money or commits to a cost",
  DESTRUCTIVE: "destroys or moves data with no verified copy elsewhere, or cannot be undone",
  PRODUCTION: "mutates production data, or carries release or cutover authority",
  PROTECTED: "touches a protected resource or scope",
  LEGAL: "carries unresolved legal, privacy, or security risk that nobody has accepted",
  CREDENTIALS: "handles credentials, secrets, or machine identity",
  POLICY: "changes a reviewed policy, doctrine, or an identity pin",
  SCOPE: "falls outside the authorised objective's scope",
  PRIORITY: "competes with another business priority the owner ranks",
})

/**
 * Effect flags that gate directly, in the order they are reported.
 *
 * Declared positively by the caller. A flag that is present but not a boolean is treated as set: a
 * malformed declaration is a reason to stop, never a reason to continue.
 */
const DIRECT_GATES = [
  ["spendsMoney", "FINANCIAL"],
  ["irreversible", "DESTRUCTIVE"],
  ["mutatesProductionData", "PRODUCTION"],
  ["releaseOrCutover", "PRODUCTION"],
  ["protectedResource", "PROTECTED"],
  ["unresolvedLegalPrivacyOrSecurityRisk", "LEGAL"],
  ["touchesCredentials", "CREDENTIALS"],
  ["changesReviewedPolicy", "POLICY"],
  ["outsideObjectiveScope", "SCOPE"],
  ["competesWithPriority", "PRIORITY"],
]

function refuse(gate, reason, extra = {}) {
  return { gated: true, gate, gates: [gate], reason, unclassifiable: false, ...extra }
}

/**
 * Classify a proposed action.
 *
 * Fails closed on anything it cannot read. The dangerous default is not "gated"; it is a silent pass
 * for an action nobody characterised.
 */
export function classifyProposedAction(action) {
  const declared = action?.effects
  if (declared === null || declared === undefined || typeof declared !== "object" || Array.isArray(declared)) {
    return {
      gated: true,
      gate: "SCOPE",
      gates: ["SCOPE"],
      reason: "the action declared no readable effects, so nothing can be said about it",
      unclassifiable: true,
    }
  }

  const gates = []
  for (const [field, gate] of DIRECT_GATES) {
    const value = declared[field]
    if (value === undefined || value === false) continue
    // Anything else -- true, a string, an object, a number -- gates. A caller that cannot state a flag
    // as a boolean has not stated it.
    gates.push(gate)
  }

  // Destruction gates on evidence, not on the word "delete". Removing a copy provably duplicated
  // elsewhere is cleanup; removing the only copy is the owner's call. "Verified" means someone checked.
  const destroys = declared.destroys
  if (destroys !== undefined) {
    if (!Array.isArray(destroys)) {
      // A malformed declaration previously degraded to [] and skipped the gate entirely -- the one
      // shape of this field that must never be read as "destroys nothing".
      return refuse("DESTRUCTIVE", "the destroys declaration is malformed and cannot be evaluated", {
        unclassifiable: true,
      })
    }
    const unverified = destroys.filter(
      (target) => !target || typeof target !== "object" || target.verifiedCopyElsewhere !== true,
    )
    if (unverified.length > 0) {
      gates.push("DESTRUCTIVE")
      const named = unverified.map((target) => target?.path ?? "(unnamed target)")
      const gate = gates[0]
      return {
        gated: true,
        gate,
        gates: [...new Set(gates)],
        reason: OWNER_GATES[gate],
        unclassifiable: false,
        unverified: named,
      }
    }
  }

  if (gates.length === 0) {
    return {
      gated: false,
      gate: null,
      gates: [],
      reason: "bounded engineering inside an authorised objective; review and validation are the gates",
      unclassifiable: false,
    }
  }

  const gate = gates[0]
  return { gated: true, gate, gates: [...new Set(gates)], reason: OWNER_GATES[gate], unclassifiable: false }
}

/**
 * What the owner should see, in the two shapes owner-facing state is allowed to take.
 *
 * Anything ungated is progress and must never arrive as a question.
 */
export function ownerFacingState(classification) {
  return classification.gated
    ? `Blocked · owner decision required: ${classification.reason}`
    : "Working · proceeding automatically · no action required"
}
