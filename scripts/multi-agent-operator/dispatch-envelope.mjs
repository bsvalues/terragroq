import crypto from "node:crypto"

const RISK_CLASSES = new Set(["R0", "R1", "R2", "R3"])
const FAN_IN_GATES = new Set(["ALL", "ANY"])
const MERGE_MODES = new Set(["NO_MERGE", "DRAFT_PR_ONLY", "ASSURANCE_GATED"])
const REROUTE_POLICIES = new Set(["NONE", "COMPATIBLE_PROVIDER_ONLY"])
const ACTIONS = new Set([
  "READ_REPOSITORY",
  "WRITE_RESERVED_PATHS",
  "RUN_VALIDATION",
  "COMMIT_OWN_CHANGES",
  "PUSH_OWN_BRANCH",
  "OPEN_DRAFT_PR",
  "READ_CI_AND_REVIEW",
  "REMEDIATE_OWN_CHANGES",
  "MERGE_ELIGIBLE_PR",
  "VERIFY_POST_MERGE",
  "CREDENTIAL_ACCESS",
  "RUNTIME_ACTIVATION",
  "PRODUCTION_WRITE",
  "OWNER_CONTACT",
  "BRANCH_PROTECTION_BYPASS",
  "DESTRUCTIVE_GIT",
])

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "programId",
  "goalId",
  "loopId",
  "workOrderId",
  "objective",
  "riskClass",
  "repositories",
  "baseRefs",
  "dependencies",
  "fanInGate",
  "laneId",
  "teamRoles",
  "providerRequirements",
  "preferredProviders",
  "fallbackProviders",
  "reservations",
  "allowedActions",
  "forbiddenActions",
  "authorityGrantRefs",
  "programActivationGrantRef",
  "grantStatusEventRefs",
  "requiredOutputs",
  "requiredValidation",
  "reviewRequirements",
  "mergeMode",
  "retryBudget",
  "remediationBudget",
  "reroutePolicy",
  "stopConditions",
  "evidenceTargets",
  "ownerDecisionConditions",
  "ownerOperationsAllowed",
])

const IDENTIFIER = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/
const ACTION_IDENTIFIER = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const WORK_ORDER_IDENTIFIER = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const REPOSITORY_IDENTIFIER = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
const PROVIDER_IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/
const WILDCARD = /[*?\[\]{}!]/

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export class DispatchEnvelopeError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "DispatchEnvelopeError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new DispatchEnvelopeError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertExactFields(value, fields, field) {
  if (!plainObject(value)) wall("DISPATCH_ENVELOPE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()
  if (unknown.length > 0) wall("DISPATCH_ENVELOPE_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()
  if (missing.length > 0) wall("DISPATCH_ENVELOPE_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function stringValue(value, field, pattern = undefined) {
  if (typeof value !== "string" || value.trim() === "") {
    wall("DISPATCH_ENVELOPE_TYPE_WALL", field, "NON_EMPTY_STRING_REQUIRED")
  }
  const normalized = value.trim()
  if (normalized !== value) wall("DISPATCH_ENVELOPE_NORMALIZATION_WALL", field, "SURROUNDING_WHITESPACE")
  if (pattern && !pattern.test(normalized)) wall("DISPATCH_ENVELOPE_FORMAT_WALL", field)
  return normalized
}

function sortedUniqueStrings(value, field, { nonEmpty = false, pattern = undefined } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    wall("DISPATCH_ENVELOPE_TYPE_WALL", field, nonEmpty ? "NON_EMPTY_ARRAY_REQUIRED" : "ARRAY_REQUIRED")
  }
  const normalized = value.map((entry, index) => stringValue(entry, `${field}[${index}]`, pattern))
  const seen = new Set()
  for (const entry of normalized) {
    if (seen.has(entry)) wall("DISPATCH_ENVELOPE_DUPLICATE_WALL", field, entry)
    seen.add(entry)
  }
  return normalized.sort(lexicalCompare)
}

function boundedInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    wall("DISPATCH_ENVELOPE_RETRY_BUDGET_WALL", field, `${minimum}..${maximum}`)
  }
  return value
}

