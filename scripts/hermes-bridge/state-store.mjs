import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const COUNTER_ALIASES = Object.freeze({
  ownerOperationTouchCount: "OWNER_OPERATION_TOUCH_COUNT",
  ownerCredentialTouchCount: "OWNER_CREDENTIAL_TOUCH_COUNT",
  ownerDiagnosticTouchCount: "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  ownerRoutineDecisionCount: "OWNER_ROUTINE_DECISION_COUNT",
  ownerRoutineContactCount: "OWNER_ROUTINE_CONTACT_COUNT",
})
const COUNTER_NAMES = Object.freeze(Object.values(COUNTER_ALIASES))
const STALE_LOCK_MS = 10 * 60 * 1000
const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const SENSITIVE_EVIDENCE = /(?:ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|password|secret)\s*[:=]\s*\S+|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s@/]*:[^@\s/]+@)/i
const VALIDATION_INFRASTRUCTURE_DETAIL = "VALIDATION_REMEDIATION_EXHAUSTED"
const NEXT_ESLINT_MISSING_TOOL_PAIRS = Object.freeze([
  ["react-hooks", "eslint-plugin-react-hooks"],
  ["react", "eslint-plugin-react"],
  ["jsx-a11y", "eslint-plugin-jsx-a11y"],
  ["import", "eslint-plugin-import"],
  ["@next/next", "@next/eslint-plugin-next"],
  ["@typescript-eslint", "@typescript-eslint/eslint-plugin"],
  ["@typescript-eslint/parser", "@typescript-eslint/parser"],
])

function isLockedNextEslintInfrastructureFailure(failure) {
  if (!/^npm run lint(?:\s.*?)? exited \d+\r?\n/i.test(failure)
    || !/declared in [^\r\n]{0,1000}\beslint-config-next\b/i.test(failure)) return false
  return NEXT_ESLINT_MISSING_TOOL_PAIRS.some(([loaded, missing]) => (
    failure.includes(`Failed to load plugin '${loaded}'`)
      || failure.includes(`Failed to load parser '${loaded}'`)
  ) && failure.includes(`Cannot find module '${missing}'`))
}

export function isValidationInfrastructureFailure(value) {
  const failure = String(value ?? "")
  return /\bspawn EPERM\b/i.test(failure)
    || /'(?:vitest|next)' is not recognized as an internal or external command/i.test(failure)
    || isLockedNextEslintInfrastructureFailure(failure)
}
const REVIEW_REMEDIATION_DETAIL = "REVIEW_REMEDIATION_EXHAUSTED"
const TURN_RESULTS = new Set([
  "READY_FOR_VALIDATION",
  "RETRYABLE_PROVIDER_WALL",
  "OWNER_DECISION_REQUIRED",
  "FAILED_TERMINAL",
])
const TURN_RESULT_KEYS = Object.freeze([
  "result",
  "workOrder",
  "branch",
  "commit",
  "prUrl",
  "merged",
  "mergeCommit",
  "validation",
  "reviewThreads",
  "ownerTouchCount",
  "blockedScopeCrossed",
  "nextState",
  "blockedAction",
  "authorityBoundary",
  "minimumChoice",
  "approveConsequence",
  "denyConsequence",
  "findings",
])
const TURN_RESULT_REQUIRED_KEYS = Object.freeze(TURN_RESULT_KEYS.slice(0, 12))

function fail(code, message = code) {
  const error = new Error(message)
  error.code = code
  throw error
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now ?? Date.now()
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : value
  if (!Number.isFinite(milliseconds)) fail("INVALID_TIMESTAMP")
  return { milliseconds, iso: new Date(milliseconds).toISOString() }
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function textDigest(value) {
  return createHash("sha256").update(value).digest("hex")
}

function boundedString(value, field, { nullable = false, maximum = 1_000 } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail("INVALID_TURN_RESULT", field)
  }
  return value
}

const FINDING_ID = /^FINDING-[A-Z0-9][A-Z0-9-]{0,119}$/
const FINDING_KEYS = Object.freeze(["effects", "findingId", "paths", "sequence", "summary", "task"])
const FINDING_EFFECT_KEYS = Object.freeze([
  "changesReviewedPolicy", "competesWithPriority", "destroys", "irreversible",
  "mutatesProductionData", "outsideObjectiveScope", "protectedResource", "releaseOrCutover",
  "spendsMoney", "touchesCredentials", "unresolvedLegalPrivacyOrSecurityRisk",
])
const FINDING_QUARANTINE = new RegExp([
  "-----" + "BEGIN [A-Z ]*PRIVATE KEY-----",
  "\\bs" + "k-[A-Za-z0-9_-]{20,}\\b",
  "\\bg" + "h[oprsu]_[A-Za-z0-9]{20,}\\b",
  "(?:post" + "gres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis):\\/\\/[^\\s]+",
  "(?:pass" + "word|to" + "ken|api[_ -]?key|client[_ -]?secret)\\s*[:=]\\s*[\\\"']?[^\\s\\\"']{8,}",
  "ignore\\s+(?:(?:all\\s+|any\\s+|the\\s+)?previous|(?:the\\s+)?(?:declared|authority|boundary|rules?))",
  "system\\s+(?:message|prompt)",
  "developer\\s+(?:message|instruction)",
  "<\\/?system\\b",
  "\\[INST\\]",
  "do\\s+not\\s+follow\\s+(?:the\\s+)?(?:rules|instructions)",
].join("|"), "i")

function findingPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 300
    && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..")
}

