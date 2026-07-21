const ALLOWED_REPOSITORY = "bsvalues/terragroq"
const ALLOWED_ACTORS = new Set(["bsvalues"])
const ALLOWED_LANES = new Set(["docs", "ui", "read_model"])
const ALLOWED_RISKS = new Set(["low", "R0", "R1"])
const ALLOWED_AUTHORITIES = new Set(["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"])

const BLOCKED_SCOPE = Object.freeze([
  ["EXTERNAL_PRODUCT_SCOPE", /\b(?:terrafusion|terrapilot|property\s+workbench)\b/i],
  ["COUNTY_PROTECTED_SCOPE", /\b(?:county|pacs|parcel|taxpayer|protected\s+data)\b/i],
  ["PRODUCTION_SCOPE", /\b(?:(?:deploy|deployment|release|cutover|mutat(?:e|ion)|write|change)\w*\s+(?:to\s+)?production|production\s+(?:deploy|deployment|release|cutover|mutat(?:e|ion)|write|change)\w*)\b/i],
  ["SECRET_SCOPE", /\b(?:secret|password|credential|api[ -]?key|access[ -]?token|private[ -]?key)\b/i],
  ["PAID_SCOPE", /\b(?:paid\s+overage|increase\s+(?:the\s+)?spend|new\s+spending|purchase|billing\s+upgrade)\b/i],
  ["DESTRUCTIVE_SCOPE", /\b(?:destructive|delete|drop\s+(?:table|database)|truncate|force[ -]?push|reset\s+--hard|wipe|purge)\b/i],
  ["REJECTED_ISSUE_357", /(?:\bissue\s*)?#?357\b/i],
])

function deny(reasonCode, details = []) {
  return { allowed: false, eligible: false, reasonCode, details }
}

export function blockedOutcomeReasons(outcome) {
  const text = [outcome?.command, outcome?.title, outcome?.task, outcome?.description]
    .filter((value) => typeof value === "string")
    .join("\n")
  return BLOCKED_SCOPE.filter(([, pattern]) => pattern.test(text)).map(([code]) => code)
}

export function evaluateOutcomePolicy({
  outcome,
  actor,
  repository,
  enabled = true,
  killSwitch = false,
  standingAuthority = false,
} = {}) {
  if (!enabled || killSwitch) return deny("KILL_SWITCH_ACTIVE")
  if (repository !== ALLOWED_REPOSITORY) return deny("REPOSITORY_NOT_ALLOWED")
  if (!ALLOWED_ACTORS.has(actor)) return deny("ACTOR_NOT_ALLOWED")
  if (!outcome || typeof outcome !== "object") return deny("OUTCOME_INVALID")
  if (!ALLOWED_LANES.has(outcome.lane)) return deny("LANE_NOT_ALLOWED")
  if (!ALLOWED_RISKS.has(outcome.riskClass ?? outcome.risk)) return deny("RISK_NOT_ALLOWED")
  if (!ALLOWED_AUTHORITIES.has(outcome.authority)) return deny("AUTHORITY_NOT_ALLOWED")
  if (outcome.verdict !== undefined && outcome.verdict !== "allow"
    && !(standingAuthority && outcome.verdict === "requires_approval")) return deny("VERDICT_NOT_ALLOWED")
  if (outcome.requiresApproval === true && !standingAuthority) return deny("APPROVAL_REQUIRED")
  if (outcome.status !== undefined && outcome.status !== "classified") return deny("STATUS_NOT_ELIGIBLE")

  const details = blockedOutcomeReasons(outcome)
  if (details.length > 0) return deny("PROTECTED_SCOPE", details)
  return { allowed: true, eligible: true, reasonCode: "POLICY_ALLOWED", details: [] }
}

export const evaluateHermesPolicy = evaluateOutcomePolicy
export const isEligibleOutcome = (input) => evaluateOutcomePolicy(input).allowed

export const hermesPolicy = Object.freeze({
  repository: ALLOWED_REPOSITORY,
  actors: Object.freeze([...ALLOWED_ACTORS]),
  lanes: Object.freeze([...ALLOWED_LANES]),
  risks: Object.freeze([...ALLOWED_RISKS]),
  authorities: Object.freeze([...ALLOWED_AUTHORITIES]),
})