function normalizeBaseRefs(value, repositories) {
  if (!Array.isArray(value) || value.length !== repositories.length) {
    wall("DISPATCH_ENVELOPE_BASE_REF_WALL", "baseRefs", "ONE_PER_REPOSITORY_REQUIRED")
  }
  const normalized = value.map((entry, index) => {
    assertExactFields(entry, new Set(["repository", "ref", "commitSha"]), `baseRefs[${index}]`)
    const repository = stringValue(entry.repository, `baseRefs[${index}].repository`, REPOSITORY_IDENTIFIER)
    const ref = stringValue(entry.ref, `baseRefs[${index}].ref`)
    if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
      wall("DISPATCH_ENVELOPE_BASE_REF_WALL", `baseRefs[${index}].ref`, "FULL_REF_REQUIRED")
    }
    const commitSha = stringValue(entry.commitSha, `baseRefs[${index}].commitSha`, COMMIT_SHA)
    return { repository, ref, commitSha }
  }).sort((left, right) => lexicalCompare(left.repository, right.repository))

  const expected = [...repositories].sort()
  const actual = normalized.map(({ repository }) => repository)
  if (new Set(actual).size !== actual.length || actual.some((repository, index) => repository !== expected[index])) {
    wall("DISPATCH_ENVELOPE_BASE_REF_WALL", "baseRefs", "REPOSITORY_SET_MISMATCH")
  }
  return normalized
}

function normalizeReservationPath(entry, index, repositories) {
  assertExactFields(entry, new Set(["repository", "path"]), `reservations.paths[${index}]`)
  const repository = stringValue(entry.repository, `reservations.paths[${index}].repository`, REPOSITORY_IDENTIFIER)
  if (!repositories.includes(repository)) {
    wall("DISPATCH_ENVELOPE_RESERVATION_WALL", `reservations.paths[${index}].repository`, "UNKNOWN_REPOSITORY")
  }
  const reservationPath = stringValue(entry.path, `reservations.paths[${index}].path`)
  const segments = reservationPath.split(/[\\/]/)
  if (reservationPath.startsWith("/")
    || reservationPath.startsWith("\\")
    || WINDOWS_ABSOLUTE_PATH.test(reservationPath)
    || reservationPath.includes("\\")
    || segments.includes("..")
    || segments.includes(".")
    || segments.some((segment) => segment === "")
    || WILDCARD.test(reservationPath)) {
    wall("DISPATCH_ENVELOPE_PATH_WALL", `reservations.paths[${index}].path`, "SAFE_RELATIVE_POSIX_PATH_REQUIRED")
  }
  return { repository, path: reservationPath }
}

function normalizeReservations(value, repositories) {
  assertExactFields(value, new Set(["paths", "contracts", "environments"]), "reservations")
  if (!Array.isArray(value.paths) || value.paths.length === 0) {
    wall("DISPATCH_ENVELOPE_TYPE_WALL", "reservations.paths", "NON_EMPTY_ARRAY_REQUIRED")
  }
  const paths = value.paths
    .map((entry, index) => normalizeReservationPath(entry, index, repositories))
    .sort((left, right) => lexicalCompare(`${left.repository}:${left.path}`, `${right.repository}:${right.path}`))
  const keys = paths.map(({ repository, path }) => `${repository}:${path}`)
  if (new Set(keys).size !== keys.length) wall("DISPATCH_ENVELOPE_DUPLICATE_WALL", "reservations.paths")
  return {
    paths,
    contracts: sortedUniqueStrings(value.contracts, "reservations.contracts"),
    environments: sortedUniqueStrings(value.environments, "reservations.environments"),
  }
}

function normalizeTeamRoles(value) {
  const roleFields = new Set(["coordinator", "builder", "reviewer"])
  assertExactFields(value, roleFields, "teamRoles")
  const roles = Object.fromEntries(
    [...roleFields].map((role) => [role, stringValue(value[role], `teamRoles.${role}`, PROVIDER_IDENTIFIER)]),
  )
  if (new Set(Object.values(roles)).size !== Object.values(roles).length) {
    wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "teamRoles", "ROLES_MUST_BE_DISTINCT")
  }
  return roles
}

