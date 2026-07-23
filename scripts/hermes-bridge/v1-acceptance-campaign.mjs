import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ISSUE_NUMBER = 448
const SCHEMA_VERSION = 1
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000
const SHA = /^[0-9a-f]{40}$/i
const SHA256 = /^[0-9a-f]{64}$/i
const AUTHORIZED_REPOSITORY = "bsvalues/terragroq"
const OWNER_COUNTERS = Object.freeze([
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
])

export const AC_CATALOG = Object.freeze([
  ac("AC-01", "Happy path", "LIVE", ["hermes-bridge-orchestrator.test.ts", "hermes-bridge-state-store.test.ts"], ["successful-trace", "delivery-result", "lease-release", "github-pr"]),
  ac("AC-02", "Failure path", "EXECUTABLE_SCENARIO", ["hermes-bridge-orchestrator.test.ts", "runtime-execution-truth.test.ts"], ["failure-trace", "failure-eval", "recovery-result"]),
  ac("AC-03", "Restart", "EXECUTABLE_SCENARIO", ["hermes-bridge-orchestrator.test.ts", "hermes-bridge-state-store.test.ts", "hermes-bridge-supervisor.test.ts"], ["restart-trace", "idempotency-proof"]),
  ac("AC-04", "Claim contention", "EXECUTABLE_SCENARIO", ["hermes-bridge-state-store.test.ts"], ["contention-trace", "fencing-proof"]),
  ac("AC-05", "Stale lease recovery", "EXECUTABLE_SCENARIO", ["hermes-bridge-state-store.test.ts"], ["stale-lease-trace", "fencing-proof"]),
  ac("AC-06", "Authority denial/revocation", "EXECUTABLE_SCENARIO", ["hermes-bridge-policy.test.ts", "hermes-bridge-orchestrator.test.ts"], ["authority-denial-trace", "mutation-boundary-proof"]),
  ac("AC-07", "Boundary enforcement", "EXECUTABLE_SCENARIO", ["hermes-bridge-policy.test.ts", "hermes-bridge-orchestrator.test.ts"], ["boundary-denial-trace", "mutation-boundary-proof"]),
  ac("AC-08", "Cancellation/timeout", "EXECUTABLE_SCENARIO", ["hermes-app-server-client.test.ts", "hermes-bridge-orchestrator.test.ts"], ["cancellation-trace", "timeout-trace", "preserved-evidence"]),
  ac("AC-09", "Evidence integrity", "EXECUTABLE_SCENARIO", ["hermes-bridge-state-store.test.ts", "runtime-execution-truth.test.ts", "runtime-trace-panel.test.ts"], ["integrity-trace", "corruption-detection", "restart-trace"]),
  ac("AC-10", "Cleanup recovery", "EXECUTABLE_SCENARIO", ["hermes-bridge-state-store.test.ts", "hermes-bridge-orchestrator.test.ts"], ["cleanup-interruption-trace", "cleanup-result", "owned-resource-proof"]),
  ac("AC-11", "Product truth", "LIVE", ["runtime-execution-panel.test.ts", "runtime-trace-panel.test.ts", "runtime-evidence-panel.test.ts", "runtime-evidence-truth-consistency.test.ts", "v1-product-truth-capture.test.ts", "local-runtime-status-api.test.ts", "runtime-health-route-dynamic.test.ts"], ["product-truth-snapshot", "persisted-state-snapshot"]),
  ac("AC-12", "V1 inventory", "VERIFIED_STATIC", ["systems-status-surface.test.ts", "multi-agent-capability-registry.test.ts", "executable-capability-inventory.test.ts"], ["v1-inventory"]),
  ac("AC-13", "Live proof", "LIVE", ["local-runtime-status-api.test.ts", "runtime-health-route-dynamic.test.ts", "hermes-bridge-supervisor.test.ts"], ["application-health", "worker-runtime-health"]),
  ac("AC-14", "No relay", "LIVE", ["hermes-bridge-state-store.test.ts", "hermes-bridge-orchestrator.test.ts"], ["owner-counter-snapshot"]),
])

function ac(id, title, requiredProofClass, tests, liveArtifacts) {
  return Object.freeze({
    id,
    title,
    requiredProofClass,
    tests: Object.freeze(tests.map((name) => `tests/${name}`)),
    liveArtifacts: Object.freeze(liveArtifacts),
  })
}

function failure(code, detail) {
  return { ok: false, code, detail }
}

function success(detail = null) {
  return { ok: true, code: "PASS", detail }
}

function timestamp(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function isFresh(value, now, maxAgeMs) {
  const milliseconds = timestamp(value)
  return milliseconds !== null && milliseconds <= now && now - milliseconds <= maxAgeMs
}

function digestFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function exactStringArray(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === "string" && item.length > 0)
}

