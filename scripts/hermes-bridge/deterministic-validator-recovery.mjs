import { createHash } from "node:crypto"

export const HERMES_DETERMINISTIC_VALIDATOR_VERSION = "changed-test-literal-coverage.v2"
export const HERMES_DETERMINISTIC_VALIDATOR_WALL = "HERMES_WORK_CONTRACT_VALIDATOR_WALL"
export const HERMES_DETERMINISTIC_RECOVERY_VERSION = "hermes-deterministic-validator-recovery.v2"
export const HERMES_DETERMINISTIC_CIRCUIT_VERSION = "hermes-deterministic-validator-circuit.v1"

const SHA256 = /^[0-9a-f]{64}$/
const TEST_PATH = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:test|spec)\.[cm]?[jt]sx?$/
const CIRCUIT_STATUSES = new Set([
  "DETERMINISTIC_CONTRACT_RECOVERY",
  "RECOVERY_ACTIVE",
  "RECOVERED",
  "RECOVERY_REQUIRED",
])

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`
  }
  return JSON.stringify(value)
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function wall(code, message) {
  throw Object.assign(new Error(message ?? code), { code })
}

function normalizedIdentity(value, field, pattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/) {
  if (typeof value !== "string") wall("HERMES_DETERMINISTIC_RECOVERY_INPUT_WALL", field)
  const normalized = value.trim()
  if (!pattern.test(normalized) || normalized.includes("..")) {
    wall("HERMES_DETERMINISTIC_RECOVERY_INPUT_WALL", field)
  }
  return normalized
}

export function normalizeDeterministicTestPath(value) {
  if (typeof value !== "string") wall("HERMES_DETERMINISTIC_RECOVERY_PATH_WALL")
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!TEST_PATH.test(normalized) || normalized.startsWith("/")
    || normalized.split("/").includes("..")) {
    wall("HERMES_DETERMINISTIC_RECOVERY_PATH_WALL")
  }
  return normalized
}

export function normalizeDeterministicTestPaths(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    wall("HERMES_DETERMINISTIC_RECOVERY_PATH_WALL")
  }
  const normalized = [...new Set(value.map(normalizeDeterministicTestPath))].sort()
  if (normalized.length !== value.length) wall("HERMES_DETERMINISTIC_RECOVERY_PATH_WALL")
  return Object.freeze(normalized)
}

function normalizeWorkingDirectory(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "."
  const normalized = String(value).trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (normalized.startsWith("/") || normalized.split("/").includes("..")
    || !/^(?:\.|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/.test(normalized)) {
    wall("HERMES_DETERMINISTIC_RECOVERY_COMMAND_WALL")
  }
  return normalized
}

export function buildFocusedValidationCommand({ command = "npx", prefixArgs = ["vitest", "run"],
  testPaths, workingDirectory = ".", timeoutMs = 20 * 60 * 1000 } = {}) {
  const executable = normalizedIdentity(command, "command", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  if (!Array.isArray(prefixArgs) || prefixArgs.length === 0 || prefixArgs.length > 20
    || prefixArgs.some((entry) => typeof entry !== "string" || entry.trim() === ""
      || /[\r\n\0]/.test(entry))) {
    wall("HERMES_DETERMINISTIC_RECOVERY_COMMAND_WALL")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20 * 60 * 1000) {
    wall("HERMES_DETERMINISTIC_RECOVERY_COMMAND_WALL")
  }
  const paths = normalizeDeterministicTestPaths(testPaths)
  return Object.freeze({
    command: executable,
    args: Object.freeze([...prefixArgs.map((entry) => entry.trim()), ...paths]),
    workingDirectory: normalizeWorkingDirectory(workingDirectory),
    timeoutMs,
  })
}

function normalizedContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)
    || typeof contract.id !== "string" || typeof contract.digest !== "string"
    || !SHA256.test(contract.digest) || !Array.isArray(contract.validationCommands)
    || !Array.isArray(contract.reservations)) {
    wall("HERMES_DETERMINISTIC_RECOVERY_CONTRACT_WALL")
  }
  return contract
}

export function createDeterministicValidatorWallEvidence({
  outcomeId, outcomeKey, contract, worktreeSnapshotHash, missingTestPaths,
  focusedValidationCommand, validatorVersion = HERMES_DETERMINISTIC_VALIDATOR_VERSION,
  wallCode = HERMES_DETERMINISTIC_VALIDATOR_WALL,
} = {}) {
  const normalizedOutcomeId = normalizedIdentity(String(outcomeId ?? ""), "outcomeId", /^[1-9][0-9]{0,18}$/)
  const normalizedOutcomeKey = normalizedIdentity(outcomeKey, "outcomeKey")
  const normalizedContractBody = normalizedContract(contract)
  if (!SHA256.test(String(worktreeSnapshotHash ?? ""))) {
    wall("HERMES_DETERMINISTIC_RECOVERY_INPUT_WALL", "worktreeSnapshotHash")
  }
  const paths = normalizeDeterministicTestPaths(missingTestPaths)
  const command = buildFocusedValidationCommand({
    command: focusedValidationCommand?.command,
    prefixArgs: focusedValidationCommand?.args?.filter((arg) => !paths.includes(
      typeof arg === "string" ? arg.replaceAll("\\", "/").replace(/^\.\//, "") : arg,
    )),
    testPaths: paths,
    workingDirectory: focusedValidationCommand?.workingDirectory,
    timeoutMs: focusedValidationCommand?.timeoutMs,
  })
  const structuredInputs = Object.freeze({
    outcomeId: normalizedOutcomeId,
    outcomeKey: normalizedOutcomeKey,
    contract: Object.freeze({ id: normalizedContractBody.id, digest: normalizedContractBody.digest }),
    worktreeSnapshotHash,
    validatorVersion: normalizedIdentity(validatorVersion, "validatorVersion"),
    wallCode: normalizedIdentity(wallCode, "wallCode", /^[A-Z][A-Z0-9_]{2,99}$/),
    missingTestPaths: paths,
    focusedValidationCommand: command,
  })
  return Object.freeze({
    version: HERMES_DETERMINISTIC_RECOVERY_VERSION,
    fingerprint: canonicalSha256(structuredInputs),
    structuredInputs,
  })
}

export function createDeterministicValidatorReplacement({ contract, evidence,
  recoveryAttemptOrdinal = 1 } = {}) {
  const oldContract = normalizedContract(contract)
  if (!evidence || evidence.version !== HERMES_DETERMINISTIC_RECOVERY_VERSION
    || evidence.fingerprint !== canonicalSha256(evidence.structuredInputs)
    || evidence.structuredInputs.contract.id !== oldContract.id
    || evidence.structuredInputs.contract.digest !== oldContract.digest
    || recoveryAttemptOrdinal !== 1) {
    wall("HERMES_DETERMINISTIC_RECOVERY_CONTRACT_WALL")
  }
  const command = evidence.structuredInputs.focusedValidationCommand
  const commandForContract = Object.freeze({
    command: command.command,
    args: command.args,
    ...(command.workingDirectory === "." ? {} : { workingDirectory: command.workingDirectory }),
    timeoutMs: command.timeoutMs,
  })
  const replacementBody = {
    ...Object.fromEntries(Object.entries(oldContract).filter(([key]) => key !== "digest")),
    id: `${oldContract.id}.recovery-${evidence.fingerprint.slice(0, 12)}`,
    validationCommands: Object.freeze([...oldContract.validationCommands, commandForContract]),
  }
  const replacementContract = Object.freeze({
    ...replacementBody,
    digest: canonicalSha256(replacementBody),
  })
  return Object.freeze({
    recoveryId: `DVR-${evidence.fingerprint.slice(0, 24).toUpperCase()}`,
    recoveryAttemptOrdinal,
    fingerprint: evidence.fingerprint,
    structuredInputs: evidence.structuredInputs,
    supersedes: Object.freeze({ id: oldContract.id, digest: oldContract.digest }),
    oldContract: Object.freeze(oldContract),
    replacementContract,
  })
}

export function createDeterministicValidatorCircuit({ evidence, replacement, sourceFencingToken,
  sourceCheckpointSequence, observedAt } = {}) {
  if (!evidence || !replacement || evidence.fingerprint !== replacement.fingerprint
    || replacement.recoveryAttemptOrdinal !== 1
    || !Number.isSafeInteger(sourceFencingToken) || sourceFencingToken <= 0
    || !Number.isSafeInteger(sourceCheckpointSequence) || sourceCheckpointSequence < 0
    || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) {
    wall("HERMES_DETERMINISTIC_RECOVERY_INPUT_WALL")
  }
  return Object.freeze({
    version: HERMES_DETERMINISTIC_CIRCUIT_VERSION,
    status: "DETERMINISTIC_CONTRACT_RECOVERY",
    fingerprint: evidence.fingerprint,
    recoveryAttemptOrdinal: 1,
    sourceFencingToken,
    sourceCheckpointSequence,
    observedAt: new Date(observedAt).toISOString(),
    recovery: replacement,
    history: Object.freeze([Object.freeze({
      fingerprint: evidence.fingerprint,
      status: "DETERMINISTIC_CONTRACT_RECOVERY",
      observedAt: new Date(observedAt).toISOString(),
    })]),
  })
}

export function transitionDeterministicValidatorCircuit(circuit, { status, fingerprint,
  observedAt } = {}) {
  const current = validateDeterministicValidatorCircuit(circuit)
  if (!current || !CIRCUIT_STATUSES.has(status)
    || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) {
    wall("HERMES_DETERMINISTIC_RECOVERY_STATE_WALL")
  }
  if (status === "RECOVERY_ACTIVE" && current.status !== "DETERMINISTIC_CONTRACT_RECOVERY") {
    wall("HERMES_DETERMINISTIC_RECOVERY_STATE_WALL")
  }
  if (status === "RECOVERED" && current.status !== "RECOVERY_ACTIVE") {
    wall("HERMES_DETERMINISTIC_RECOVERY_STATE_WALL")
  }
  if (status === "RECOVERY_REQUIRED" && !["RECOVERY_ACTIVE", "RECOVERED"].includes(current.status)) {
    wall("HERMES_DETERMINISTIC_RECOVERY_STATE_WALL")
  }
  const nextFingerprint = fingerprint ?? current.fingerprint
  if (!SHA256.test(nextFingerprint)) wall("HERMES_DETERMINISTIC_RECOVERY_STATE_WALL")
  const at = new Date(observedAt).toISOString()
  return Object.freeze({
    ...current,
    status,
    fingerprint: nextFingerprint,
    history: Object.freeze([...current.history, Object.freeze({
      fingerprint: nextFingerprint,
      status,
      observedAt: at,
    })]),
  })
}

export function validateDeterministicValidatorCircuit(value) {
  const legalHistory = new Set([
    "DETERMINISTIC_CONTRACT_RECOVERY",
    "DETERMINISTIC_CONTRACT_RECOVERY>RECOVERY_ACTIVE",
    "DETERMINISTIC_CONTRACT_RECOVERY>RECOVERY_ACTIVE>RECOVERED",
    "DETERMINISTIC_CONTRACT_RECOVERY>RECOVERY_ACTIVE>RECOVERY_REQUIRED",
    "DETERMINISTIC_CONTRACT_RECOVERY>RECOVERY_ACTIVE>RECOVERED>RECOVERY_REQUIRED",
  ])
  const recovery = value?.recovery
  const replacementContract = recovery?.replacementContract
  const replacementBody = replacementContract && typeof replacementContract === "object"
    ? Object.fromEntries(Object.entries(replacementContract).filter(([key]) => key !== "digest"))
    : null
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.version !== HERMES_DETERMINISTIC_CIRCUIT_VERSION
    || !CIRCUIT_STATUSES.has(value.status) || !SHA256.test(String(value.fingerprint ?? ""))
    || value.recoveryAttemptOrdinal !== 1 || !Number.isSafeInteger(value.sourceFencingToken)
    || value.sourceFencingToken <= 0 || !Number.isSafeInteger(value.sourceCheckpointSequence)
    || value.sourceCheckpointSequence < 0 || typeof value.observedAt !== "string"
    || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.history)
    || value.history.length < 1 || value.history.length > 20
    || value.history.some((entry) => !entry || !SHA256.test(String(entry.fingerprint ?? ""))
      || !CIRCUIT_STATUSES.has(entry.status) || !Number.isFinite(Date.parse(entry.observedAt)))
    || value.history.at(-1)?.status !== value.status
    || value.history.at(-1)?.fingerprint !== value.fingerprint
    || !legalHistory.has(value.history.map((entry) => entry.status).join(">"))
    || recovery?.fingerprint !== value.history[0]?.fingerprint
    || recovery?.fingerprint !== canonicalSha256(recovery?.structuredInputs)
    || recovery?.recoveryAttemptOrdinal !== 1
    || recovery?.structuredInputs?.outcomeId === undefined
    || recovery?.structuredInputs?.contract?.id !== recovery?.oldContract?.id
    || recovery?.structuredInputs?.contract?.digest !== recovery?.oldContract?.digest
    || recovery?.supersedes?.id !== recovery?.oldContract?.id
    || recovery?.supersedes?.digest !== recovery?.oldContract?.digest
    || !replacementContract || !SHA256.test(String(replacementContract.digest ?? ""))
    || replacementContract.digest !== canonicalSha256(replacementBody)
    || !Array.isArray(replacementContract.validationCommands)
    || replacementContract.validationCommands.length !== recovery.oldContract.validationCommands.length + 1
    || replacementContract.id !== `${recovery.oldContract.id}.recovery-${recovery.fingerprint.slice(0, 12)}`) return null
  return value
}
