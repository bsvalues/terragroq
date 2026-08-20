/**
 * Turning a finding into dispatched work, without the owner in the middle (#911).
 *
 * The loop could execute a work order and could refuse one. It could not *create* one, so anything it
 * discovered mid-objective terminated at a message to the owner -- even a finding whose remediation was
 * ordinary bounded engineering. #911 is the worked example: the inventory was complete, the ordering was
 * justified, the highest-priority item was reversible drift repair, and the run still stopped to ask
 * which item to do.
 *
 * A derived work order **inherits** its objective's authority. It never mints any. Four properties do
 * the work, and each exists because its absence is a way to grant yourself permission:
 *
 *   1. the parent's authority must be currently valid -- an approved child cannot descend from a
 *      revoked, expired or unapproved parent, which the first draft of this module allowed;
 *   2. it may only touch paths inside the objective's reservation, so discovery cannot widen scope;
 *   3. it is refused whenever `classifyProposedAction` names an owner gate;
 *   4. effects are passed through untouched -- the first draft defaulted a missing declaration to `{}`,
 *      which turned the classifier's fail-closed behaviour into a silent pass. A gate you build and
 *      then normalise around is not a gate.
 */
import { classifyProposedAction } from "./owner-gate-policy.mjs"

/** Parent authority states a child may descend from. Anything else, including absent, is refused. */
const VALID_PARENT_AUTHORITY = new Set(["APPROVED"])
const VALID_GRANT_STATUS = new Set(["active"])

/** A path is inside the reservation when the reservation names it or a directory containing it. */
export function withinReservation(candidate, reservation) {
  const target = String(candidate).replaceAll("\\", "/")
  return (reservation ?? []).some((entry) => {
    const normalized = String(entry).replaceAll("\\", "/").replace(/\/\*\*$/, "")
    if (!normalized) return false
    return target === normalized || target.startsWith(`${normalized}/`)
  })
}

/**
 * Whether an objective can currently father derived work.
 *
 * Checked on every derivation rather than once at intake: a grant revoked mid-objective must stop the
 * next derived child, not only the next objective.
 */
export function parentAuthorityValid(objective) {
  if (!objective?.grantRef) return { valid: false, reason: "no authorised objective to inherit authority from" }
  if (!Array.isArray(objective.allowedPaths) || objective.allowedPaths.length === 0) {
    return { valid: false, reason: "the objective declares no reservation, so a child could not be bounded" }
  }
  if (!VALID_PARENT_AUTHORITY.has(objective.authority)) {
    return { valid: false, reason: `the parent objective's authority is ${objective.authority ?? "unstated"}, not APPROVED` }
  }
  if (!VALID_GRANT_STATUS.has(objective.grantStatus)) {
    return { valid: false, reason: `the parent grant ${objective.grantRef} is ${objective.grantStatus ?? "of unstated status"}, not active` }
  }
  if (objective.grantExpiresAt && Date.parse(objective.grantExpiresAt) <= Date.now()) {
    return { valid: false, reason: `the parent grant ${objective.grantRef} expired at ${objective.grantExpiresAt}` }
  }
  return { valid: true, reason: null }
}

/**
 * Decide what to do about one finding, under an objective's authority.
 *
 * Returns either a work order the kernel can dispatch, or the gate that stopped it. Never both, and
 * never a question addressed to the owner about work that policy already permits.
 */
export function deriveRemediationWorkOrder({ objective, finding, now = () => new Date().toISOString() }) {
  const parent = parentAuthorityValid(objective)
  if (!parent.valid) {
    return { dispatch: null, gate: { gated: true, gate: "SCOPE", gates: ["SCOPE"], reason: parent.reason, unclassifiable: true } }
  }

  const paths = Array.isArray(finding?.paths) ? finding.paths.filter(Boolean) : []
  const escaping = paths.filter((candidate) => !withinReservation(candidate, objective.allowedPaths))

  // Effects are forwarded exactly as declared. If the finding declared none, the classifier fails closed
  // on its own, which is the whole point of it doing so.
  const declared = finding?.effects
  const effects =
    declared === null || declared === undefined || typeof declared !== "object" || Array.isArray(declared)
      ? declared
      // Scope is decided here rather than trusted: a finding that declares itself in scope while naming
      // paths outside it is exactly the case this exists for.
      : { ...declared, outsideObjectiveScope: Boolean(declared.outsideObjectiveScope) || escaping.length > 0 }

  const classification = classifyProposedAction({ summary: finding?.summary, effects })
  if (classification.gated) {
    return { dispatch: null, gate: { ...classification, ...(escaping.length > 0 ? { escapingPaths: escaping } : {}) } }
  }

  return {
    dispatch: {
      workOrderId: `${objective.workOrderId}-R${String(finding.sequence ?? 1).padStart(2, "0")}`,
      derivedFrom: objective.workOrderId,
      grantRef: objective.grantRef,
      adapterId: objective.adapterId,
      authority: "APPROVED",
      riskClass: objective.riskClass ?? "R1",
      // Inherited, never self-declared: the classification above already refused anything gated.
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: objective.baseBranch ?? "main",
      mergeMode: objective.mergeMode ?? "AUTO_ELIGIBLE",
      allowedPaths: paths.length > 0 ? paths : objective.allowedPaths,
      requiredValidation: objective.requiredValidation ?? ["test", "build"],
      dependencies: [],
      task: finding.task ?? finding.summary,
      agent: objective.agent ?? "codex",
      derivedAt: now(),
    },
    gate: null,
  }
}

/**
 * Classify every finding of a cycle independently.
 *
 * One gated finding must not stall the rest. #911 is precisely this shape: relocating pinned paths is a
 * policy decision the owner owns, and it must not hold up the compose reconciliation sitting beside it,
 * which needs nobody. A plan that stops at the first gate reintroduces the defect one layer down.
 */
export function deriveRemediationPlan({ objective, findings, now = () => new Date().toISOString() }) {
  const dispatch = []
  const gated = []
  for (const finding of Array.isArray(findings) ? findings : []) {
    const result = deriveRemediationWorkOrder({ objective, finding, now })
    if (result.dispatch) dispatch.push(result.dispatch)
    else gated.push({ finding: finding?.summary ?? "(unnamed finding)", ...result.gate })
  }
  return { dispatch, gated }
}