function normalizeActions(value, field) {
  const actions = sortedUniqueStrings(value, field, { nonEmpty: true, pattern: ACTION_IDENTIFIER })
  const unsupported = actions.find((action) => !ACTIONS.has(action))
  if (unsupported) wall("DISPATCH_ENVELOPE_ACTION_WALL", field, unsupported)
  return actions
}

function normalizeRetryBudget(value) {
  assertExactFields(value, new Set(["maxAttempts", "backoffSeconds"]), "retryBudget")
  return {
    maxAttempts: boundedInteger(value.maxAttempts, "retryBudget.maxAttempts", 1, 5),
    backoffSeconds: boundedInteger(value.backoffSeconds, "retryBudget.backoffSeconds", 0, 300),
  }
}

function normalizeRemediationBudget(value) {
  assertExactFields(value, new Set(["maxCycles"]), "remediationBudget")
  return { maxCycles: boundedInteger(value.maxCycles, "remediationBudget.maxCycles", 0, 3) }
}

function normalizeReviewRequirements(value) {
  assertExactFields(value, new Set(["independentReviewer", "minimumApprovals", "maximumUnresolvedThreads"]), "reviewRequirements")
  if (value.independentReviewer !== true) {
    wall("DISPATCH_ENVELOPE_REVIEW_WALL", "reviewRequirements.independentReviewer", "TRUE_REQUIRED")
  }
  if (!Number.isSafeInteger(value.minimumApprovals) || value.minimumApprovals < 1 || value.minimumApprovals > 3) {
    wall("DISPATCH_ENVELOPE_REVIEW_WALL", "reviewRequirements.minimumApprovals", "1..3")
  }
  if (value.maximumUnresolvedThreads !== 0) {
    wall("DISPATCH_ENVELOPE_REVIEW_WALL", "reviewRequirements.maximumUnresolvedThreads", "ZERO_REQUIRED")
  }
  return {
    independentReviewer: true,
    minimumApprovals: value.minimumApprovals,
    maximumUnresolvedThreads: 0,
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function canonicalDispatchEnvelopeJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function normalizeDispatchEnvelope(input) {
  assertExactFields(input, TOP_LEVEL_FIELDS, "envelope")
  if (input.schemaVersion !== 2) wall("DISPATCH_ENVELOPE_VERSION_WALL", "schemaVersion", "2_REQUIRED")
  if (input.ownerOperationsAllowed !== false) {
    wall("DISPATCH_ENVELOPE_OWNER_OPERATION_WALL", "ownerOperationsAllowed", "FALSE_REQUIRED")
  }

  const repositories = sortedUniqueStrings(input.repositories, "repositories", {
    nonEmpty: true,
    pattern: REPOSITORY_IDENTIFIER,
  })
  const dependencies = sortedUniqueStrings(input.dependencies, "dependencies", { pattern: WORK_ORDER_IDENTIFIER })
  const workOrderId = stringValue(input.workOrderId, "workOrderId", WORK_ORDER_IDENTIFIER)
  if (dependencies.includes(workOrderId)) {
    wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "dependencies", "SELF_DEPENDENCY")
  }
  const riskClass = stringValue(input.riskClass, "riskClass")
  if (!RISK_CLASSES.has(riskClass)) wall("DISPATCH_ENVELOPE_RISK_WALL", "riskClass", riskClass)
  const fanInGate = stringValue(input.fanInGate, "fanInGate")
  if (!FAN_IN_GATES.has(fanInGate)) wall("DISPATCH_ENVELOPE_FORMAT_WALL", "fanInGate")
  const preferredProviders = sortedUniqueStrings(input.preferredProviders, "preferredProviders", {
    nonEmpty: true,
    pattern: PROVIDER_IDENTIFIER,
  })
  const fallbackProviders = sortedUniqueStrings(input.fallbackProviders, "fallbackProviders", {
    pattern: PROVIDER_IDENTIFIER,
  })
  const providerOverlap = preferredProviders.find((provider) => fallbackProviders.includes(provider))
  if (providerOverlap) {
    wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "preferredProviders", `ALSO_FALLBACK:${providerOverlap}`)
  }
  const allowedActions = normalizeActions(input.allowedActions, "allowedActions")
  const forbiddenActions = normalizeActions(input.forbiddenActions, "forbiddenActions")
  const actionOverlap = allowedActions.find((action) => forbiddenActions.includes(action))
  if (actionOverlap) wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "allowedActions", `FORBIDDEN:${actionOverlap}`)
  const mergeMode = stringValue(input.mergeMode, "mergeMode")
  if (!MERGE_MODES.has(mergeMode)) wall("DISPATCH_ENVELOPE_FORMAT_WALL", "mergeMode")
  if (mergeMode === "NO_MERGE" && allowedActions.includes("MERGE_ELIGIBLE_PR")) {
    wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "mergeMode", "MERGE_ACTION_ALLOWED")
  }
  const reroutePolicy = stringValue(input.reroutePolicy, "reroutePolicy")
  if (!REROUTE_POLICIES.has(reroutePolicy)) wall("DISPATCH_ENVELOPE_FORMAT_WALL", "reroutePolicy")
  if (reroutePolicy === "NONE" && fallbackProviders.length > 0) {
    wall("DISPATCH_ENVELOPE_CONTRADICTION_WALL", "fallbackProviders", "REROUTE_DISABLED")
  }

  const normalized = {
    schemaVersion: 2,
    programId: stringValue(input.programId, "programId", IDENTIFIER),
    goalId: stringValue(input.goalId, "goalId", IDENTIFIER),
    loopId: stringValue(input.loopId, "loopId", IDENTIFIER),
    workOrderId,
    objective: stringValue(input.objective, "objective"),
    riskClass,
    repositories,
    baseRefs: normalizeBaseRefs(input.baseRefs, repositories),
    dependencies,
    fanInGate,
    laneId: stringValue(input.laneId, "laneId", IDENTIFIER),
    teamRoles: normalizeTeamRoles(input.teamRoles),
    providerRequirements: sortedUniqueStrings(input.providerRequirements, "providerRequirements", {
      nonEmpty: true,
      pattern: PROVIDER_IDENTIFIER,
    }),
    preferredProviders,
    fallbackProviders,
    reservations: normalizeReservations(input.reservations, repositories),
    allowedActions,
    forbiddenActions,
    authorityGrantRefs: sortedUniqueStrings(input.authorityGrantRefs, "authorityGrantRefs"),
    programActivationGrantRef: input.programActivationGrantRef === null
      ? null
      : stringValue(input.programActivationGrantRef, "programActivationGrantRef"),
    grantStatusEventRefs: sortedUniqueStrings(input.grantStatusEventRefs, "grantStatusEventRefs"),
    requiredOutputs: sortedUniqueStrings(input.requiredOutputs, "requiredOutputs", { nonEmpty: true }),
    requiredValidation: sortedUniqueStrings(input.requiredValidation, "requiredValidation", { nonEmpty: true }),
    reviewRequirements: normalizeReviewRequirements(input.reviewRequirements),
    mergeMode,
    retryBudget: normalizeRetryBudget(input.retryBudget),
    remediationBudget: normalizeRemediationBudget(input.remediationBudget),
    reroutePolicy,
    stopConditions: sortedUniqueStrings(input.stopConditions, "stopConditions", { nonEmpty: true }),
    evidenceTargets: sortedUniqueStrings(input.evidenceTargets, "evidenceTargets", { nonEmpty: true }),
    ownerDecisionConditions: sortedUniqueStrings(input.ownerDecisionConditions, "ownerDecisionConditions"),
    ownerOperationsAllowed: false,
  }
  return Object.freeze(normalized)
}

export function validateDispatchEnvelope(input) {
  const envelope = normalizeDispatchEnvelope(input)
  const canonicalJson = canonicalDispatchEnvelopeJson(envelope)
  return Object.freeze({
    ok: true,
    code: "DISPATCH_ENVELOPE_VALID",
    contentHash: crypto.createHash("sha256").update(canonicalJson).digest("hex"),
    envelope,
  })
}