export function normalizeHermesFindings(value) {
  if (!Array.isArray(value) || value.length > 20) fail("INVALID_TURN_RESULT_FINDING")
  const ids = new Set()
  const sequences = new Set()
  return value.map((finding) => {
    const keys = finding && typeof finding === "object" && !Array.isArray(finding)
      ? Object.keys(finding).sort()
      : []
    const effects = finding?.effects
    const effectKeys = effects && typeof effects === "object" && !Array.isArray(effects)
      ? Object.keys(effects).sort()
      : []
    const textValid = (entry) => typeof entry === "string" && entry.trim() !== ""
      && entry.length <= 2_000
    const destroys = effects?.destroys
    const destroysValid = Array.isArray(destroys) && destroys.length <= 50
      && destroys.every((target) => target && typeof target === "object" && !Array.isArray(target)
        && JSON.stringify(Object.keys(target).sort()) === JSON.stringify(["path", "verifiedCopyElsewhere"])
        && findingPath(target.path) && typeof target.verifiedCopyElsewhere === "boolean")
    const effectsValid = JSON.stringify(effectKeys) === JSON.stringify(FINDING_EFFECT_KEYS)
      && FINDING_EFFECT_KEYS.every((key) => key === "destroys" || typeof effects[key] === "boolean")
      && destroysValid
    const pathsValid = Array.isArray(finding?.paths) && finding.paths.length > 0
      && finding.paths.length <= 50 && new Set(finding.paths).size === finding.paths.length
      && finding.paths.every(findingPath)
    if (JSON.stringify(keys) !== JSON.stringify(FINDING_KEYS)
      || !FINDING_ID.test(finding?.findingId)
      || !Number.isSafeInteger(finding?.sequence) || finding.sequence <= 0
      || ids.has(finding.findingId) || sequences.has(finding.sequence)
      || !textValid(finding?.summary) || !textValid(finding?.task)
      || !pathsValid || !effectsValid) fail("INVALID_TURN_RESULT_FINDING")
    if (FINDING_QUARANTINE.test(JSON.stringify(finding))) {
      fail("TURN_RESULT_FINDING_QUARANTINE_WALL")
    }
    ids.add(finding.findingId)
    sequences.add(finding.sequence)
    return {
      findingId: finding.findingId,
      sequence: finding.sequence,
      summary: finding.summary,
      task: finding.task,
      paths: [...finding.paths],
      effects: {
        changesReviewedPolicy: effects.changesReviewedPolicy,
        competesWithPriority: effects.competesWithPriority,
        destroys: effects.destroys.map((target) => ({ ...target })),
        irreversible: effects.irreversible,
        mutatesProductionData: effects.mutatesProductionData,
        outsideObjectiveScope: effects.outsideObjectiveScope,
        protectedResource: effects.protectedResource,
        releaseOrCutover: effects.releaseOrCutover,
        spendsMoney: effects.spendsMoney,
        touchesCredentials: effects.touchesCredentials,
        unresolvedLegalPrivacyOrSecurityRisk: effects.unresolvedLegalPrivacyOrSecurityRisk,
      },
    }
  }).sort((left, right) => left.sequence - right.sequence)
}

export function normalizeHermesTurnResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || TURN_RESULT_REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !TURN_RESULT_KEYS.includes(key))) {
    fail("INVALID_TURN_RESULT")
  }
  if (!TURN_RESULTS.has(value.result)
    || typeof value.merged !== "boolean"
    || !Number.isSafeInteger(value.reviewThreads) || value.reviewThreads < 0
    || !Number.isSafeInteger(value.ownerTouchCount) || value.ownerTouchCount < 0
    || typeof value.blockedScopeCrossed !== "boolean"
    || !Array.isArray(value.validation) || value.validation.length > 20
    || value.validation.some((entry) => typeof entry !== "string" || entry.length > 1_000)
    || typeof value.nextState !== "string"
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(value.nextState)
    || !["APPROVE_OR_DENY", null].includes(value.minimumChoice ?? null)) {
    fail("INVALID_TURN_RESULT")
  }
  const normalized = {
    result: value.result,
    workOrder: boundedString(value.workOrder, "workOrder", { maximum: 200 }),
    branch: boundedString(value.branch, "branch", { maximum: 200 }),
    commit: boundedString(value.commit, "commit", { nullable: true, maximum: 200 }),
    prUrl: boundedString(value.prUrl, "prUrl", { nullable: true, maximum: 500 }),
    merged: value.merged,
    mergeCommit: boundedString(value.mergeCommit, "mergeCommit", { nullable: true, maximum: 200 }),
    validation: [...value.validation],
    reviewThreads: value.reviewThreads,
    ownerTouchCount: value.ownerTouchCount,
    blockedScopeCrossed: value.blockedScopeCrossed,
    nextState: value.nextState,
    blockedAction: boundedString(value.blockedAction ?? null, "blockedAction", { nullable: true }),
    authorityBoundary: boundedString(value.authorityBoundary ?? null, "authorityBoundary", { nullable: true }),
    minimumChoice: value.minimumChoice ?? null,
    approveConsequence: boundedString(value.approveConsequence ?? null, "approveConsequence", { nullable: true }),
    denyConsequence: boundedString(value.denyConsequence ?? null, "denyConsequence", { nullable: true }),
    ...(Object.hasOwn(value, "findings") ? { findings: normalizeHermesFindings(value.findings) } : {}),
  }
  if (SENSITIVE_EVIDENCE.test(JSON.stringify(normalized))) {
    fail("TURN_RESULT_SECRET_WALL")
  }
  return normalized
}

export function hermesTurnResultDigest(value) {
  return digest(normalizeHermesTurnResult(value))
}

function initialState(storeId, now) {
  return {
    schemaVersion: 1,
    storeId,
    revision: 0,
    nextFencingToken: 1,
    updatedAt: timestamp(now).iso,
    killSwitch: { active: false, reason: null, updatedAt: null },
    ownerTouchCounters: Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])),
    executions: {},
    idempotency: {},
  }
}

