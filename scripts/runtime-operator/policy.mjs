const ENVELOPE_START = "<!-- WILLIAMOS_RUNTIME_WO"
const ENVELOPE_END = "WILLIAMOS_RUNTIME_WO -->"

const ALLOWED_REPOSITORY = "bsvalues/terragroq"
const ALLOWED_ACTORS = new Set(["bsvalues"])
const ALLOWED_RISKS = new Set(["R0", "R1"])
const ALLOWED_VALIDATION = new Set(["diff-check", "lint", "test", "build"])

const FORBIDDEN_CAPABILITY = /(?:deploy|production write|release|tag|rollback execution|PACS|county (?:data|system)|credential|secret|password|token|database|schema|migration|environment change|package change|dependency change|Vercel setting|Hermes|MCP|background worker|scheduler|command runner|destructive|force push|reset --hard)/i
const FORBIDDEN_PATH = /^(?:\.github\/workflows\/runtime-operator|app\/api\/auth\/|app\/api\/setup\/|lib\/auth|db\/|drizzle\/|migrations\/|package\.json$|pnpm-lock\.yaml$|package-lock\.json$|vercel\.json$|\.env|WilliamOS\/.*PACS|.*TerraFusion.*production)/i

function assertString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`)
}

export function parseWorkOrderEnvelope(body) {
  const start = body.indexOf(ENVELOPE_START)
  const end = body.indexOf(ENVELOPE_END, start + ENVELOPE_START.length)
  if (start < 0 || end < 0 || end <= start) throw new Error("Work Order envelope marker is missing")
  const json = body.slice(start + ENVELOPE_START.length, end).trim()
  const envelope = JSON.parse(json)
  if (envelope.schemaVersion !== 1) throw new Error("Unsupported Work Order schema version")
  for (const field of ["programId", "goalId", "loopId", "workOrderId", "title", "task", "riskClass", "baseBranch", "mergeMode"]) {
    assertString(envelope[field], field)
  }
  for (const field of ["programId", "goalId", "loopId", "workOrderId"]) {
    if (!/^[A-Z0-9][A-Z0-9-]{2,100}$/.test(envelope[field])) throw new Error(`${field} has an invalid identifier format`)
  }
  if (envelope.task.length > 10_000) throw new Error("task exceeds the 10000 character limit")
  if (!Array.isArray(envelope.allowedPaths) || envelope.allowedPaths.length === 0) throw new Error("allowedPaths must be non-empty")
  if (envelope.allowedPaths.some((path) => typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || (/[*?[]/.test(path) && !path.endsWith("/**")))) {
    throw new Error("allowedPaths contains an unsafe or unsupported path")
  }
  if (!Array.isArray(envelope.requiredValidation)) throw new Error("requiredValidation must be an array")
  return envelope
}

function pathMatches(pattern, path) {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3))
  return path === pattern
}

export function validateChangedPaths(envelope, changedPaths) {
  const violations = changedPaths.filter(
    (path) => FORBIDDEN_PATH.test(path) || !envelope.allowedPaths.some((pattern) => pathMatches(pattern, path)),
  )
  return { allowed: violations.length === 0, violations }
}

export function evaluateWorkOrderPolicy({ envelope, actor, repository, enabled }) {
  if (!enabled) return { allowed: false, reasonCode: "KILL_SWITCH_ACTIVE" }
  if (repository !== ALLOWED_REPOSITORY) return { allowed: false, reasonCode: "REPOSITORY_NOT_ALLOWED" }
  if (!ALLOWED_ACTORS.has(actor)) return { allowed: false, reasonCode: "ACTOR_NOT_ALLOWED" }
  if (!ALLOWED_RISKS.has(envelope.riskClass)) return { allowed: false, reasonCode: "RISK_NOT_ALLOWED" }
  const approvedRemediationBranch = Number.isInteger(envelope.remediationOf) && /^runtime\/[a-z0-9._/-]+$/.test(envelope.baseBranch)
  if (envelope.baseBranch !== "main" && !approvedRemediationBranch) return { allowed: false, reasonCode: "BASE_BRANCH_NOT_ALLOWED" }
  if (envelope.mergeMode !== "AUTO_ELIGIBLE") return { allowed: false, reasonCode: "MERGE_MODE_NOT_ALLOWED" }
  if (FORBIDDEN_CAPABILITY.test(`${envelope.title}\n${envelope.task}`)) return { allowed: false, reasonCode: "CAPABILITY_NOT_ALLOWED" }
  if (envelope.allowedPaths.some((path) => FORBIDDEN_PATH.test(path))) return { allowed: false, reasonCode: "PATH_NOT_ALLOWED" }
  if (envelope.requiredValidation.some((gate) => !ALLOWED_VALIDATION.has(gate))) return { allowed: false, reasonCode: "VALIDATION_NOT_ALLOWED" }
  return { allowed: true, reasonCode: "POLICY_ALLOWED" }
}

export const runtimePolicy = Object.freeze({
  repository: ALLOWED_REPOSITORY,
  actors: [...ALLOWED_ACTORS],
  risks: [...ALLOWED_RISKS],
  validation: [...ALLOWED_VALIDATION],
})