function exactZeroOwnerCounters(value) {
  return isRecord(value)
    && Object.keys(value).sort().join("|") === [...OWNER_COUNTERS].sort().join("|")
    && OWNER_COUNTERS.every((name) => value[name] === 0)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function scenarioEvidenceValid(requirement, evidence) {
  if (!isRecord(evidence)) return false
  if (requirement.id === "AC-01") {
    return typeof evidence.outcomeId === "string" && typeof evidence.workOrderRef === "string"
      && evidence.checkpointState === "COMPLETE" && evidence.leaseStatus === "RELEASED"
      && Number.isSafeInteger(evidence.prNumber) && SHA.test(evidence.mergeSha ?? "")
  }
  if (requirement.id === "AC-02") {
    return typeof evidence.injectedFailureId === "string" && typeof evidence.failureClass === "string"
      && Number.isSafeInteger(evidence.failureEventId) && typeof evidence.disposition === "string"
      && typeof evidence.recoveryState === "string"
  }
  if (requirement.id === "AC-03") {
    return typeof evidence.executionId === "string"
      && Number.isSafeInteger(evidence.preRestartSequence)
      && Number.isSafeInteger(evidence.postRestartSequence)
      && evidence.postRestartSequence > evidence.preRestartSequence
      && evidence.mutationCount === 1
  }
  if (requirement.id === "AC-04") {
    return typeof evidence.workOrderRef === "string" && exactStringArray(evidence.contenderIds)
      && evidence.contenderIds.length >= 2 && evidence.contenderIds.includes(evidence.winnerId)
      && evidence.activeWriterCount === 1
  }
  if (requirement.id === "AC-05") {
    return Number.isSafeInteger(evidence.priorFencingToken)
      && Number.isSafeInteger(evidence.nextFencingToken)
      && evidence.nextFencingToken > evidence.priorFencingToken
      && evidence.priorLeaseStatus === "ABANDONED" && evidence.currentWriterCount === 1
  }
  if (requirement.id === "AC-06") {
    return typeof evidence.workOrderRef === "string" && typeof evidence.blockedAction === "string"
      && evidence.decision === "DENY" && evidence.mutationCount === 0
  }
  if (requirement.id === "AC-07") {
    return typeof evidence.attemptedPath === "string" && typeof evidence.reservation === "string"
      && evidence.decision === "DENY" && evidence.mutationCount === 0
  }
  if (requirement.id === "AC-08") {
    return typeof evidence.executionId === "string"
      && ["CANCELLATION", "TIMEOUT"].includes(evidence.interruptionKind)
      && typeof evidence.terminalState === "string" && evidence.evidencePreserved === true
  }
  if (requirement.id === "AC-09") {
    return typeof evidence.executionId === "string" && SHA256.test(evidence.provenanceDigest ?? "")
      && evidence.corruptionDetected === true && evidence.restartVerified === true
  }
  if (requirement.id === "AC-10") {
    return exactStringArray(evidence.ownedResourceIds)
      && Array.isArray(evidence.foreignResourceIds)
      && exactStringArray(evidence.removedOwnedIds)
      && evidence.removedForeignCount === 0 && evidence.resumed === true
  }
  if (requirement.id === "AC-11") {
    const identity = {
      workOrderId: evidence.workOrderId,
      workOrderRef: evidence.workOrderRef,
      workOrderViewId: evidence.workOrderViewId,
      runtimeWorkOrderId: evidence.runtimeWorkOrderId,
      traceWorkOrderId: evidence.traceWorkOrderId,
      runtimeExecutionId: evidence.runtimeExecutionId,
      checkpointEventIds: evidence.checkpointEventIds,
      leaseEventIds: evidence.leaseEventIds,
      failureEvalEventIds: evidence.failureEvalEventIds,
      evalEventIds: evidence.evalEventIds,
      evidenceRecordIds: evidence.evidenceRecordIds,
      evidenceWorkOrderIds: evidence.evidenceWorkOrderIds,
      traceEventIds: evidence.traceEventIds,
    }
    const runtimeEventIds = [
      ...(evidence.checkpointEventIds ?? []),
      ...(evidence.leaseEventIds ?? []),
      ...(evidence.failureEvalEventIds ?? []),
    ].sort((left, right) => Number(left) - Number(right))
    return Number.isSafeInteger(evidence.workOrderId) && typeof evidence.workOrderRef === "string"
      && evidence.workOrderViewId === evidence.workOrderId
      && evidence.runtimeWorkOrderId === evidence.workOrderId
      && evidence.traceWorkOrderId === evidence.workOrderId
      && evidence.runtimeExecutionId === `work-order:${evidence.workOrderId}`
      && typeof evidence.runtimeExecutionId === "string"
      && exactStringArray(evidence.checkpointEventIds)
      && exactStringArray(evidence.leaseEventIds)
      && Array.isArray(evidence.failureEvalEventIds)
      && Array.isArray(evidence.evidenceRecordIds)
      && Array.isArray(evidence.evidenceWorkOrderIds)
      && evidence.evidenceWorkOrderIds.every((id) => id === evidence.workOrderId)
      && Array.isArray(evidence.evalEventIds)
      && JSON.stringify(evidence.evalEventIds) === JSON.stringify(evidence.failureEvalEventIds)
      && exactStringArray(evidence.traceEventIds)
      && JSON.stringify(runtimeEventIds) === JSON.stringify(evidence.traceEventIds)
      && evidence.querySource === "PERSISTED_DATABASE"
      && evidence.capturedBy === "scripts/hermes-bridge/v1-product-truth-capture.mjs"
      && evidence.consistencyDigest === canonicalDigest(identity) && evidence.consistent === true
  }
  if (requirement.id === "AC-12") {
    return exactStringArray(evidence.capabilityIds)
      && new Set(evidence.capabilityIds).size === evidence.capabilityIds.length
      && SHA256.test(evidence.inventoryDigest ?? "")
      && exactStringArray(evidence.classifications)
      && ["EXCLUDED", "RUNTIME_PROVEN", "STATIC_READ_ONLY"]
        .every((classification) => evidence.classifications.includes(classification))
  }
  if (requirement.id === "AC-13") {
    return evidence.applicationStatus === "ok" && Number.isSafeInteger(evidence.workerProcessId)
      && evidence.workerProcessId > 0 && typeof evidence.workerNonce === "string"
      && evidence.workerNonce.length > 0 && path.isAbsolute(evidence.workerWorkspace ?? "")
  }
  if (requirement.id === "AC-14") {
    return typeof evidence.campaignId === "string" && evidence.campaignId.length > 0
      && exactZeroOwnerCounters(evidence.ownerTouchCounters)
  }
  return false
}

export function validateProofArtifact(
  document,
  requirement,
  artifact,
  {
    currentRevision,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    expectedInventoryIds = [],
  } = {},
) {
  const proofObservedAt = timestamp(document?.observedAt)
  const proofIsCurrent = requirement.requiredProofClass === "VERIFIED_STATIC"
    ? proofObservedAt !== null && proofObservedAt <= now
    : isFresh(document?.observedAt, now, maxAgeMs)
  if (!isRecord(document) || document.schemaVersion !== SCHEMA_VERSION
    || document.issueNumber !== ISSUE_NUMBER || document.acceptanceCriterion !== requirement.id
    || document.kind !== artifact.kind || document.proofClass !== requirement.requiredProofClass
    || document.status !== "PASS" || document.sourceRevision !== currentRevision
    || !proofIsCurrent
    || document.observedAt !== artifact.recordedAt
    || !scenarioEvidenceValid(requirement, document.evidence)) {
    return failure("PROOF_ARTIFACT_CONTRACT_INVALID", `${requirement.id}:${artifact.kind}`)
  }
  if (requirement.requiredProofClass === "EXECUTABLE_SCENARIO") {
    const run = document.execution
    if (!isRecord(run) || run.command !== "vitest"
      || !Array.isArray(run.tests)
      || JSON.stringify([...run.tests].sort()) !== JSON.stringify([...requirement.tests].sort())
      || run.exitCode !== 0 || !exactStringArray(run.assertions)
      || typeof run.runId !== "string" || run.runId.length === 0
      || !timestamp(run.startedAt) || !timestamp(run.finishedAt)
      || timestamp(run.finishedAt) < timestamp(run.startedAt)
      || !isFresh(run.finishedAt, now, maxAgeMs)) {
      return failure("EXECUTABLE_SCENARIO_PROOF_INVALID", requirement.id)
    }
  }
  if (requirement.id === "AC-12") {
    const actualIds = [...document.evidence.capabilityIds].sort()
    if (JSON.stringify(actualIds) !== JSON.stringify([...expectedInventoryIds].sort())) {
      return failure("STATIC_INVENTORY_ARTIFACT_INCOMPLETE", requirement.id)
    }
  }
  return success()
}

export function readExpectedInventory(repoRoot) {
  const inventoryPath = path.join(repoRoot, "docs", "governance", "executable-capability-inventory.md")
  const entries = fs.readFileSync(inventoryPath, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(
        /^\| `([^`]+)` \| [^|]+? \| `[^`]+` \| `[^`]+` \| `[^`]+` \| `([^`]+)` \| .+ \|$/,
      )
      return match ? [{ capability: match[1], classification: match[2] }] : []
    })
  if (entries.length === 0 || new Set(entries.map((entry) => entry.capability)).size !== entries.length) {
    throw new Error("CANONICAL_INVENTORY_INVALID")
  }
  return entries
}

function safeJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, "utf8")) }
  } catch {
    return failure("JSON_READ_FAILED", filePath)
  }
}

export function parseArgs(argv, env = process.env) {
  const runtimeRoot = env.WILLIAMOS_HERMES_RUNTIME_ROOT
    ?? path.join(os.homedir(), ".williamos", "hermes-bridge")
  const options = {
    repo: "bsvalues/terragroq",
    issue: ISSUE_NUMBER,
    state: path.join(runtimeRoot, "state", "state.json"),
    supervisorState: path.join(runtimeRoot, "state", "supervisor.json"),
    evidence: path.join(runtimeRoot, "evidence", "v1-acceptance.json"),
    appUrl: env.WILLIAMOS_APP_URL ?? null,
    workspace: env.WILLIAMOS_HERMES_WORKSPACE ? path.resolve(env.WILLIAMOS_HERMES_WORKSPACE) : null,
    output: null,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
  }
  const valued = new Set([
    "--repo", "--issue", "--state", "--supervisor-state", "--evidence",
    "--app-url", "--workspace", "--output", "--max-age-ms",
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!valued.has(flag)) throw new Error(`UNKNOWN_ARGUMENT:${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`ARGUMENT_VALUE_REQUIRED:${flag}`)
    index += 1
    if (flag === "--repo") options.repo = value
    else if (flag === "--issue") options.issue = Number(value)
    else if (flag === "--state") options.state = path.resolve(value)
    else if (flag === "--supervisor-state") options.supervisorState = path.resolve(value)
    else if (flag === "--evidence") options.evidence = path.resolve(value)
    else if (flag === "--app-url") options.appUrl = value.replace(/\/+$/, "")
    else if (flag === "--workspace") options.workspace = path.resolve(value)
    else if (flag === "--output") options.output = path.resolve(value)
    else if (flag === "--max-age-ms") options.maxAgeMs = Number(value)
  }
  if (options.issue !== ISSUE_NUMBER) throw new Error("ISSUE_448_REQUIRED")
  if (options.repo !== AUTHORIZED_REPOSITORY) throw new Error("AUTHORIZED_REPOSITORY_REQUIRED")
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 1) {
    throw new Error("INVALID_MAX_AGE_MS")
  }
  return options
}