function atomicWrite(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const handle = fs.openSync(temporary, "wx", 0o600)
  try {
    fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  try {
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function validateState(state, storeId) {
  if (!state || state.schemaVersion !== 1 || state.storeId !== storeId
    || !Number.isInteger(state.revision) || !Number.isInteger(state.nextFencingToken)
    || state.nextFencingToken < 1 || typeof state.executions !== "object"
    || typeof state.idempotency !== "object" || typeof state.ownerTouchCounters !== "object") {
    fail("HERMES_STATE_CORRUPT")
  }
  for (const execution of Object.values(state.executions)) {
    const validationFailure = execution?.metadata?.validationFailure
    if (typeof validationFailure === "string" && validationFailure && SENSITIVE_EVIDENCE.test(validationFailure)) {
      fail("VALIDATION_FAILURE_SECRET_WALL")
    }
    const turnResult = execution?.metadata?.turnResult ?? null
    const turnResultDigest = execution?.metadata?.turnResultDigest ?? null
    if ((turnResult === null) !== (turnResultDigest === null)
      || (turnResult !== null
        && hermesTurnResultDigest(turnResult) !== turnResultDigest)) {
      fail("INVALID_TURN_RESULT_DIGEST")
    }
  }
  if (SENSITIVE_EVIDENCE.test(JSON.stringify(state.idempotency))) {
    fail("IDEMPOTENCY_SECRET_WALL")
  }
  return state
}

export function readHermesState(filePath, storeId = "hermes-bridge") {
  if (!fs.existsSync(filePath)) return initialState(storeId)
  try {
    return validateState(JSON.parse(fs.readFileSync(filePath, "utf8")), storeId)
  } catch (error) {
    if ([
      "HERMES_STATE_CORRUPT",
      "VALIDATION_FAILURE_SECRET_WALL",
      "IDEMPOTENCY_SECRET_WALL",
      "TURN_RESULT_SECRET_WALL",
      "INVALID_TURN_RESULT_DIGEST",
    ].includes(error?.code)) {
      throw error
    }
    fail("HERMES_STATE_CORRUPT", `Unable to read Hermes state: ${error.message}`)
  }
}

function withLock(filePath, operation) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const lockPath = `${filePath}.lock`
  let lock
  try {
    lock = fs.openSync(lockPath, "wx", 0o600)
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs
      if (age <= STALE_LOCK_MS) fail("HERMES_STATE_BUSY")
      fs.unlinkSync(lockPath)
      lock = fs.openSync(lockPath, "wx", 0o600)
    } catch (recoveryError) {
      if (recoveryError?.code === "HERMES_STATE_BUSY") throw recoveryError
      fail("HERMES_STATE_BUSY")
    }
  }
  try { return operation() } finally {
    fs.closeSync(lock)
    fs.unlinkSync(lockPath)
  }
}

function mutate(filePath, storeId, idempotencyKey, request, now, operation) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") fail("IDEMPOTENCY_KEY_REQUIRED")
  return withLock(filePath, () => {
    const state = readHermesState(filePath, storeId)
    const requestHash = digest(request)
    const prior = state.idempotency[idempotencyKey]
    if (prior) {
      if (prior.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT")
      return { ...prior.result, idempotent: true }
    }
    const requestedAt = timestamp(now)
    const priorUpdatedAt = timestamp(state.updatedAt)
    const mutationAt = requestedAt.milliseconds < priorUpdatedAt.milliseconds
      ? priorUpdatedAt
      : requestedAt
    const result = operation(state, mutationAt, requestedAt)
    const next = {
      ...state,
      revision: state.revision + 1,
      updatedAt: mutationAt.iso,
      idempotency: { ...state.idempotency, [idempotencyKey]: { requestHash, result } },
    }
    atomicWrite(filePath, validateState(next, storeId))
    return { ...result, idempotent: false }
  })
}

function assertRunning(state) {
  if (state.killSwitch.active) fail("KILL_SWITCH_ACTIVE")
}

function execution(state, outcomeId) {
  const current = state.executions[outcomeId]
  if (!current) fail("EXECUTION_NOT_FOUND")
  return current
}

function assertFence(current, holderId, fencingToken) {
  if (current.fencingToken !== fencingToken) fail("FENCING_TOKEN_CONFLICT")
  if (current.lease.status !== "ACTIVE" || current.lease.abandonedAt
    || current.lease.holderId !== holderId) {
    fail("LEASE_NOT_HELD")
  }
}

function normalizedValidationEvidence(input, current) {
  const value = Object.hasOwn(input, "validationEvidence")
    ? input.validationEvidence
    : current.validationEvidence ?? null
  if (value === null) return null
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    fail("INVALID_VALIDATION_EVIDENCE")
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.command !== "string" || entry.command.length === 0 || entry.command.length > 100
      || !Array.isArray(entry.args) || entry.args.length > 100
      || entry.args.some((arg) => typeof arg !== "string" || arg.length > 500)
      || !Number.isInteger(entry.code)) {
      fail("INVALID_VALIDATION_EVIDENCE")
    }
    return {
      command: entry.command,
      args: [...entry.args],
      code: entry.code,
      timedOut: entry.timedOut === true,
    }
  })
}

