import { resolveHermesWorkContract } from "./work-contract.mjs"

const ALLOWED_REPOSITORY = "bsvalues/terragroq"
const ALLOWED_ACTORS = new Set(["bsvalues"])
const ALLOWED_LANES = new Set(["docs", "ui", "read_model"])
const ALLOWED_RISKS = new Set(["low", "R0", "R1"])
const ALLOWED_AUTHORITIES = new Set(["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"])

// D1: capability classes a dependency projection may NEVER execute autonomously, regardless of any
// grant. Structured (class:capability), NOT lexical. runtime_control:control is deliberately absent —
// it is exactly what the bounded actuator exists to perform under a concrete scoped grant. This is
// defence-in-depth; the acquire SQL enforces the same set.
const DEPENDENCY_HARD_DENY = new Set([
  "data:destructive", "delivery:release", "secrets:read", "secrets:write", "external:act",
])

export const PROTECTED_SCOPE_LEXEMES = Object.freeze({
  terrafusion: "terrafusion", terrapilot: "terrapilot", propertyworkbench: "property workbench",
  county: "county", pacs: "pacs", parcel: "parcel", taxpayer: "taxpayer",
  protecteddata: "protected data", production: "production", deploy: "deploy",
  deployment: "deployment", release: "release", cutover: "cutover", mutate: "mutate",
  mutation: "mutation", write: "write", change: "change", secret: "secret", password: "password",
  credential: "credential", apikey: "api key", accesstoken: "access token", privatekey: "private key",
  token: "token", cookie: "cookie", session: "session", paidoverage: "paid overage",
  increase: "increase", spend: "spend", newspending: "new spending", purchase: "purchase",
  billingupgrade: "billing upgrade", destructive: "destructive", delete: "delete", drop: "drop",
  table: "table", database: "database", truncate: "truncate", forcepush: "force push",
  resethard: "reset hard", wipe: "wipe", purge: "purge", create: "create", publish: "publish",
  cut: "cut", push: "push", githubrelease: "github release", git: "git", tag: "tag",
  issue357: "issue 357",
})

const BLOCKED_SCOPE = Object.freeze([
  ["EXTERNAL_PRODUCT_SCOPE", /\b(?:terrafusion|terrapilot|property\s+workbench)\b/i],
  ["COUNTY_PROTECTED_SCOPE", /\b(?:county|pacs|parcel|taxpayer|protected\s+data)\b/i],
  ["PRODUCTION_SCOPE", /\b(?:(?:deploy|deployment|release|cutover|mutat(?:e|ion)|write|change)\w*\s+(?:to\s+)?production|production\s+(?:deploy|deployment|release|cutover|mutat(?:e|ion)|write|change)\w*)\b/i],
  ["SECRET_SCOPE", /\b(?:secret|password|credential|api[ -]?key|access[ -]?token|private[ -]?key|token|cookie|session)\b/i],
  ["PAID_SCOPE", /\b(?:paid\s+overage|increase\s+(?:the\s+)?spend|new\s+spending|purchase|billing\s+upgrade)\b/i],
  ["DESTRUCTIVE_SCOPE", /\b(?:destructive|delete|drop\s+(?:table|database)|truncate|force[ -]?push|reset\s+--hard|wipe|purge)\b/i],
  ["RELEASE_TAG_SCOPE", /\b(?:(?:create|publish|cut|push)\s+(?:a\s+)?(?:github\s+)?release|(?:create|publish|push)\s+(?:a\s+)?(?:git\s+)?tag|tag\s+v?\d)\b/i],
  ["REJECTED_ISSUE_357", /(?:\bissue\s*)?#?357\b/i],
])

function deny(reasonCode, details = []) {
  return { allowed: false, eligible: false, reasonCode, details }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function exactVerifiedOperatorObjective(outcome) {
  if (outcome?.lane !== "operator-objective") return false
  const verified = outcome.verifiedQueueWorkContract
  const registered = resolveHermesWorkContract(outcome)
  const provenance = verified?.provenance
  return registered != null
    && verified?.contract != null
    && canonicalJson(verified.contract) === canonicalJson(registered)
    && provenance != null
    && Object.keys(provenance).sort().join(",") === "operation,outcomeKey,workOrderRef"
    && provenance.operation === "workbench_execution.authorize"
    && provenance.outcomeKey === outcome.outcomeKey
    && provenance.outcomeKey === outcome.queueBinding?.outcomeKey
    && provenance.workOrderRef === `WO-HERMES-OUTCOME-${Number(outcome.id)}`
}

export function blockedOutcomeReasons(outcome) {
  const text = [outcome?.command, outcome?.title, outcome?.task, outcome?.description]
    .filter((value) => typeof value === "string")
    .join("\n")
  return BLOCKED_SCOPE.filter(([, pattern]) => pattern.test(text)).map(([code]) => code)
}

/**
 * D1 — structured policy for a routed-dependency projection. A dependency is NOT a goal: it has no
 * `lane`, and evaluating it through ALLOWED_LANES / the protected-content regex is a category error
 * (it produced LANE_NOT_ALLOWED and a 50-minute leaked lease). Its authority is the concrete grant,
 * verified at acquisition and re-verified by the actuator; policy here only confirms the structured
 * shape is a well-formed dependency execution whose capability is not hard-denied. It NEVER scans
 * prose and NEVER emits LANE_NOT_ALLOWED.
 */
export function evaluateDependencyPolicy(outcome) {
  const subject = outcome?.executionSubject
  if (!subject || subject.kind !== "dependency") return deny("DEPENDENCY_SUBJECT_INVALID")
  if (subject.ok !== true) return deny("DEPENDENCY_SUBJECT_NOT_OK")
  const action = outcome.authorityAction
  if (typeof action !== "string" || !/^[a-z_]+:[a-z_]+$/.test(action)) return deny("DEPENDENCY_CAPABILITY_INVALID")
  if (DEPENDENCY_HARD_DENY.has(action)) return deny("DEPENDENCY_CAPABILITY_FORBIDDEN", [action])
  const [cls, cap] = action.split(":")
  const envelope = subject.envelope ?? {}
  if (envelope.surfaceClass !== cls || envelope.capability !== cap) return deny("DEPENDENCY_ENVELOPE_MISMATCH")
  if (!ALLOWED_RISKS.has(outcome.riskClass ?? outcome.risk)) return deny("RISK_NOT_ALLOWED")
  // Governed dependency execution is allowed. Capability-aware dispatch (D4) then routes it to the
  // bounded runtime actuator for runtime_control:control, or to the source lanes for source work.
  return { allowed: true, eligible: true, reasonCode: "DEPENDENCY_POLICY_ALLOWED", details: [], dependency: true }
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
  // D1: a dependency projection takes the structured dependency policy, never the goal lane gate.
  // Goal outcomes have no dependency executionSubject and fall through to the legacy path unchanged.
  if (outcome.executionSubject?.kind === "dependency") {
    return evaluateDependencyPolicy(outcome)
  }
  if (!ALLOWED_LANES.has(outcome.lane) && !exactVerifiedOperatorObjective(outcome)) {
    return deny("LANE_NOT_ALLOWED")
  }
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