export function validateHostState(state, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const rootKeys = [
    "executions", "idempotency", "killSwitch", "nextFencingToken",
    "ownerTouchCounters", "revision", "schemaVersion", "storeId", "updatedAt",
  ]
  if (!state || state.schemaVersion !== 1 || state.storeId !== "hermes-bridge"
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(state.nextFencingToken) || state.nextFencingToken < 1
    || !state.executions || typeof state.executions !== "object" || Array.isArray(state.executions)
    || !state.idempotency || typeof state.idempotency !== "object" || Array.isArray(state.idempotency)
    || !state.ownerTouchCounters || typeof state.ownerTouchCounters !== "object"
    || JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(rootKeys)) {
    return failure("HOST_STATE_SCHEMA_INVALID", "Expected Hermes state schemaVersion 1.")
  }
  if (!state.killSwitch || typeof state.killSwitch.active !== "boolean"
    || ![null, "string"].includes(state.killSwitch.reason === null ? null : typeof state.killSwitch.reason)
    || (state.killSwitch.updatedAt !== null && !timestamp(state.killSwitch.updatedAt))) {
    return failure("HOST_KILL_SWITCH_SCHEMA_INVALID", "killSwitch does not match the state-store contract.")
  }
  if (!isFresh(state.updatedAt, now, maxAgeMs)) {
    return failure("HOST_STATE_STALE", "Host state updatedAt is missing, future-dated, or stale.")
  }
  const counterKeys = Object.keys(state.ownerTouchCounters).sort()
  if (JSON.stringify(counterKeys) !== JSON.stringify([...OWNER_COUNTERS].sort())) {
    return failure("OWNER_COUNTER_SCHEMA_INVALID", "Owner counter keys do not match the V1 contract.")
  }
  const nonzero = OWNER_COUNTERS.filter((name) => state.ownerTouchCounters[name] !== 0)
  if (nonzero.length > 0) {
    return failure("FAIL_OWNER_BABYSITTING", `Nonzero or invalid counters: ${nonzero.join(", ")}`)
  }

  const fencingTokens = new Set()
  const leases = []
  for (const [outcomeId, execution] of Object.entries(state.executions)) {
    if (!execution || execution.outcomeId !== outcomeId
      || !Number.isSafeInteger(execution.fencingToken) || execution.fencingToken < 1
      || fencingTokens.has(execution.fencingToken)
      || !execution.lease || !["ACTIVE", "RELEASED", "ABANDONED", "DEFERRED"].includes(execution.lease.status)
      || !execution.checkpoint || !Number.isSafeInteger(execution.checkpoint.sequence)
      || execution.checkpoint.sequence < 0 || typeof execution.checkpoint.state !== "string"
      || !timestamp(execution.checkpoint.recordedAt)
      || (execution.checkpoint.detail !== null && typeof execution.checkpoint.detail !== "string")
      || !execution.metadata || typeof execution.metadata !== "object" || Array.isArray(execution.metadata)
      || typeof execution.lease.holderId !== "string" || !execution.lease.holderId
      || !timestamp(execution.lease.acquiredAt) || !timestamp(execution.lease.expiresAt)) {
      return failure("LEASE_OR_CHECKPOINT_SCHEMA_INVALID", outcomeId)
    }
    fencingTokens.add(execution.fencingToken)
    if (execution.lease.status === "ACTIVE") {
      if (timestamp(execution.lease.expiresAt) <= now) {
        return failure("ACTIVE_LEASE_INVALID_OR_STALE", outcomeId)
      }
    }
    if (execution.lease.status === "RELEASED" && !timestamp(execution.lease.releasedAt)) {
      return failure("RELEASED_LEASE_SCHEMA_INVALID", outcomeId)
    }
    if (execution.lease.status === "ABANDONED"
      && !timestamp(execution.lease.abandonedAt ?? execution.lease.recoveredAt)) {
      return failure("ABANDONED_LEASE_SCHEMA_INVALID", outcomeId)
    }
    if (execution.lease.status === "DEFERRED"
      && (!timestamp(execution.lease.deferredAt) || execution.lease.deferReason !== "PROVIDER_UNAVAILABLE")) {
      return failure("DEFERRED_LEASE_SCHEMA_INVALID", outcomeId)
    }
    if (["COMPLETE", "FAILED_TERMINAL"].includes(execution.checkpoint.state)
      && execution.lease.status !== "RELEASED") {
      return failure("TERMINAL_LEASE_NOT_RELEASED", outcomeId)
    }
    leases.push({
      outcomeId,
      fencingToken: execution.fencingToken,
      status: execution.lease.status,
      checkpointSequence: execution.checkpoint.sequence,
      checkpointState: execution.checkpoint.state,
    })
  }
  if ([...fencingTokens].some((token) => token >= state.nextFencingToken)) {
    return failure("FENCING_SEQUENCE_INVALID", "nextFencingToken must exceed all issued tokens.")
  }
  return success({ revision: state.revision, ownerTouchCounters: state.ownerTouchCounters, leases })
}