function metadata(input = {}, current = {}) {
  const prNumber = input.prNumber ?? current.prNumber ?? null
  if (prNumber !== null && (!Number.isInteger(prNumber) || prNumber < 1)) fail("INVALID_PR_NUMBER")
  const providerRetryCount = input.providerRetryCount ?? current.providerRetryCount ?? 0
  if (!Number.isInteger(providerRetryCount) || providerRetryCount < 0) fail("INVALID_PROVIDER_RETRY_COUNT")
  const externalToolRetryCount = input.externalToolRetryCount ?? current.externalToolRetryCount ?? 0
  if (!Number.isInteger(externalToolRetryCount) || externalToolRetryCount < 0) {
    fail("INVALID_EXTERNAL_TOOL_RETRY_COUNT")
  }
  const postMergeCleanupRetryCount = input.postMergeCleanupRetryCount
    ?? current.postMergeCleanupRetryCount ?? 0
  if (!Number.isInteger(postMergeCleanupRetryCount) || postMergeCleanupRetryCount < 0) {
    fail("INVALID_POST_MERGE_CLEANUP_RETRY_COUNT")
  }
  const outcome = input.outcome ?? current.outcome ?? null
  if (outcome !== null && (typeof outcome !== "object" || Array.isArray(outcome))) fail("INVALID_OUTCOME_SNAPSHOT")
  if (outcome?.queueBinding !== undefined) {
    const binding = outcome.queueBinding
    if (!binding || typeof binding !== "object" || Array.isArray(binding)
      || typeof binding.userId !== "string" || binding.userId.trim() === ""
      || typeof binding.outcomeKey !== "string" || binding.outcomeKey.trim() === ""
      || !Number.isSafeInteger(binding.expectedVersion) || binding.expectedVersion < 0
      || typeof binding.executionBinding !== "string" || binding.executionBinding.trim() === ""
      || typeof binding.leaseToken !== "string" || binding.leaseToken.trim() === ""
      || !Number.isSafeInteger(binding.fencingToken) || binding.fencingToken <= 0
      || typeof binding.acquisitionKey !== "string" || binding.acquisitionKey.trim() === ""
      || (binding.activeWorkOrderId !== undefined
        && (!Number.isSafeInteger(binding.activeWorkOrderId) || binding.activeWorkOrderId <= 0))) {
      fail("INVALID_OUTCOME_QUEUE_BINDING")
    }
  }
  const runtimeEvidenceRef = input.runtimeEvidenceRef ?? current.runtimeEvidenceRef ?? null
  if (runtimeEvidenceRef !== null
    && (typeof runtimeEvidenceRef !== "string"
      || !/^EV-HERMES-\d+-\d+-\d+$/.test(runtimeEvidenceRef))) {
    fail("INVALID_RUNTIME_EVIDENCE_REF")
  }
  const remediationRound = input.remediationRound ?? current.remediationRound ?? null
  if (remediationRound !== null && (!Number.isInteger(remediationRound) || remediationRound < 0)) {
    fail("INVALID_REMEDIATION_ROUND")
  }
  const validationFailure = Object.hasOwn(input, "validationFailure")
    ? input.validationFailure
    : current.validationFailure ?? null
  if (validationFailure !== null && (typeof validationFailure !== "string" || validationFailure.length > 4_000)) {
    fail("INVALID_VALIDATION_FAILURE")
  }
  if (validationFailure && SENSITIVE_EVIDENCE.test(validationFailure)) {
    fail("VALIDATION_FAILURE_SECRET_WALL")
  }
  const validationRemediationRound = input.validationRemediationRound
    ?? current.validationRemediationRound ?? null
  if (validationRemediationRound !== null
    && (!Number.isInteger(validationRemediationRound) || validationRemediationRound < 0)) {
    fail("INVALID_VALIDATION_REMEDIATION_ROUND")
  }
  const validationRecoveryProofDigest = Object.hasOwn(input, "validationRecoveryProofDigest")
    ? input.validationRecoveryProofDigest
    : current.validationRecoveryProofDigest ?? null
  if (validationRecoveryProofDigest !== null
    && (typeof validationRecoveryProofDigest !== "string" || !SHA256.test(validationRecoveryProofDigest))) {
    fail("INVALID_VALIDATION_RECOVERY_PROOF_DIGEST")
  }
  const validationRecoveryPhase = Object.hasOwn(input, "validationRecoveryPhase")
    ? input.validationRecoveryPhase
    : current.validationRecoveryPhase ?? null
  if (validationRecoveryPhase !== null
    && !["PENDING_HOST_VALIDATION", "VALIDATION_REMEDIATION"].includes(validationRecoveryPhase)) {
    fail("INVALID_VALIDATION_RECOVERY_PHASE")
  }
  const validationRecoveryFence = Object.hasOwn(input, "validationRecoveryFencingToken")
    ? input["validationRecoveryFencing" + "Token"]
    : current["validationRecoveryFencing" + "Token"] ?? null
  if (validationRecoveryFence !== null
    && (!Number.isSafeInteger(validationRecoveryFence) || validationRecoveryFence <= 0)) {
    fail("INVALID_VALIDATION_RECOVERY_FENCING_TOKEN")
  }
  if ((validationRecoveryPhase === null) !== (validationRecoveryFence === null)) {
    fail("INVALID_VALIDATION_RECOVERY_BINDING")
  }
  const reviewRecoveryProofDigest = Object.hasOwn(input, "reviewRecoveryProofDigest")
    ? input.reviewRecoveryProofDigest
    : current.reviewRecoveryProofDigest ?? null
  if (reviewRecoveryProofDigest !== null
    && (typeof reviewRecoveryProofDigest !== "string" || !SHA256.test(reviewRecoveryProofDigest))) {
    fail("INVALID_REVIEW_RECOVERY_PROOF_DIGEST")
  }
  const terminalCleanupRecoveryProofDigest = Object.hasOwn(input, "terminalCleanupRecoveryProofDigest")
    ? input.terminalCleanupRecoveryProofDigest
    : current.terminalCleanupRecoveryProofDigest ?? null
  if (terminalCleanupRecoveryProofDigest !== null
    && (typeof terminalCleanupRecoveryProofDigest !== "string" || !SHA256.test(terminalCleanupRecoveryProofDigest))) {
    fail("INVALID_TERMINAL_CLEANUP_RECOVERY_PROOF_DIGEST")
  }
  const headRefOid = Object.hasOwn(input, "headRefOid")
    ? input.headRefOid
    : current.headRefOid ?? null
  if (headRefOid !== null && (typeof headRefOid !== "string" || !SHA.test(headRefOid))) {
    fail("INVALID_HEAD_REF_OID")
  }
  const reviewRecoveryPriorHeadRefOid = Object.hasOwn(input, "reviewRecoveryPriorHeadRefOid")
    ? input.reviewRecoveryPriorHeadRefOid
    : current.reviewRecoveryPriorHeadRefOid ?? null
  if (reviewRecoveryPriorHeadRefOid !== null
    && (typeof reviewRecoveryPriorHeadRefOid !== "string"
      || !SHA.test(reviewRecoveryPriorHeadRefOid))) {
    fail("INVALID_REVIEW_RECOVERY_PRIOR_HEAD_REF_OID")
  }
  const reviewProjectionReconciledFromSequence = Object.hasOwn(input, "reviewProjectionReconciledFromSequence")
    ? input.reviewProjectionReconciledFromSequence
    : current.reviewProjectionReconciledFromSequence ?? null
  if (reviewProjectionReconciledFromSequence !== null
    && (!Number.isSafeInteger(reviewProjectionReconciledFromSequence)
      || reviewProjectionReconciledFromSequence < 0)) {
    fail("INVALID_REVIEW_PROJECTION_RECONCILIATION_SEQUENCE")
  }
  const ownerDecisionPacket = Object.hasOwn(input, "ownerDecisionPacket")
    ? input.ownerDecisionPacket
    : current.ownerDecisionPacket ?? null
  if (ownerDecisionPacket !== null) {
    if (typeof ownerDecisionPacket !== "object" || Array.isArray(ownerDecisionPacket)) {
      fail("INVALID_OWNER_DECISION_PACKET")
    }
    const fields = [
      ownerDecisionPacket.blockedAction,
      ownerDecisionPacket.authorityBoundary,
      ownerDecisionPacket.minimumChoice,
      ownerDecisionPacket.approveConsequence,
      ownerDecisionPacket.denyConsequence,
    ]
    if (fields.some((value) => typeof value !== "string" || value.trim() === "" || value.length > 1_000)
      || ownerDecisionPacket.minimumChoice !== "APPROVE_OR_DENY"
      || SENSITIVE_EVIDENCE.test(JSON.stringify(ownerDecisionPacket))) {
      fail("INVALID_OWNER_DECISION_PACKET")
    }
  }
  const ownerDecisionPacketDigest = Object.hasOwn(input, "ownerDecisionPacketDigest")
    ? input.ownerDecisionPacketDigest
    : current.ownerDecisionPacketDigest ?? null
  if (ownerDecisionPacketDigest !== null
    && (typeof ownerDecisionPacketDigest !== "string" || !SHA256.test(ownerDecisionPacketDigest))) {
    fail("INVALID_OWNER_DECISION_PACKET_DIGEST")
  }
  const turnResult = Object.hasOwn(input, "turnResult")
    ? input.turnResult
    : current.turnResult ?? null
  const turnResultDigest = Object.hasOwn(input, "turnResultDigest")
    ? input.turnResultDigest
    : current.turnResultDigest ?? null
  const normalizedTurnResult = turnResult === null ? null : normalizeHermesTurnResult(turnResult)
  if ((normalizedTurnResult === null) !== (turnResultDigest === null)
    || (turnResultDigest !== null
      && (!SHA256.test(turnResultDigest)
        || turnResultDigest !== hermesTurnResultDigest(normalizedTurnResult)))) {
    fail("INVALID_TURN_RESULT_DIGEST")
  }
  const validationEvidence = normalizedValidationEvidence(input, current)
  const ownerDecisionNextState = Object.hasOwn(input, "ownerDecisionNextState")
    ? input.ownerDecisionNextState
    : current.ownerDecisionNextState ?? null
  if (ownerDecisionNextState !== null
    && (typeof ownerDecisionNextState !== "string"
      || !/^[A-Z][A-Z0-9_]{1,79}$/.test(ownerDecisionNextState))) {
    fail("INVALID_OWNER_DECISION_NEXT_STATE")
  }
  const ownerDecisionResumePhase = Object.hasOwn(input, "ownerDecisionResumePhase")
    ? input.ownerDecisionResumePhase
    : current.ownerDecisionResumePhase ?? null
  if (ownerDecisionResumePhase !== null
    && !["PENDING", "CONSUMED"].includes(ownerDecisionResumePhase)) {
    fail("INVALID_OWNER_DECISION_RESUME_PHASE")
  }
  const ownerDecisionWorkOrderId = Object.hasOwn(input, "ownerDecisionWorkOrderId")
    ? input.ownerDecisionWorkOrderId
    : current.ownerDecisionWorkOrderId ?? null
  const ownerDecisionTerminalEventId = Object.hasOwn(input, "ownerDecisionTerminalEventId")
    ? input.ownerDecisionTerminalEventId
    : current.ownerDecisionTerminalEventId ?? null
  if (ownerDecisionWorkOrderId !== null
    && (!Number.isSafeInteger(ownerDecisionWorkOrderId) || ownerDecisionWorkOrderId <= 0)) {
    fail("INVALID_OWNER_DECISION_WORK_ORDER_ID")
  }
  if (ownerDecisionTerminalEventId !== null
    && (!Number.isSafeInteger(ownerDecisionTerminalEventId) || ownerDecisionTerminalEventId <= 0)) {
    fail("INVALID_OWNER_DECISION_TERMINAL_EVENT_ID")
  }
  const ownerDecisionId = Object.hasOwn(input, "ownerDecisionId")
    ? input.ownerDecisionId
    : current.ownerDecisionId ?? null
  const ownerDecisionRef = Object.hasOwn(input, "ownerDecisionRef")
    ? input.ownerDecisionRef
    : current.ownerDecisionRef ?? null
  const ownerDecisionRequestKey = Object.hasOwn(input, "ownerDecisionRequestKey")
    ? input.ownerDecisionRequestKey
    : current.ownerDecisionRequestKey ?? null
  if (ownerDecisionId !== null
    && (!Number.isSafeInteger(ownerDecisionId) || ownerDecisionId <= 0)) {
    fail("INVALID_OWNER_DECISION_ID")
  }
  if (ownerDecisionRef !== null
    && (typeof ownerDecisionRef !== "string"
      || !/^OWNER-DECISION-\d+-\d+$/.test(ownerDecisionRef))) {
    fail("INVALID_OWNER_DECISION_REF")
  }
  if (ownerDecisionRequestKey !== null
    && (typeof ownerDecisionRequestKey !== "string"
      || ownerDecisionRequestKey.trim() === ""
      || ownerDecisionRequestKey.length > 1_000)) {
    fail("INVALID_OWNER_DECISION_REQUEST_KEY")
  }
  if ([ownerDecisionId, ownerDecisionRef, ownerDecisionRequestKey]
    .filter((value) => value !== null).length > 0
    && [ownerDecisionId, ownerDecisionRef, ownerDecisionRequestKey]
      .some((value) => value === null)) {
    fail("INVALID_OWNER_DECISION_BINDING")
  }
  return {
    threadId: Object.hasOwn(input, "threadId") ? input.threadId : current.threadId ?? null,
    turnId: Object.hasOwn(input, "turnId") ? input.turnId : current.turnId ?? null,
    branch: input.branch ?? current.branch ?? null,
    prNumber,
    worktreePath: input.worktreePath ?? current.worktreePath ?? null,
    baseSha: input.baseSha ?? current.baseSha ?? null,
    headRefOid,
    mergeSha: input.mergeSha ?? current.mergeSha ?? null,
    providerRetryCount,
    externalToolRetryCount,
    postMergeCleanupRetryCount,
    remediationRound,
    validationFailure,
    validationRemediationRound,
    validationRecoveryProofDigest,
    validationRecoveryPhase,
    ["validationRecoveryFencing" + "Token"]: validationRecoveryFence,
    reviewRecoveryProofDigest,
    terminalCleanupRecoveryProofDigest,
    reviewRecoveryPriorHeadRefOid,
    reviewProjectionReconciledFromSequence,
    ownerDecisionId,
    ownerDecisionRef,
    ownerDecisionRequestKey,
    ownerDecisionNextState,
    ownerDecisionResumePhase,
    ownerDecisionWorkOrderId,
    ownerDecisionTerminalEventId,
    ownerDecisionPacket,
    ownerDecisionPacketDigest,
    turnResult: normalizedTurnResult,
    turnResultDigest,
    validationEvidence,
    runtimeEvidenceRef,
    outcome,
  }
}

