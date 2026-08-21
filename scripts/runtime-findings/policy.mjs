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

const DIRECT_GATES = Object.freeze([
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
])

const SOURCE_BINDING_FIELDS = Object.freeze([
  "sourceCheckpointId", "sourceCheckpointDigest", "contractId", "contractDigest",
  "contractVersion", "contractRepository", "contractLane", "authorizationDecisionId",
  "implementationGrantId", "projectionCompletionOwned", "deliveryAuthorityLevel",
  "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed",
])

export function blocksAction(blockedActions, action) {
  if (!Array.isArray(blockedActions) || typeof action !== "string") return false
  const normalizedAction = action.trim().toLowerCase()
  if (!normalizedAction) return false
  return blockedActions.some((blocked) => (
    typeof blocked === "string" && blocked.trim() !== ""
      && normalizedAction.includes(blocked.trim().toLowerCase())
  ))
}

function refuse(gate, reason, extra = {}) {
  return { gated: true, gate, gates: [gate], reason, unclassifiable: false, ...extra }
}

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
    if (value !== undefined && value !== false) gates.push(gate)
  }
  if (declared.destroys !== undefined) {
    if (!Array.isArray(declared.destroys)) {
      return refuse("DESTRUCTIVE", "the destroys declaration is malformed and cannot be evaluated", {
        unclassifiable: true,
      })
    }
    const unverified = declared.destroys.filter(
      (target) => !target || typeof target !== "object" || target.verifiedCopyElsewhere !== true,
    )
    if (unverified.length > 0) {
      gates.push("DESTRUCTIVE")
      const gate = gates[0]
      return {
        gated: true,
        gate,
        gates: [...new Set(gates)],
        reason: OWNER_GATES[gate],
        unclassifiable: false,
        unverified: unverified.map((target) => target?.path ?? "(unnamed target)"),
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

export function ownerFacingState(classification) {
  return classification.gated
    ? `Blocked · owner decision required: ${classification.reason}`
    : "Working · proceeding automatically · no action required"
}

export function withinReservation(candidate, reservation) {
  const target = String(candidate).replaceAll("\\", "/")
  return (reservation ?? []).some((entry) => {
    const declared = String(entry).replaceAll("\\", "/")
    const subtree = declared.endsWith("/**")
    const normalized = subtree ? declared.slice(0, -3) : declared
    return Boolean(normalized) && (target === normalized || (subtree && target.startsWith(`${normalized}/`)))
  })
}

export function parentAuthorityValid(objective, now = Date.now()) {
  if (!objective?.grantRef) return { valid: false, reason: "no authorised objective to inherit authority from" }
  if (!Array.isArray(objective.allowedPaths) || objective.allowedPaths.length === 0) {
    return { valid: false, reason: "the objective declares no reservation, so a child could not be bounded" }
  }
  if (objective.authority !== "APPROVED") {
    return { valid: false, reason: `the parent objective's authority is ${objective.authority ?? "unstated"}, not APPROVED` }
  }
  if (objective.grantStatus !== "active") {
    return { valid: false, reason: `the parent grant ${objective.grantRef} is ${objective.grantStatus ?? "of unstated status"}, not active` }
  }
  if (objective.grantExpiresAt && Date.parse(objective.grantExpiresAt) <= now) {
    return { valid: false, reason: `the parent grant ${objective.grantRef} expired at ${objective.grantExpiresAt}` }
  }
  if (objective.commitAllowed === false || objective.pushAllowed === false) {
    return { valid: false, reason: "the parent objective does not authorize the commit-and-push delivery path" }
  }
  return { valid: true, reason: null }
}

function sourceBindings(finding) {
  return Object.fromEntries(SOURCE_BINDING_FIELDS.map((field) => [field, finding?.[field]]))
}

export function deriveRemediationWorkOrder({ objective, finding, now = () => new Date().toISOString() }) {
  const parent = parentAuthorityValid(objective)
  if (!parent.valid) {
    return { dispatch: null, gate: { gated: true, gate: "SCOPE", gates: ["SCOPE"], reason: parent.reason, unclassifiable: true } }
  }
  const paths = Array.isArray(finding?.paths) ? finding.paths.filter(Boolean) : []
  const escaping = paths.filter((candidate) => !withinReservation(candidate, objective.allowedPaths)
    || withinReservation(candidate, objective.forbiddenPaths))
  const declared = finding?.effects
  const effects = declared === null || declared === undefined || typeof declared !== "object" || Array.isArray(declared)
    ? declared
    : { ...declared, outsideObjectiveScope: Boolean(declared.outsideObjectiveScope) || escaping.length > 0 }
  const classification = classifyProposedAction({ summary: finding?.summary, effects })
  if (classification.gated) {
    return { dispatch: null, gate: { ...classification, ...(escaping.length > 0 ? { escapingPaths: escaping } : {}) } }
  }
  return {
    dispatch: {
      workOrderId: `${objective.workOrderId}-R${String(finding.sequence ?? 1).padStart(2, "0")}${
        Number.isSafeInteger(finding.sourceFindingEventId) ? `-F${finding.sourceFindingEventId}` : ""
      }`,
      derivedFrom: objective.workOrderId,
      grantRef: objective.grantRef,
      adapterId: objective.adapterId,
      authority: "APPROVED",
      riskClass: objective.riskClass ?? "R1",
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: objective.baseBranch ?? "main",
      mergeMode: objective.mergeMode ?? "AUTO_ELIGIBLE",
      allowedPaths: paths.length > 0 ? paths : objective.allowedPaths,
      requiredValidation: objective.requiredValidation ?? ["test", "build"],
      dependencies: [],
      task: finding.task ?? finding.summary,
      agent: objective.agent ?? "codex",
      findingId: finding.findingId,
      sourceUserId: finding.sourceUserId,
      sourceWorkOrderRowId: finding.sourceWorkOrderRowId,
      sourcePayloadDigest: finding.sourcePayloadDigest,
      sourceFindingEventId: finding.sourceFindingEventId,
      issueNumber: finding.issueNumber,
      ...sourceBindings(finding),
      derivedAt: now(),
    },
    gate: null,
  }
}

export function deriveRemediationPlan({ objective, findings, now = () => new Date().toISOString() }) {
  const dispatch = []
  const gated = []
  for (const finding of Array.isArray(findings) ? findings : []) {
    const result = deriveRemediationWorkOrder({ objective, finding, now })
    if (result.dispatch) dispatch.push(result.dispatch)
    else gated.push({
      finding: finding?.summary ?? "(unnamed finding)",
      findingId: finding?.findingId,
      sourceUserId: finding?.sourceUserId,
      sourceWorkOrderRowId: finding?.sourceWorkOrderRowId,
      sourcePayloadDigest: finding?.sourcePayloadDigest,
      sourceFindingEventId: finding?.sourceFindingEventId,
      issueNumber: finding?.issueNumber,
      objectiveWorkOrderId: finding?.objectiveWorkOrderId,
      grantRef: objective?.grantRef,
      ...sourceBindings(finding),
      ...result.gate,
    })
  }
  return { dispatch, gated }
}