export function validateSupervisorState(
  state,
  {
    now = Date.now(),
    expectedWorkspace,
    expectedSupervisorPath,
    processProbe = defaultProcessProbe,
  } = {},
) {
  const startedAt = timestamp(state?.startedAt)
  if (!state || state.schemaVersion !== 1 || state.hostMode !== "INTERACTIVE_USER_RESIDENT"
    || !Number.isSafeInteger(state.processId) || state.processId < 1
    || typeof state.nonce !== "string" || !state.nonce
    || !path.isAbsolute(state.workspace) || !path.isAbsolute(state.supervisorPath)
    || startedAt === null || startedAt > now) {
    return failure("SUPERVISOR_STATE_SCHEMA_INVALID", "Resident supervisor record is invalid.")
  }
  if (!expectedWorkspace || !expectedSupervisorPath
    || !samePath(state.workspace, expectedWorkspace)
    || !samePath(state.supervisorPath, expectedSupervisorPath)) {
    return failure("SUPERVISOR_POSTURE_MISMATCH", "Workspace or supervisor script path does not match.")
  }
  if (!processProbe(state)) {
    return failure("SUPERVISOR_PROCESS_NOT_LIVE", `PID ${state.processId} is not live.`)
  }
  return success({
    processId: state.processId,
    hostMode: state.hostMode,
    startedAt: state.startedAt,
  })
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "")
  return process.platform === "win32"
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right)
}