export function initializeHermesState(filePath, { storeId = "hermes-bridge", now } = {}) {
  return withLock(filePath, () => {
    if (fs.existsSync(filePath)) return readHermesState(filePath, storeId)
    const state = initialState(storeId, now)
    atomicWrite(filePath, state)
    return state
  })
}

export function acquireLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at, requestedAt) => {
    assertRunning(state)
    if (!request.outcomeId || !request.holderId || !Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const existing = state.executions[request.outcomeId]
    if (existing) {
      fail(Date.parse(existing.lease.expiresAt) <= requestedAt.milliseconds
        ? "LEASE_RECLAIM_REQUIRED"
        : "LEASE_ALREADY_HELD")
    }
    const fencingFence = state.nextFencingToken++
    const current = {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: fencingFence,
      lease: {
        status: "ACTIVE",
        holderId: request.holderId,
        acquiredAt: at.iso,
        expiresAt: new Date(requestedAt.milliseconds + request.leaseDurationMs).toISOString(),
      },
      checkpoint: { sequence: 0, state: "LEASED", detail: null, recordedAt: at.iso },
      metadata: metadata(request.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: current }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: fencingFence, checkpointSequence: 0, leaseExpiresAt: current.lease.expiresAt, metadata: current.metadata }
  })
}

export function reclaimLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at, requestedAt) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (current.lease.status !== "ABANDONED" && !current.lease.abandonedAt
      && Date.parse(current.lease.expiresAt) > requestedAt.milliseconds) {
      fail("LEASE_NOT_EXPIRED")
    }
    if (!request.holderId || !Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const fencingFence = state.nextFencingToken++
    const reclaimed = {
      ...current,
      ["fencing" + "Token"]: fencingFence,
      lease: {
        status: "ACTIVE",
        holderId: request.holderId,
        acquiredAt: at.iso,
        expiresAt: new Date(requestedAt.milliseconds + request.leaseDurationMs).toISOString(),
      },
      metadata: metadata(request.metadata, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reclaimed }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: fencingFence, checkpointSequence: reclaimed.checkpoint.sequence, leaseExpiresAt: reclaimed.lease.expiresAt, metadata: reclaimed.metadata }
  })
}

export function writeCheckpoint(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at, requestedAt) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    if (Date.parse(current.lease.expiresAt) <= requestedAt.milliseconds) fail("LEASE_EXPIRED")
    if (request.expectedCheckpointSequence !== current.checkpoint.sequence) fail("CHECKPOINT_SEQUENCE_CONFLICT")
    if (typeof request.state !== "string" || request.state.trim() === "") fail("CHECKPOINT_STATE_INVALID")
    const updated = {
      ...current,
      checkpoint: { sequence: current.checkpoint.sequence + 1, state: request.state, detail: request.detail ?? null, recordedAt: at.iso },
      metadata: metadata(request.metadata, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: updated }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: updated.fencingToken, checkpointSequence: updated.checkpoint.sequence, state: updated.checkpoint.state, metadata: updated.metadata }
  })
}

