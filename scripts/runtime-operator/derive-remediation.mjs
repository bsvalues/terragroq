/**
 * Turning a finding into dispatched work, without the owner in the middle (#911).
 *
 * The loop could execute a work order and could refuse one. It could not *create* one, so anything it
 * discovered mid-objective terminated at a message to the owner -- even a finding whose remediation was
 * ordinary bounded engineering. #911 is the worked example: the inventory was complete, the ordering was
 * justified, the highest-priority item was reversible drift repair, and the run still stopped to ask
 * which item to do.
 *
 * A derived work order **inherits** its objective's authority. It never mints any. Three properties do
 * the work, and each exists because its absence would be a way to grant yourself permission:
 *
 *   1. it carries the objective's own `grantRef`, so authority is traceable to something the owner froze;
 *   2. it may only touch paths inside the objective's reservation, so discovery cannot widen scope;
 *   3. it is refused whenever `classifyProposedAction` names an owner gate.
 *
 * The third is the honest one. This module's purpose is to stop asking permission for work that needs
 * none -- which is only safe because it still stops dead for the six things that do.
 */
import { classifyProposedAction } from "./owner-gate-policy.mjs"

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
 * Decide what to do about a finding, under an objective's authority.
 *
 * Returns either a work order the kernel can dispatch, or the gate that stopped it. Never both, and
 * never a question addressed to the owner about work that policy already permits.
 */
export function deriveRemediationWorkOrder({ objective, finding, now = () => new Date().toISOString() }) {
  if (!objective?.grantRef || !Array.isArray(objective.allowedPaths) || objective.allowedPaths.length === 0) {
    return { dispatch: null, gate: { gated: true, gate: "SCOPE", reason: "no authorised objective to inherit authority from" } }
  }

  const paths = Array.isArray(finding?.paths) ? finding.paths.filter(Boolean) : []
  const escaping = paths.filter((candidate) => !withinReservation(candidate, objective.allowedPaths))

  // Scope is decided here rather than trusted from the finding: a finding that declares itself in scope
  // while naming paths outside it is exactly the case this check exists for.
  const effects = {
    ...(finding?.effects ?? {}),
    outsideObjectiveScope: Boolean(finding?.effects?.outsideObjectiveScope) || escaping.length > 0,
  }

  const classification = classifyProposedAction({ summary: finding?.summary, effects })
  if (classification.gated) {
    return {
      dispatch: null,
      gate: { ...classification, ...(escaping.length > 0 ? { escapingPaths: escaping } : {}) },
    }
  }

  return {
    dispatch: {
      workOrderId: `${objective.workOrderId}-R${String(finding.sequence ?? 1).padStart(2, "0")}`,
      derivedFrom: objective.workOrderId,
      grantRef: objective.grantRef,
      adapterId: objective.adapterId,
      authority: "APPROVED",
      riskClass: objective.riskClass ?? "R1",
      // Inherited, never self-declared: a derived order cannot decide it needs no owner gate, because
      // the classification above already decided that and refused if it did.
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