export function defaultProcessProbe(state) {
  try {
    process.kill(state.processId, 0)
  } catch {
    return false
  }
  if (process.platform !== "win32") return true
  const escapedPid = String(state.processId)
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${escapedPid}"`,
    "if ($null -eq $p) { exit 2 }",
    "$p | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ].join("; ")
  const probe = run("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script])
  if (!probe.ok) return false
  try {
    const processRecord = JSON.parse(probe.stdout)
    const commandLine = String(processRecord.CommandLine ?? "").toLowerCase()
    const executable = path.basename(String(processRecord.ExecutablePath ?? "")).toLowerCase()
    const processStartedAt = timestamp(processRecord.CreationDate)
    const recordedStartedAt = timestamp(state.startedAt)
    return processRecord.ProcessId === state.processId
      && ["powershell.exe", "pwsh.exe"].includes(executable)
      && processStartedAt !== null && recordedStartedAt !== null
      && Math.abs(processStartedAt - recordedStartedAt) <= 2_000
      && commandLine.includes(state.supervisorPath.toLowerCase())
      && commandLine.includes(state.workspace.toLowerCase())
  } catch {
    return false
  }
}

export function validateEvidenceManifest(
  manifest,
  {
    manifestPath,
    currentRevision,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    exists = fs.existsSync,
    hash = digestFile,
    stat = fs.statSync,
    lstat = fs.lstatSync,
    realpath = fs.realpathSync,
    readJson = safeJson,
    expectedInventory = [],
  },
) {
  if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION || manifest.issueNumber !== ISSUE_NUMBER
    || !isFresh(manifest.observedAt, now, maxAgeMs) || !manifest.scenarios
    || typeof manifest.scenarios !== "object" || !SHA.test(currentRevision ?? "")) {
    return failure("ACCEPTANCE_MANIFEST_SCHEMA_OR_FRESHNESS_INVALID", manifestPath)
  }
  const base = path.dirname(manifestPath)
  const validated = {}
  for (const requirement of AC_CATALOG) {
    const scenario = manifest.scenarios[requirement.id]
    const requiresFreshEventEvidence = requirement.requiredProofClass !== "VERIFIED_STATIC"
    if (!scenario || scenario.proofClass !== requirement.requiredProofClass
      || (requiresFreshEventEvidence
        ? !isFresh(scenario.observedAt, now, maxAgeMs)
        : timestamp(scenario.observedAt) === null || timestamp(scenario.observedAt) > now)
      || (requirement.requiredProofClass === "VERIFIED_STATIC" && scenario.revision !== currentRevision)
      || !Array.isArray(scenario.artifacts)) {
      return failure("SCENARIO_PROOF_CLASS_OR_FRESHNESS_INVALID", requirement.id)
    }
    const kinds = new Set()
    for (const artifact of scenario.artifacts) {
      if (!artifact || typeof artifact.kind !== "string" || typeof artifact.path !== "string"
        || !SHA256.test(artifact.sha256 ?? "")
        || (requiresFreshEventEvidence
          ? !isFresh(artifact.recordedAt, now, maxAgeMs)
          : timestamp(artifact.recordedAt) === null || timestamp(artifact.recordedAt) > now)) {
        return failure("LIVE_ARTIFACT_SCHEMA_OR_FRESHNESS_INVALID", requirement.id)
      }
      const artifactPath = path.resolve(base, artifact.path)
      if (!isPathInside(base, artifactPath)) {
        return failure("LIVE_ARTIFACT_PATH_OUTSIDE_EVIDENCE_ROOT", `${requirement.id}:${artifact.kind}`)
      }
      const artifactLinkStat = exists(artifactPath) ? lstat(artifactPath) : null
      const resolvedArtifactPath = artifactLinkStat ? realpath(artifactPath) : null
      if (!artifactLinkStat?.isFile() || artifactLinkStat.isSymbolicLink()
        || !isPathInside(base, resolvedArtifactPath)
        || hash(resolvedArtifactPath) !== artifact.sha256) {
        return failure("LIVE_ARTIFACT_MISSING_OR_DIGEST_MISMATCH", `${requirement.id}:${artifact.kind}`)
      }
      const artifactStat = stat(resolvedArtifactPath)
      if (requiresFreshEventEvidence
        && (artifactStat.mtimeMs > now || now - artifactStat.mtimeMs > maxAgeMs)) {
        return failure("LIVE_ARTIFACT_FILE_STALE", `${requirement.id}:${artifact.kind}`)
      }
      const artifactDocument = readJson(resolvedArtifactPath)
      if (!artifactDocument.ok) {
        return failure("PROOF_ARTIFACT_JSON_INVALID", `${requirement.id}:${artifact.kind}`)
      }
      const artifactContract = validateProofArtifact(
        artifactDocument.value,
        requirement,
        artifact,
        {
          currentRevision,
          now,
          maxAgeMs,
          expectedInventoryIds: expectedInventory.map((entry) => entry.capability),
        },
      )
      if (!artifactContract.ok) return artifactContract
      kinds.add(artifact.kind)
    }
    const missing = requirement.liveArtifacts.filter((kind) => !kinds.has(kind))
    if (missing.length > 0) {
      return failure("REQUIRED_LIVE_ARTIFACT_KIND_MISSING", `${requirement.id}:${missing.join(",")}`)
    }
    validated[requirement.id] = [...kinds].sort()
  }
  if (!Array.isArray(manifest.inventory) || manifest.inventory.length === 0
    || manifest.inventory.some((item) => !item || typeof item.capability !== "string"
      || !["RUNTIME_PROVEN", "STATIC_READ_ONLY", "EXCLUDED"].includes(item.classification)
      || item.revision !== currentRevision
      || !Array.isArray(item.evidence) || item.evidence.length === 0)) {
    return failure("V1_INVENTORY_INVALID", "Every capability needs a classification and evidence.")
  }
  const expectedInventoryMap = new Map(
    expectedInventory.map((entry) => [entry.capability, entry.classification]),
  )
  const manifestInventoryMap = new Map(
    manifest.inventory.map((entry) => [entry.capability, entry.classification]),
  )
  if (expectedInventory.length === 0
    || manifestInventoryMap.size !== manifest.inventory.length
    || manifestInventoryMap.size !== expectedInventoryMap.size
    || [...expectedInventoryMap].some(([capability, classification]) => (
      manifestInventoryMap.get(capability) !== classification
    ))) {
    return failure("V1_INVENTORY_PARITY_INVALID", "Manifest inventory must exactly match the canonical inventory.")
  }
  if (!Array.isArray(manifest.githubPullRequests) || manifest.githubPullRequests.length === 0) {
    return failure("GITHUB_EVIDENCE_MISSING", "At least one delivery PR is required.")
  }
  if (manifest.githubPullRequests.some((entry) => entry?.repo !== AUTHORIZED_REPOSITORY)) {
    return failure("GITHUB_REPOSITORY_SCOPE_INVALID", AUTHORIZED_REPOSITORY)
  }
  return success({
    scenarios: validated,
    inventoryCount: manifest.inventory.length,
    githubPullRequests: manifest.githubPullRequests,
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
    shell: false,
  })
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    code: result.error?.code ?? null,
  }
}