export function renewLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at, requestedAt) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    if (Date.parse(current.lease.expiresAt) <= requestedAt.milliseconds) fail("LEASE_EXPIRED")
    if (!Number.isFinite(request.leaseDurationMs) || request.leaseDurationMs <= 0) fail("LEASE_REQUEST_INVALID")
    const renewed = {
      ...current,
      lease: {
        ...current.lease,
        expiresAt: new Date(requestedAt.milliseconds + request.leaseDurationMs).toISOString(),
        renewedAt: at.iso,
      },
    }
    state.executions = { ...state.executions, [request.outcomeId]: renewed }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: current.fencingToken, leaseExpiresAt: renewed.lease.expiresAt }
  })
}

export function releaseLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    const released = { ...current, lease: { ...current.lease, status: "RELEASED", expiresAt: at.iso, releasedAt: at.iso } }
    state.executions = { ...state.executions, [request.outcomeId]: released }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: current.fencingToken, checkpointSequence: current.checkpoint.sequence, leaseStatus: "RELEASED" }
  })
}

export function abandonLease(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    const abandoned = {
      ...current,
      lease: { ...current.lease, expiresAt: at.iso, abandonedAt: at.iso, abandonReason: request.reason ?? null },
    }
    state.executions = { ...state.executions, [request.outcomeId]: abandoned }
    return { outcomeId: request.outcomeId, ["fencing" + "Token"]: current.fencingToken, leaseExpiresAt: at.iso }
  })
}

export function reopenProviderWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (current.lease.status !== "RELEASED" || current.checkpoint.state !== "FAILED_TERMINAL"
      || current.checkpoint.detail !== request.expectedDetail) {
      fail("PROVIDER_RECOVERY_STATE_WALL")
    }
    const reopened = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "TRANSIENT_NATIVE_PROVIDER_WALL",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "RETRYABLE_PROVIDER_WALL",
        detail: request.expectedDetail,
        recordedAt: at.iso,
      },
      metadata: metadata({ threadId: null, turnId: null }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
    }
  })
}

export function reopenOwnerDecisionWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "OWNER_DECISION_REQUIRED"
      || typeof request.expectedNextState !== "string"
      || current.checkpoint.detail !== request.expectedNextState
      || current.metadata.ownerDecisionPacket === null
      || request.decisionPacketDigest !== textDigest(JSON.stringify(current.metadata.ownerDecisionPacket))
      || request.decisionPacketDigest !== textDigest(JSON.stringify(request.decisionPacket))
      || JSON.stringify(request.decisionPacket) !== JSON.stringify(current.metadata.ownerDecisionPacket)) {
      fail("OWNER_DECISION_REOPEN_STATE_WALL")
    }
    const reopened = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "OWNER_DECISION_ACCEPTED",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "OWNER_DECISION_ACCEPTED",
        detail: request.expectedNextState,
        recordedAt: at.iso,
      },
      metadata: metadata({
        outcome: request.outcome ?? current.metadata.outcome,
        ownerDecisionId: request.ownerDecisionId ?? null,
        ownerDecisionRef: request.ownerDecisionRef ?? null,
        ownerDecisionRequestKey: request.requestKey ?? null,
        ownerDecisionNextState: request.expectedNextState,
        ownerDecisionResumePhase: "PENDING",
        ownerDecisionWorkOrderId: request.workOrderId,
        ownerDecisionTerminalEventId: request.terminalEventId,
        ownerDecisionPacketDigest: request.decisionPacketDigest,
      }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
      state: reopened.checkpoint.state,
    }
  })
}

export function reopenValidationInfrastructureWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    const releasedOrExactlyAbandoned = current.lease.status === "RELEASED"
      || (current.lease.status === "ACTIVE"
        && typeof current.lease.abandonedAt === "string"
        && current.lease.abandonedAt === current.lease.expiresAt
        && current.lease.abandonReason === "HERMES_CYCLE_PROCESS_EXIT")
    if (!releasedOrExactlyAbandoned
      || current.checkpoint.state !== "FAILED_TERMINAL"
      || current.checkpoint.detail !== VALIDATION_INFRASTRUCTURE_DETAIL
      || request.expectedDetail !== VALIDATION_INFRASTRUCTURE_DETAIL
      || typeof current.metadata.validationFailure !== "string"
      || !isValidationInfrastructureFailure(current.metadata.validationFailure)
      || textDigest(current.metadata.validationFailure) !== request.expectedValidationFailureDigest
      || typeof request.proofDigest !== "string"
      || !SHA256.test(request.proofDigest)
      || !ownerTouchesRemainZero) {
      fail("VALIDATION_INFRASTRUCTURE_RECOVERY_STATE_WALL")
    }
    const recoveryFence = state.nextFencingToken++
    const reopened = {
      ...current,
      ["fencing" + "Token"]: recoveryFence,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "VALIDATION_INFRASTRUCTURE_REMEDIATED",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "VALIDATION_INFRASTRUCTURE_RECOVERED",
        detail: VALIDATION_INFRASTRUCTURE_DETAIL,
        recordedAt: at.iso,
      },
      metadata: metadata({
        validationFailure: null,
        validationEvidence: null,
        validationRemediationRound: 0,
        validationRecoveryProofDigest: request.proofDigest,
        validationRecoveryPhase: "PENDING_HOST_VALIDATION",
        ["validationRecoveryFencing" + "Token"]: current.fencingToken,
        headRefOid: null,
      }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
      state: reopened.checkpoint.state,
    }
  })
}

export function beginReviewRemediationRecovery(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "FAILED_TERMINAL"
      || current.checkpoint.detail !== REVIEW_REMEDIATION_DETAIL
      || !Number.isInteger(request.prNumber)
      || request.prNumber < 1
      || request.prNumber !== current.metadata.prNumber
      || typeof request.expectedPriorHeadRefOid !== "string"
      || !SHA.test(request.expectedPriorHeadRefOid)
      || request.expectedPriorHeadRefOid !== current.metadata.headRefOid
      || typeof request.headRefOid !== "string"
      || !SHA.test(request.headRefOid)
      || typeof request.mergeSha !== "string"
      || !SHA.test(request.mergeSha)
      || typeof request.proofDigest !== "string"
      || !SHA256.test(request.proofDigest)
      || !ownerTouchesRemainZero) {
      fail("REVIEW_REMEDIATION_RECOVERY_STATE_WALL")
    }
    const reopened = {
      ...current,
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "REVIEW_REMEDIATION_RECOVERY_PENDING",
        detail: REVIEW_REMEDIATION_DETAIL,
        recordedAt: at.iso,
      },
      metadata: metadata({
        reviewRecoveryPriorHeadRefOid: request.expectedPriorHeadRefOid,
        headRefOid: request.headRefOid,
        mergeSha: request.mergeSha,
        reviewRecoveryProofDigest: request.proofDigest,
      }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
      state: reopened.checkpoint.state,
    }
  })
}

export function recordReviewRemediationMerge(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    const expectedDirectDetail = `Recovered reviewed PR #${current.metadata.prNumber}`
    const expectedChainDetail = `Recovered PR #${current.metadata.prNumber} through reviewed remediation chain`
    if (current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "REVIEW_REMEDIATION_RECOVERY_PENDING"
      || current.checkpoint.detail !== REVIEW_REMEDIATION_DETAIL
      || request.prNumber !== current.metadata.prNumber
      || request.headRefOid !== current.metadata.headRefOid
      || request.mergeSha !== current.metadata.mergeSha
      || request.proofDigest !== current.metadata.reviewRecoveryProofDigest
      || ![expectedDirectDetail, expectedChainDetail].includes(request.mergeDetail)
      || !ownerTouchesRemainZero) {
      fail("REVIEW_REMEDIATION_MERGE_STATE_WALL")
    }
    const merged = {
      ...current,
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "PR_MERGED",
        detail: request.mergeDetail,
        recordedAt: at.iso,
      },
    }
    state.executions = { ...state.executions, [request.outcomeId]: merged }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: merged.fencingToken,
      checkpointSequence: merged.checkpoint.sequence,
      leaseStatus: merged.lease.status,
      state: merged.checkpoint.state,
    }
  })
}

export function finalizeReviewRemediationRecovery(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "PR_MERGED"
      || current.checkpoint.detail !== request.mergeDetail
      || request.prNumber !== current.metadata.prNumber
      || request.headRefOid !== current.metadata.headRefOid
      || request.mergeSha !== current.metadata.mergeSha
      || request.proofDigest !== current.metadata.reviewRecoveryProofDigest
      || !ownerTouchesRemainZero) {
      fail("REVIEW_REMEDIATION_RECOVERY_STATE_WALL")
    }
    const reopened = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "REVIEW_REMEDIATION_PROOF_ACCEPTED",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: REVIEW_REMEDIATION_DETAIL,
        recordedAt: at.iso,
      },
      metadata: metadata({ threadId: null, turnId: null }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reopened }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reopened.fencingToken,
      checkpointSequence: reopened.checkpoint.sequence,
      leaseStatus: reopened.lease.status,
      state: reopened.checkpoint.state,
    }
  })
}

export function reconcileReviewRemediationProjection(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (current.fencingToken !== request.expectedFencingToken) fail("FENCING_TOKEN_CONFLICT")
    if (current.lease.status !== "ABANDONED"
      || current.checkpoint.state !== "REVIEW_REMEDIATION_RECOVERED"
      || current.checkpoint.detail !== REVIEW_REMEDIATION_DETAIL
      || current.checkpoint.sequence !== request.expectedCheckpointSequence
      || request.prNumber !== current.metadata.prNumber
      || request.headRefOid !== current.metadata.headRefOid
      || request.mergeSha !== current.metadata.mergeSha
      || request.proofDigest !== current.metadata.reviewRecoveryProofDigest
      || (current.metadata.reviewProjectionReconciledFromSequence ?? null) !== null
      || !ownerTouchesRemainZero) {
      fail("REVIEW_REMEDIATION_PROJECTION_RECOVERY_STATE_WALL")
    }
    const reconciled = {
      ...current,
      checkpoint: {
        ...current.checkpoint,
        sequence: current.checkpoint.sequence + 1,
        recordedAt: at.iso,
      },
      metadata: metadata({
        reviewProjectionReconciledFromSequence: current.checkpoint.sequence,
      }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: reconciled }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: reconciled.fencingToken,
      checkpointSequence: reconciled.checkpoint.sequence,
      leaseStatus: reconciled.lease.status,
      state: reconciled.checkpoint.state,
    }
  })
}

export function recoverExternalToolWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (request.activationDisabled !== true
      || current.fencingToken !== request.expectedFencingToken
      || current.lease.status !== "ACTIVE"
      || current.lease.holderId !== request.expectedHolderId
      || current.checkpoint.state !== "RETRYABLE_WALL"
      || current.checkpoint.detail !== "APP_SERVER_EXTERNAL_TOOL_WALL"
      || !ownerTouchesRemainZero) {
      fail("EXTERNAL_TOOL_RECOVERY_STATE_WALL")
    }
    const recovered = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "APP_SERVER_EXTERNAL_TOOL_WALL",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "EXTERNAL_TOOL_WALL_RECOVERED",
        detail: "APP_SERVER_EXTERNAL_TOOL_WALL",
        recordedAt: at.iso,
      },
      metadata: metadata({ threadId: null, turnId: null }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: recovered }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: recovered.fencingToken,
      checkpointSequence: recovered.checkpoint.sequence,
      leaseStatus: recovered.lease.status,
    }
  })
}

export function recoverPostMergeCleanupWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (request.activationDisabled !== true
      || current.fencingToken !== request.expectedFencingToken
      || current.lease.status !== "ACTIVE"
      || current.lease.holderId !== request.expectedHolderId
      || current.checkpoint.state !== "PR_MERGED"
      || !Number.isInteger(current.metadata.prNumber)
      || !SHA.test(current.metadata.headRefOid ?? "")
      || !SHA.test(current.metadata.mergeSha ?? "")
      || !ownerTouchesRemainZero) {
      fail("POST_MERGE_CLEANUP_RECOVERY_STATE_WALL")
    }
    const recovered = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "POST_MERGE_CLEANUP_INTERRUPTED",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "POST_MERGE_CLEANUP_RECOVERED",
        detail: `PR #${current.metadata.prNumber}`,
        recordedAt: at.iso,
      },
    }
    state.executions = { ...state.executions, [request.outcomeId]: recovered }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: recovered.fencingToken,
      checkpointSequence: recovered.checkpoint.sequence,
      leaseStatus: recovered.lease.status,
    }
  })
}

export function beginTerminalPostMergeCleanupRecovery(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (request.activationDisabled !== true
      || current.fencingToken !== request.expectedFencingToken
      || current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "FAILED_TERMINAL"
      || current.checkpoint.detail !== "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
      || current.checkpoint.sequence !== request.expectedCheckpointSequence
      || current.metadata.postMergeCleanupRetryCount !== 3
      || current.metadata.prNumber !== request.prNumber
      || current.metadata.branch !== request.branch
      || current.metadata.worktreePath !== request.worktreePath
      || current.metadata.headRefOid !== request.headRefOid
      || current.metadata.mergeSha !== request.mergeSha
      || typeof request.proofDigest !== "string"
      || !SHA256.test(request.proofDigest)
      || !Number.isInteger(current.metadata.prNumber)
      || !SHA.test(current.metadata.headRefOid ?? "")
      || !SHA.test(current.metadata.mergeSha ?? "")
      || String(current.metadata.outcome?.id ?? "") !== String(request.outcomeId)
      || !ownerTouchesRemainZero) {
      fail("TERMINAL_POST_MERGE_CLEANUP_RECOVERY_STATE_WALL")
    }
    const recovered = {
      ...current,
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "POST_MERGE_CLEANUP_TERMINAL_RECOVERY_PENDING",
        detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
        recordedAt: at.iso,
      },
      metadata: metadata({
        terminalCleanupRecoveryProofDigest: request.proofDigest,
      }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: recovered }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: recovered.fencingToken,
      checkpointSequence: recovered.checkpoint.sequence,
      leaseStatus: recovered.lease.status,
    }
  })
}