function runUnitTests(repoRoot, runner = run) {
  const files = [...new Set(AC_CATALOG.flatMap((entry) => entry.tests))]
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs")
  const results = {}
  if (!fs.existsSync(vitest)) {
    return Object.fromEntries(files.map((file) => [
      file,
      failure("VITEST_RUNTIME_MISSING", vitest),
    ]))
  }
  for (const file of files) {
    if (!fs.existsSync(path.join(repoRoot, file))) {
      results[file] = failure("TEST_FILE_MISSING", file)
      continue
    }
    const result = runner(process.execPath, [vitest, "run", file], { cwd: repoRoot })
    results[file] = result.ok
      ? success({
        proofClass: "UNIT_SIMULATED",
        command: `${process.execPath} ${vitest} run ${file}`,
      })
      : failure("UNIT_TEST_FAILED", `${file}:exit=${result.status ?? result.code ?? "unknown"}`)
  }
  return results
}

async function probeJson(url, { fetchImpl = fetch, now, maxAgeMs, timestampField }) {
  if (!url) return failure("APP_URL_REQUIRED", "Set --app-url or WILLIAMOS_APP_URL.")
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
    const body = await response.json()
    if (!response.ok) return failure("APP_ENDPOINT_UNHEALTHY", `${url}:HTTP_${response.status}`)
    if (timestampField && !isFresh(body[timestampField], now, maxAgeMs)) {
      return failure("APP_ENDPOINT_EVIDENCE_STALE", url)
    }
    return success({ url, status: response.status, body })
  } catch (error) {
    return failure("APP_ENDPOINT_PROBE_FAILED", `${url}:${error?.name ?? "ERROR"}`)
  }
}