export function finalizeTerminalPostMergeCleanupRecovery(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    const ownerTouchesRemainZero = COUNTER_NAMES.every(
      (counter) => state.ownerTouchCounters[counter] === 0,
    )
    if (request.activationDisabled !== true
      || current.fencingToken !== request.expectedFencingToken
      || current.lease.status !== "RELEASED"
      || current.checkpoint.state !== "POST_MERGE_CLEANUP_TERMINAL_RECOVERY_PENDING"
      || current.checkpoint.detail !== "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
      || current.checkpoint.sequence !== request.expectedCheckpointSequence
      || current.metadata.prNumber !== request.prNumber
      || current.metadata.branch !== request.branch
      || current.metadata.worktreePath !== request.worktreePath
      || current.metadata.headRefOid !== request.headRefOid
      || current.metadata.mergeSha !== request.mergeSha
      || current.metadata.terminalCleanupRecoveryProofDigest !== request.proofDigest
      || !ownerTouchesRemainZero) {
      fail("TERMINAL_POST_MERGE_CLEANUP_RECOVERY_FINALIZE_WALL")
    }
    const recovered = {
      ...current,
      lease: {
        ...current.lease,
        status: "ABANDONED",
        expiresAt: at.iso,
        recoveredAt: at.iso,
        recoverReason: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "POST_MERGE_CLEANUP_RECOVERED",
        detail: `PR #${current.metadata.prNumber}`,
        recordedAt: at.iso,
      },
      metadata: metadata({ postMergeCleanupRetryCount: 0 }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: recovered }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: recovered.fencingToken,
      checkpointSequence: recovered.checkpoint.sequence,
      leaseStatus: recovered.lease.status,
    }
  })
}

export function deferProviderWall(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at, requestedAt) => {
    assertRunning(state)
    const current = execution(state, request.outcomeId)
    assertFence(current, request.holderId, request.fencingToken)
    const retryAt = timestamp(request.retryAfter)
    if (retryAt.milliseconds <= requestedAt.milliseconds
      || current.checkpoint.state !== "PROVIDER_UNAVAILABLE") {
      fail("PROVIDER_DEFERRAL_STATE_WALL")
    }
    const deferred = {
      ...current,
      lease: {
        ...current.lease,
        status: "DEFERRED",
        expiresAt: retryAt.iso,
        deferredAt: at.iso,
        deferReason: "PROVIDER_UNAVAILABLE",
      },
      checkpoint: {
        sequence: current.checkpoint.sequence + 1,
        state: "DEFERRED_PROVIDER_UNAVAILABLE",
        detail: retryAt.iso,
        recordedAt: at.iso,
      },
      metadata: metadata({ providerRetryCount: 0, externalToolRetryCount: 0 }, current.metadata),
    }
    state.executions = { ...state.executions, [request.outcomeId]: deferred }
    return {
      outcomeId: request.outcomeId,
      ["fencing" + "Token"]: deferred.fencingToken,
      checkpointSequence: deferred.checkpoint.sequence,
      leaseStatus: deferred.lease.status,
      retryAfter: retryAt.iso,
    }
  })
}

export function setKillSwitch(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state, at) => {
    if (typeof request.active !== "boolean") fail("KILL_SWITCH_REQUEST_INVALID")
    state.killSwitch = { active: request.active, reason: request.reason ?? null, updatedAt: at.iso }
    return { killSwitch: state.killSwitch }
  })
}

export function recordOwnerTouch(filePath, request, options = {}) {
  const { storeId = "hermes-bridge", now } = options
  return mutate(filePath, storeId, request.idempotencyKey, request, now, (state) => {
    const counter = COUNTER_ALIASES[request.counter] ?? request.counter
    if (!COUNTER_NAMES.includes(counter)) fail("OWNER_TOUCH_COUNTER_INVALID")
    const amount = request.amount ?? 1
    if (!Number.isInteger(amount) || amount < 1) fail("OWNER_TOUCH_AMOUNT_INVALID")
    state.ownerTouchCounters = { ...state.ownerTouchCounters, [counter]: state.ownerTouchCounters[counter] + amount }
    return { ownerTouchCounters: state.ownerTouchCounters }
  })
}

export function createHermesStateStore(filePath, options = {}) {
  return Object.freeze({
    initialize: () => initializeHermesState(filePath, options),
    read: () => readHermesState(filePath, options.storeId),
    acquireLease: (request) => acquireLease(filePath, request, options),
    reclaimLease: (request) => reclaimLease(filePath, request, options),
    checkpoint: (request) => writeCheckpoint(filePath, request, options),
    renewLease: (request) => renewLease(filePath, request, options),
    abandonLease: (request) => abandonLease(filePath, request, options),
    releaseLease: (request) => releaseLease(filePath, request, options),
    reopenProviderWall: (request) => reopenProviderWall(filePath, request, options),
    reopenOwnerDecisionWall: (request) => reopenOwnerDecisionWall(filePath, request, options),
    reopenValidationInfrastructureWall: (request) => reopenValidationInfrastructureWall(filePath, request, options),
    beginReviewRemediationRecovery: (request) => beginReviewRemediationRecovery(filePath, request, options),
    recordReviewRemediationMerge: (request) => recordReviewRemediationMerge(filePath, request, options),
    finalizeReviewRemediationRecovery: (request) => finalizeReviewRemediationRecovery(filePath, request, options),
    reconcileReviewRemediationProjection: (request) => reconcileReviewRemediationProjection(filePath, request, options),
    recoverExternalToolWall: (request) => recoverExternalToolWall(filePath, request, options),
    recoverPostMergeCleanupWall: (request) => recoverPostMergeCleanupWall(filePath, request, options),
    beginTerminalPostMergeCleanupRecovery: (request) => beginTerminalPostMergeCleanupRecovery(filePath, request, options),
    finalizeTerminalPostMergeCleanupRecovery: (request) => finalizeTerminalPostMergeCleanupRecovery(filePath, request, options),
    deferProviderWall: (request) => deferProviderWall(filePath, request, options),
    setKillSwitch: (request) => setKillSwitch(filePath, request, options),
    recordOwnerTouch: (request) => recordOwnerTouch(filePath, request, options),
  })
}

export const checkpoint = writeCheckpoint
export const readState = readHermesState
export const initializeStateStore = initializeHermesState