function verifyGitHub(manifestResult, options, runner = run) {
  const issue = runner("gh", [
    "issue", "view", String(ISSUE_NUMBER), "--repo", options.repo,
    "--json", "number,state,url,updatedAt",
  ])
  if (!issue.ok) return failure("GITHUB_ISSUE_PROBE_FAILED", `issue=${ISSUE_NUMBER}`)
  let issueData
  try {
    issueData = JSON.parse(issue.stdout)
  } catch {
    return failure("GITHUB_ISSUE_RESPONSE_INVALID", `issue=${ISSUE_NUMBER}`)
  }
  if (issueData.number !== ISSUE_NUMBER || !["OPEN", "CLOSED"].includes(issueData.state)) {
    return failure("GITHUB_ISSUE_EVIDENCE_INVALID", `issue=${ISSUE_NUMBER}`)
  }

  const pullRequests = []
  for (const expected of manifestResult.detail.githubPullRequests) {
    if (!expected || typeof expected.repo !== "string" || !Number.isSafeInteger(expected.number)
      || expected.repo !== options.repo
      || !SHA.test(expected.headSha ?? "") || !SHA.test(expected.mergeSha ?? "")) {
      return failure("GITHUB_PR_EXPECTATION_INVALID", "Manifest PR evidence is malformed.")
    }
    const result = runner("gh", [
      "pr", "view", String(expected.number), "--repo", expected.repo,
      "--json", "number,state,url,headRefOid,mergeCommit",
    ])
    if (!result.ok) return failure("GITHUB_PR_PROBE_FAILED", `${expected.repo}#${expected.number}`)
    let actual
    try {
      actual = JSON.parse(result.stdout)
    } catch {
      return failure("GITHUB_PR_RESPONSE_INVALID", `${expected.repo}#${expected.number}`)
    }
    if (actual.state !== "MERGED" || actual.headRefOid !== expected.headSha
      || actual.mergeCommit?.oid !== expected.mergeSha) {
      return failure("GITHUB_PR_EXACT_HEAD_MISMATCH", `${expected.repo}#${expected.number}`)
    }
    pullRequests.push({ repo: expected.repo, number: expected.number, url: actual.url })
  }
  return success({ issue: issueData, pullRequests })
}

export function evaluateAcceptance({
  unitResults,
  manifestResult,
  hostResult,
  supervisorResult,
  healthResult,
  runtimeStatusResult,
  githubResult,
}) {
  const results = AC_CATALOG.map((requirement) => {
    const checks = requirement.tests.map((file) => ({
      name: file,
      proofClass: "UNIT_SIMULATED",
      ...(unitResults[file] ?? failure("UNIT_TEST_NOT_RUN", file)),
    }))
    checks.push({
      name: "required-scenario-artifacts",
      proofClass: requirement.requiredProofClass,
      ...(manifestResult.ok && manifestResult.detail.scenarios[requirement.id]
        ? success({ kinds: manifestResult.detail.scenarios[requirement.id] })
        : failure(manifestResult.code, manifestResult.detail)),
    })
    if (["AC-01", "AC-11", "AC-14"].includes(requirement.id)) {
      checks.push({ name: "host-state", proofClass: "LIVE", ...hostResult })
    }
    if (requirement.id === "AC-01") {
      checks.push({ name: "github-delivery", proofClass: "LIVE", ...githubResult })
    }
    if (requirement.id === "AC-11") {
      checks.push({ name: "runtime-status-endpoint", proofClass: "LIVE", ...runtimeStatusResult })
    }
    if (requirement.id === "AC-13") {
      checks.push({ name: "application-health", proofClass: "LIVE", ...healthResult })
      checks.push({ name: "runtime-status-endpoint", proofClass: "LIVE", ...runtimeStatusResult })
      checks.push({ name: "resident-supervisor", proofClass: "LIVE", ...supervisorResult })
    }
    if (requirement.id === "AC-14") {
      checks.push({
        name: "owner-touch-counters",
        proofClass: "LIVE",
        ...(hostResult.ok ? success(hostResult.detail.ownerTouchCounters) : hostResult),
      })
    }
    return {
      id: requirement.id,
      title: requirement.title,
      status: checks.every((check) => check.ok) ? "PASS" : "FAIL",
      checks,
    }
  })
  return {
    status: results.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
    result: results.every((result) => result.status === "PASS")
      ? "WILLIAMOS_V1_RUNTIME_COMPLETE"
      : "WILLIAMOS_V1_RUNTIME_NOT_PROVEN",
    acceptanceCriteria: results,
  }
}

export async function runCampaign(options, dependencies = {}) {
  const now = dependencies.now?.() ?? Date.now()
  const repoRoot = dependencies.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
  const runner = dependencies.runner ?? run
  const unitResults = dependencies.unitResults ?? runUnitTests(repoRoot, runner)
  const expectedInventory = dependencies.expectedInventory ?? readExpectedInventory(repoRoot)
  const revisionProbe = runner("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  const currentRevision = revisionProbe.ok ? revisionProbe.stdout.trim() : null

  const manifestRead = safeJson(options.evidence)
  const manifestResult = manifestRead.ok
    ? validateEvidenceManifest(manifestRead.value, {
      manifestPath: options.evidence,
      currentRevision,
      now,
      maxAgeMs: options.maxAgeMs,
      expectedInventory,
    })
    : manifestRead
  const hostRead = safeJson(options.state)
  const hostResult = hostRead.ok
    ? validateHostState(hostRead.value, { now, maxAgeMs: options.maxAgeMs })
    : hostRead
  const supervisorRead = safeJson(options.supervisorState)
  const supervisorResult = supervisorRead.ok
    ? validateSupervisorState(supervisorRead.value, {
      now,
      expectedWorkspace: options.workspace,
      expectedSupervisorPath: options.workspace
        ? path.join(options.workspace, "scripts", "hermes-bridge", "supervisor.ps1")
        : null,
      processProbe: dependencies.processProbe,
    })
    : supervisorRead
  const healthResult = await probeJson(
    options.appUrl ? `${options.appUrl}/api/health` : null,
    { fetchImpl: dependencies.fetchImpl, now, maxAgeMs: options.maxAgeMs, timestampField: "timestamp" },
  )
  if (healthResult.ok && healthResult.detail.body.status !== "ok") {
    Object.assign(healthResult, failure("APP_HEALTH_STATUS_NOT_OK", healthResult.detail.url))
  }
  const runtimeStatusResult = await probeJson(
    options.appUrl ? `${options.appUrl}/api/local/runtime/status` : null,
    { fetchImpl: dependencies.fetchImpl, now, maxAgeMs: options.maxAgeMs, timestampField: "checkedAt" },
  )
  if (runtimeStatusResult.ok && (
    runtimeStatusResult.detail.body.ok !== true
    || runtimeStatusResult.detail.body.checks?.statusRoute?.state !== "ready"
  )) {
    Object.assign(runtimeStatusResult, failure("RUNTIME_STATUS_ROUTE_NOT_READY", runtimeStatusResult.detail.url))
  }
  const githubResult = manifestResult.ok
    ? verifyGitHub(manifestResult, options, runner)
    : failure("GITHUB_EVIDENCE_BLOCKED_BY_MANIFEST", manifestResult.code)

  const evaluated = evaluateAcceptance({
    unitResults,
    manifestResult,
    hostResult,
    supervisorResult,
    healthResult,
    runtimeStatusResult,
    githubResult,
  })
  return {
    schemaVersion: SCHEMA_VERSION,
    campaign: "ISSUE-448-AC-01-AC-14",
    issueNumber: ISSUE_NUMBER,
    proofPolicy: "UNIT_SIMULATED_NEVER_SUBSTITUTES_FOR_LIVE",
    observedAt: new Date(now).toISOString(),
    ...evaluated,
  }
}

function writeResult(filePath, result) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
    return
  }
  const result = await runCampaign(options)
  if (options.output) writeResult(options.output, result)
  process.stdout.write(`${result.status} ${result.result} ${result.acceptanceCriteria.filter((acResult) => acResult.status === "PASS").length}/14\n`)
  process.exitCode = result.status === "PASS" ? 0 : 1
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main()
}
