import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { sanitizeAppServerText } from "./app-server-client.mjs"
import { selectExecutionBackend } from "./execution-backend.mjs"
import {
  completeOutcome,
  deferProviderOutcome,
  readApprovedOwnerDecision,
  projectOutcomeRuntimeCheckpoint,
  projectOutcomeRuntimeLease,
  readValidationInfrastructureRecovery,
  resolveValidationInfrastructureRecovery,
  selectNextOutcome,
  terminalizeOutcome,
  VALIDATION_INFRASTRUCTURE_RETRY_STATE,
} from "./outcome-source.mjs"
import { evaluateOutcomePolicy } from "./policy.mjs"
import { buildHermesCodexPrompt, HERMES_BLOCKED_SCOPE, HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"
import { createRepositoryLifecycle } from "./repository-lifecycle.mjs"
import {
  HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST,
  HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID,
  resolveHermesWorkContract,
} from "./work-contract.mjs"
import {
  createHermesStateStore,
  hermesTurnResultDigest,
  normalizeHermesTurnResult,
} from "./state-store.mjs"

const LEASE_DURATION_MS = 50 * 60 * 1000
const TURN_TIMEOUT_MS = 45 * 60 * 1000
const MAX_PROVIDER_REDISPATCHES = 3
const PROVIDER_RETRY_COOLDOWN_MS = 15 * 60 * 1000
const MAX_REMEDIATION_ROUNDS = 3
const REVIEW_POLL_INTERVAL_MS = 15_000
const REVIEW_POLL_ATTEMPTS = 80
const SHA = /^[0-9a-f]{40}$/
const PROJECTION_RETRY_DELAYS_MS = Object.freeze([1_000, 4_000])
const MAX_CHECKPOINT_DETAIL_CHARS = 1_000
const RETRYABLE_PROJECTION_TRANSPORT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
])
const RETRYABLE_PROJECTION_TRANSPORT_MESSAGES = new Set([
  "Connection terminated due to connection timeout",
])
const OWNER_DECISION_RESUME_STATES = new Set([
  "OWNER_DECISION_ACCEPTED",
  "OWNER_DECISION_THREAD_RECOVERY_WALL",
])
const RECOVERABLE_DELIVERY_WALLS = new Set([
  "HERMES_REPOSITORY_COMMAND_FAILED",
  "HERMES_REPOSITORY_GITHUB_WALL",
  "HERMES_REPOSITORY_RUNNER_WALL",
  "HERMES_REVIEW_CONTINUITY_WALL",
])

export function isRetryableProjectionTransportError(error) {
  if (!error || typeof error !== "object") return false
  if (Array.isArray(error.errors)) {
    return error.errors.length > 0
      && error.errors.every(isRetryableProjectionTransportError)
  }
  if (typeof error.code === "string") {
    return RETRYABLE_PROJECTION_TRANSPORT_CODES.has(error.code)
  }
  if (typeof error.message === "string"
    && RETRYABLE_PROJECTION_TRANSPORT_MESSAGES.has(error.message)) return true
  return error.cause ? isRetryableProjectionTransportError(error.cause) : false
}

export async function retryRuntimeProjection(operation, {
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  delays = PROJECTION_RETRY_DELAYS_MS,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= delays.length || !isRetryableProjectionTransportError(error)) throw error
      await sleep(delays[attempt])
    }
  }
}

export const DEFAULT_VALIDATION_COMMANDS = Object.freeze([
  Object.freeze({ command: "npm", args: Object.freeze(["run", "lint"]), timeoutMs: 10 * 60 * 1000 }),
  Object.freeze({ command: "npm", args: Object.freeze(["test", "--", "--run"]), timeoutMs: 15 * 60 * 1000 }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "build"]),
    env: Object.freeze({ NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1" }),
    timeoutMs: 15 * 60 * 1000,
  }),
])

const FORBIDDEN_CHANGED_PATH = /^(?:\.obsidian\/|scripts\/runtime-operator\/|scripts\/local\/williamos-codex-exec\.ps1$|lib\/auth|app\/api\/auth|lib\/db\/schema\.ts$|drizzle\/)/i

function readControl(pathname, fallback = "") {
  try { return fs.readFileSync(pathname, "utf8").trim() } catch { return fallback }
}

function outcomeRef(outcome) {
  return outcome.ref?.trim() || `GOAL-${outcome.id}`
}

function safeLeaf(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
}

function parseTurnResult(text) {
  const trimmed = String(text ?? "").trim()
  if (!trimmed) throw Object.assign(new Error("App Server returned no terminal result"), { code: "HERMES_EMPTY_RESULT_WALL" })
  try { return JSON.parse(trimmed) } catch {
    const first = trimmed.indexOf("{")
    const last = trimmed.lastIndexOf("}")
    if (first >= 0 && last > first) {
      try { return JSON.parse(trimmed.slice(first, last + 1)) } catch {}
    }
    throw Object.assign(new Error("App Server terminal result was not valid JSON"), { code: "HERMES_RESULT_FORMAT_WALL" })
  }
}

function validatedTurnResult(text) {
  const result = normalizeHermesTurnResult(parseTurnResult(text))
  if (result.ownerTouchCount !== 0
    || result.blockedScopeCrossed) {
    throw Object.assign(new Error("Codex result crossed the owner or blocked-scope boundary"), {
      code: "HERMES_COMPLETION_GATE_WALL",
    })
  }
  return result
}

function consumedTurnResultMetadata() {
  return { turnResult: null, turnResultDigest: null }
}

function pullRequestNumber(value) {
  if (Number.isSafeInteger(value?.number) && value.number > 0) return value.number
  try {
    const url = new URL(value?.url)
    const match = url.origin === "https://github.com"
      ? url.pathname.match(/^\/bsvalues\/terragroq\/pull\/(\d+)\/?$/) : null
    const number = Number(match?.[1])
    if (Number.isSafeInteger(number) && number > 0) return number
  } catch {}
  throw Object.assign(new Error("Valid PR URL required"), { code: "HERMES_PR_WALL" })
}

function remediationContext({ outcome, reservations }) {
  return `Owner outcome:\n${outcome}\n\nReserved paths:\n${reservations.map((item) => `- ${item}`).join("\n")}\n\nBlocked throughout:\n${HERMES_BLOCKED_SCOPE.map((item) => `- ${item}`).join("\n")}`
}

function buildRemediationPrompt({ workOrderId, branch, outcome, reservations, findings }) {
  return `Continue ${workOrderId} on ${branch}.

${remediationContext({ outcome, reservations })}

Hermes completed native validation, commit, push, PR creation, and review monitoring. Independent review produced these actionable findings:
${findings.map((finding, index) => `${index + 1}. ${finding.path}${finding.line ? `:${finding.line}` : ""} - ${finding.body}`).join("\n")}

Remediate every valid finding using only repository file reads and edits inside the existing reserved paths. Read-only shell inspection is limited to rg, Get-Content, Get-ChildItem, and Select-String; do not use shell writes, interpreters, package managers, validators, Git, or GitHub CLI. This is one bounded remediation lane: do not invoke subagents, MCP, dynamic tools, web search, or external connectors. Review the resulting file changes directly. Return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null, merged false, ownerTouchCount 0, blockedScopeCrossed false, and reviewThreads 0. Do not contact William.`
}

function buildValidationRemediationPrompt({ workOrderId, branch, outcome, reservations, validation }) {
  return `Continue ${workOrderId} on ${branch}.

${remediationContext({ outcome, reservations })}

Hermes native-host validation rejected the current file handoff:
${validation}

Use only repository file reads and edits inside the existing reserved paths. Read-only shell inspection is limited to rg, Get-Content, Get-ChildItem, and Select-String. Correct the validation failure, independently review the resulting file changes, and do not use shell writes, interpreters, package managers, validators, Git, or GitHub CLI. This is one bounded remediation lane: do not invoke subagents, MCP, dynamic tools, web search, or external connectors. Return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null, merged false, ownerTouchCount 0, blockedScopeCrossed false, and reviewThreads 0. Do not contact William.`
}

function ownerDecisionPacket(result) {
  const packet = {
    blockedAction: result.blockedAction,
    authorityBoundary: result.authorityBoundary,
    minimumChoice: result.minimumChoice,
    approveConsequence: result.approveConsequence,
    denyConsequence: result.denyConsequence,
  }
  if (typeof result.nextState !== "string"
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(result.nextState)
    || Object.values(packet).some((value) => typeof value !== "string" || value.trim() === "")
    || packet.minimumChoice !== "APPROVE_OR_DENY") {
    throw Object.assign(new Error("Owner decision result omitted its exact authority packet"), {
      code: "HERMES_OWNER_DECISION_PACKET_WALL",
    })
  }
  return packet
}

function buildOwnerDecisionResumePrompt({ workOrderId, branch, outcome, reservations, packet, nextState }) {
  return `Resume only the previously blocked action for ${workOrderId} on ${branch}.

${remediationContext({ outcome, reservations })}

The Primary Operator approved this exact persisted authority request:
- Blocked action: ${packet.blockedAction}
- Authority boundary: ${packet.authorityBoundary}
- Minimum choice: ${packet.minimumChoice}
- Approved consequence: ${packet.approveConsequence}
- Denied consequence: ${packet.denyConsequence}
- Governed next state: ${nextState}

Continue from the existing worktree and Codex thread. Do not replay completed implementation, validation, review, Git, or delivery work. Perform only the blocked action and its dependency-required continuation. Return the standard structured result with ownerTouchCount 0 and blockedScopeCrossed false. Do not contact William.`
}

function hasOwnerDecisionResume(metadata) {
  return Number.isSafeInteger(Number(metadata?.ownerDecisionId))
    && Number(metadata.ownerDecisionId) > 0
    && metadata?.ownerDecisionPacket !== null
    && typeof metadata?.ownerDecisionNextState === "string"
    && metadata?.ownerDecisionResumePhase === "PENDING"
}

function hasConsumedOwnerDecisionResume(metadata) {
  return Number.isSafeInteger(Number(metadata?.ownerDecisionId))
    && Number(metadata.ownerDecisionId) > 0
    && metadata?.ownerDecisionResumePhase === "CONSUMED"
}

function buildOwnerDecisionPostResumePrompt({ workOrderId, branch, outcome, reservations }) {
  return `Continue ${workOrderId} on ${branch} after the recorded owner-authorized resume turn.

${remediationContext({ outcome, reservations })}

The exact blocked action was already dispatched and completed in the existing Codex thread. Do not repeat that action. Inspect the current worktree and thread state, preserve completed work, and continue only with dependency-required validation, review, delivery, or truthful terminal reporting. Return the standard structured result with ownerTouchCount 0 and blockedScopeCrossed false. Do not contact William.`
}

function allowedPath(changedPath, reservations) {
  if (FORBIDDEN_CHANGED_PATH.test(changedPath)) return false
  return reservations.some((reservation) => {
    if (!reservation.endsWith("/**")) return changedPath === reservation
    return changedPath.startsWith(reservation.slice(0, -2))
  })
}

function assertOwnerTouchCountersZero(value) {
  const counters = value?.ownerTouchCounters
  if (!counters || Object.values(counters).some((count) => count !== 0)) {
    throw Object.assign(new Error("Durable owner-touch counters must remain zero"), { code: "HERMES_OWNER_TOUCH_WALL" })
  }
}

function queueSettlementContext(outcome) {
  return outcome?.queueBinding ? { outcome } : {}
}

function hasDurableQueueBinding(binding) {
  return binding !== null
    && typeof binding === "object"
    && [
      binding.userId,
      binding.outcomeKey,
      binding.executionBinding,
      binding.leaseToken,
      binding.leaseHolder,
      binding.acquisitionKey,
    ].every((value) => typeof value === "string" && value.trim().length > 0)
    && Number.isSafeInteger(binding.expectedVersion)
    && binding.expectedVersion >= 0
    && Number.isSafeInteger(binding.fencingToken)
    && binding.fencingToken > 0
    && (binding.activeWorkOrderId === undefined
      || (Number.isSafeInteger(binding.activeWorkOrderId) && binding.activeWorkOrderId > 0))
}

function shouldRefreshExpiredBindingBeforeProjection(execution, observedAt) {
  if (!hasDurableQueueBinding(execution?.metadata?.outcome?.queueBinding)) return false
  const expiresAt = execution?.lease?.expiresAt
  const expiresAtMs = typeof expiresAt === "string" && expiresAt.trim().length > 0
    ? Date.parse(expiresAt)
    : Number.NaN
  if (!Number.isFinite(expiresAtMs)) {
    throw Object.assign(new Error("Durable queue-bound execution has no valid local lease expiry"), {
      code: "HERMES_EXECUTION_STATE_WALL",
    })
  }
  return execution?.lease?.status !== "RELEASED" && expiresAtMs <= observedAt.getTime()
}

export function assertChangedPathsAllowed(paths, reservations) {
  const blocked = paths.filter((changedPath) => !allowedPath(changedPath.replace(/\\/g, "/"), reservations))
  if (blocked.length > 0) {
    throw Object.assign(new Error(`Changed paths crossed the reservation: ${blocked.join(", ")}`), {
      code: "HERMES_CHANGED_PATH_WALL",
      blocked,
    })
  }
}

export function requireHermesWorkContract(outcome, resolver = resolveHermesWorkContract) {
  const verified = outcome?.verifiedQueueWorkContract
  let contract
  if (verified !== undefined) {
    const binding = outcome?.queueBinding
    const provenance = verified?.provenance
    const derived = provenance?.operation === "runtime_finding.derive"
      && provenance?.outcomeKey === outcome?.outcomeKey
      && provenance?.outcomeKey === binding?.outcomeKey
      && Number(provenance?.workOrderId) === Number(binding?.activeWorkOrderId)
      && typeof provenance?.workOrderRef === "string"
      && provenance.workOrderRef.trim() !== ""
    const workbenchParent = provenance?.operation === "workbench_execution.authorize"
      && Object.keys(provenance).sort().join(",") === "operation,outcomeKey,workOrderRef"
      && provenance?.outcomeKey === outcome?.outcomeKey
      && provenance?.outcomeKey === binding?.outcomeKey
      && provenance?.workOrderRef === `WO-HERMES-OUTCOME-${Number(outcome?.id)}`
      && verified?.contract?.id === HERMES_ISSUE_911_RELIABILITY_CONTRACT_ID
      && verified?.contract?.digest === HERMES_ISSUE_911_RELIABILITY_CONTRACT_DIGEST
    if (!verified || (!derived && !workbenchParent)) {
      throw Object.assign(new Error("Queue work contract provenance conflicts"), {
        code: "HERMES_WORK_CONTRACT_WALL",
      })
    }
    contract = verified.contract
  } else {
    contract = resolver(outcome)
  }
  if (!contract || !Array.isArray(contract.reservations) || contract.reservations.length === 0
    || !Array.isArray(contract.validationCommands) || contract.validationCommands.length === 0) {
    throw Object.assign(new Error("Outcome has no exact reviewed work contract"), {
      code: "HERMES_WORK_CONTRACT_WALL",
    })
  }
  return contract
}

function workOrderRefFor(outcome) {
  return ["runtime_finding.derive", "workbench_execution.authorize"].includes(
    outcome?.verifiedQueueWorkContract?.provenance?.operation,
  )
    ? outcome.verifiedQueueWorkContract.provenance.workOrderRef
    : `WO-HERMES-${outcome.id}-001`
}

function projectedWorkContract(outcome, resolver) {
  const contract = requireHermesWorkContract(outcome, resolver)
  return {
    contract,
    projection: {
      id: contract.id,
      digest: contract.digest,
      ...(contract.version === undefined ? {} : { version: contract.version }),
      ...(contract.repository === undefined ? {} : { repository: contract.repository }),
      ...(contract.lane === undefined ? {} : { lane: contract.lane }),
      allowedFiles: [...contract.reservations],
      validators: contract.validationCommands.map(({ command, args }) => (
        `${command} ${args.join(" ")}`
      )),
      ...(contract.projection === undefined
        ? {}
        : { projection: { ...contract.projection } }),
      ...(contract.delivery === undefined
        ? {}
        : {
            delivery: {
              ...contract.delivery,
              allowedActions: [...contract.delivery.allowedActions],
            },
          }),
    },
  }
}

export function deriveHermesRuntimeProjectionBindings(
  outcome,
  { resolver = resolveHermesWorkContract, requireVerified = false } = {},
) {
  if (requireVerified && outcome?.verifiedQueueWorkContract === undefined) {
    throw Object.assign(new Error("Queue work contract authority is missing"), {
      code: "HERMES_WORK_CONTRACT_WALL",
    })
  }
  const { projection: workContract } = projectedWorkContract(outcome, resolver)
  const binding = outcome?.queueBinding
  if (binding === undefined || binding === null) {
    return { workContract, executionBinding: null }
  }
  if (requireVerified && (typeof binding.userId !== "string" || binding.userId.trim() === ""
    || typeof binding.outcomeKey !== "string" || binding.outcomeKey.trim() === ""
    || binding.outcomeKey !== outcome?.outcomeKey
    || !Number.isSafeInteger(binding.expectedVersion) || binding.expectedVersion < 0
    || typeof binding.executionBinding !== "string" || binding.executionBinding.trim() === ""
    || typeof binding.leaseToken !== "string" || binding.leaseToken.trim() === ""
    || typeof binding.leaseHolder !== "string" || binding.leaseHolder.trim() === ""
    || typeof binding.acquisitionKey !== "string" || binding.acquisitionKey.trim() === ""
    || !Number.isSafeInteger(binding.fencingToken) || binding.fencingToken <= 0)) {
    throw Object.assign(new Error("Runtime execution binding is invalid"), {
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    })
  }
  return {
    workContract,
    executionBinding: {
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      expectedVersion: binding.expectedVersion,
      executionBinding: binding.executionBinding,
      leaseToken: binding.leaseToken,
      leaseHolder: binding.leaseHolder,
      ...(typeof binding.acquisitionKey === "string" && binding.acquisitionKey.trim() !== ""
        ? { acquisitionKey: binding.acquisitionKey }
        : {}),
      fencingToken: binding.fencingToken,
    },
  }
}

function retryableWallDetail(error) {
  const code = typeof error?.code === "string" ? error.code : "HERMES_CYCLE_FAILED"
  const detail = sanitizeAppServerText(error?.detail).trim()
  return detail ? `${code}: ${detail}`.slice(0, MAX_CHECKPOINT_DETAIL_CHARS) : code
}

export function createHermesOrchestrator(options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd())
  const runtimeRoot = path.resolve(options.runtimeRoot ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT
    ?? path.join(os.homedir(), ".williamos", "hermes-bridge"))
  const statePath = path.join(runtimeRoot, "state", "state.json")
  const activationPath = path.join(runtimeRoot, "control", "activation")
  const notBeforePath = path.join(runtimeRoot, "control", "authority-not-before")
  const state = options.state ?? createHermesStateStore(statePath)
  const workContractResolver = options.workContractResolver ?? resolveHermesWorkContract
  const backendEnvironment = options.env ?? process.env
  const executionBackend = options.executionBackend ?? selectExecutionBackend(
    typeof backendEnvironment.WILLIAMOS_CODEX_EXEC_NODE === "string"
      && backendEnvironment.WILLIAMOS_CODEX_EXEC_NODE.trim().length > 0
      ? backendEnvironment
      : {
          ...backendEnvironment,
          WILLIAMOS_HERMES_RUNTIME_ROOT: runtimeRoot,
          WILLIAMOS_REPOSITORY_ROOT: workspace,
        },
  )
  const lifecycle = options.lifecycle ?? createRepositoryLifecycle({
    workspaceRoot: workspace,
    ownedWorktreeRoot: path.join(runtimeRoot, "worktrees"),
    validationCommands: DEFAULT_VALIDATION_COMMANDS,
    executionBackend,
  })
  const selectOutcome = options.selectOutcome ?? selectNextOutcome
  const markComplete = options.markComplete ?? completeOutcome
  const markTerminal = options.markTerminal ?? terminalizeOutcome
  const deferOutcome = options.deferOutcome ?? deferProviderOutcome
  const renewQueueLease = options.renewQueueLease ?? (async () => null)
  const bindQueueWorkOrder = options.bindQueueWorkOrder ?? (async () => null)
  const refreshQueueOutcome = options.refreshQueueOutcome ?? (async (outcome) => outcome)
  const resumeQueueAfterDecision = options.resumeQueueAfterDecision ?? (async (outcome) => outcome)
  const resumeQueueAfterValidationRecovery = options.resumeQueueAfterValidationRecovery
    ?? (async (outcome) => outcome)
  const resumeQueueAfterReviewRecovery = options.resumeQueueAfterReviewRecovery
    ?? (async (outcome) => outcome)
  const readApprovedDecision = options.readApprovedOwnerDecision ?? readApprovedOwnerDecision
  const verifyValidationInfrastructureRecovery = options.verifyValidationInfrastructureRecovery
    ?? readValidationInfrastructureRecovery
  const resolveValidationRecovery = options.resolveValidationInfrastructureRecovery
    ?? (options.verifyValidationInfrastructureRecovery
      ? async (input) => (await verifyValidationInfrastructureRecovery(input)
          ? {
              expectedNextState: input.expectedNextState,
              proofDigest: input.proofDigest,
              recoveryFencingToken: input.expectedFencingToken,
            }
          : null)
      : resolveValidationInfrastructureRecovery)
  const projectCheckpoint = options.projectCheckpoint ?? projectOutcomeRuntimeCheckpoint
  const projectLease = options.projectLease ?? projectOutcomeRuntimeLease
  const leaseRenewalIntervalMs = options.leaseRenewalIntervalMs ?? 5 * 60 * 1000
  const clientFactory = options.clientFactory
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const isProcessAlive = options.isProcessAlive ?? ((processId) => {
    try {
      process.kill(processId, 0)
      return true
    } catch (error) {
      return error?.code !== "ESRCH"
    }
  })
  const reviewPollIntervalMs = options.reviewPollIntervalMs ?? REVIEW_POLL_INTERVAL_MS
  const reviewPollAttempts = options.reviewPollAttempts ?? REVIEW_POLL_ATTEMPTS
  if (!Number.isFinite(reviewPollIntervalMs) || reviewPollIntervalMs <= 0
    || !Number.isInteger(reviewPollAttempts) || reviewPollAttempts <= 0
    || reviewPollIntervalMs * reviewPollAttempts >= LEASE_DURATION_MS - 5 * 60 * 1000) {
    throw Object.assign(new Error("Review polling must remain inside the lease window"), {
      code: "HERMES_REVIEW_POLL_BUDGET_WALL",
    })
  }
  const holderId = options.holderId ?? `${os.hostname()}:${process.pid}:${randomUUID()}`
  const recoverableValidationStates = new Set([
    "VALIDATION_INFRASTRUCTURE_RECOVERED",
    "HOST_VALIDATION_STARTED",
    "VALIDATION_REMEDIATION_REQUIRED",
  ])
  const validationRecoverySourceFence = (execution, persisted) => {
    if (Number.isSafeInteger(execution?.metadata?.validationRecoveryFencingToken)
      && execution.metadata.validationRecoveryFencingToken > 0) {
      return execution.metadata.validationRecoveryFencingToken
    }
    return null
  }
  const matchesRecoverableValidationState = (execution, persisted) => {
    const sourceFence = validationRecoverySourceFence(execution, persisted)
    if (execution?.checkpoint?.state === "VALIDATION_INFRASTRUCTURE_RECOVERED") {
      return execution.checkpoint.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
        && execution.metadata?.validationRecoveryPhase === "PENDING_HOST_VALIDATION"
        && (sourceFence !== null
          || (execution.metadata?.validationRecoveryPhase === null
            && execution.metadata?.validationRecoveryFencingToken === null))
    }
    if (execution?.checkpoint?.state === "HOST_VALIDATION_STARTED") {
      return execution.checkpoint.detail === "Recovered validation infrastructure"
        && execution.metadata?.validationRecoveryPhase === "PENDING_HOST_VALIDATION"
        && sourceFence !== null
    }
    if (execution?.checkpoint?.state === "VALIDATION_REMEDIATION_REQUIRED") {
      return execution.checkpoint.detail === null
        && [null, "VALIDATION_REMEDIATION"].includes(execution.metadata?.validationRecoveryPhase ?? null)
        && typeof execution.metadata?.validationFailure === "string"
        && execution.metadata.validationFailure.length > 0
        && Number.isSafeInteger(execution.metadata?.validationRemediationRound)
        && execution.metadata.validationRemediationRound > 0
        && (sourceFence !== null
          || (execution.metadata?.validationRecoveryPhase === null
            && execution.metadata?.validationRecoveryFencingToken === null))
    }
    return !recoverableValidationStates.has(execution?.checkpoint?.state)
      && execution?.metadata?.validationRecoveryPhase === "PENDING_HOST_VALIDATION"
      && sourceFence !== null
  }
  async function abandonOwnedCycleLease() {
    const owned = Object.values(state.read().executions).filter((execution) => (
      execution?.lease?.status === "ACTIVE"
      && !execution?.lease?.abandonedAt
      && execution?.lease?.holderId === holderId
    ))
    if (owned.length > 1) {
      throw Object.assign(new Error("Cycle holder owns multiple active leases"), {
        code: "HERMES_EXECUTION_CONCURRENCY_WALL",
      })
    }
    if (owned.length === 0) return { abandoned: false }
    const execution = owned[0]
    await abandonLease({
      idempotencyKey: `${execution.outcomeId}:abandon:${execution.fencingToken}:cycle-exit:${execution.checkpoint.sequence}`,
      outcomeId: execution.outcomeId,
      holderId,
      fencingToken: execution.fencingToken,
      reason: "HERMES_CYCLE_PROCESS_EXIT",
    })
    return { abandoned: true, outcomeId: execution.outcomeId }
  }

  async function recoverOrphanedValidationCycleLease() {
    const supervisorPath = path.join(runtimeRoot, "state", "supervisor.json")
    let supervisorAlive = false
    if (fs.existsSync(supervisorPath)) {
      try {
        const supervisor = JSON.parse(fs.readFileSync(supervisorPath, "utf8"))
        if (!Number.isSafeInteger(supervisor?.processId) || supervisor.processId <= 0) {
          throw new Error("INVALID_SUPERVISOR_PID")
        }
        supervisorAlive = isProcessAlive(supervisor.processId)
      } catch {
        throw Object.assign(new Error("Supervisor evidence is malformed"), {
          code: "HERMES_ORPHAN_RECOVERY_SUPERVISOR_WALL",
        })
      }
    }
    if (readControl(activationPath, "disabled") !== "disabled" || supervisorAlive) {
      throw Object.assign(new Error("Supervisor must be stopped before orphan recovery"), {
        code: "HERMES_ORPHAN_RECOVERY_SUPERVISOR_WALL",
      })
    }
    const persisted = state.read()
    assertOwnerTouchCountersZero(persisted)
    const candidates = Object.values(persisted.executions).filter((execution) => (
      execution?.lease?.status === "ACTIVE"
      && recoverableValidationStates.has(execution?.checkpoint?.state)
      && matchesRecoverableValidationState(execution, persisted)
      && execution?.metadata?.outcome
      && String(execution.metadata.outcome.id) === String(execution.outcomeId)
      && /^[0-9a-f]{64}$/.test(String(execution?.metadata?.validationRecoveryProofDigest ?? ""))
    ))
    if (candidates.length !== 1) {
      throw Object.assign(new Error("Exactly one orphaned validation recovery lease is required"), {
        code: "HERMES_ORPHAN_RECOVERY_CANDIDATE_WALL",
      })
    }
    const execution = candidates[0]
    const projectAbandonedSnapshot = async (snapshot) => {
      const assertExactFence = () => {
        const current = state.read().executions[String(snapshot.outcomeId)]
        if (current?.fencingToken !== snapshot.fencingToken
          || current?.lease?.holderId !== snapshot.lease.holderId
          || current?.lease?.abandonedAt !== snapshot.lease.abandonedAt
          || current?.lease?.expiresAt !== snapshot.lease.expiresAt
          || current?.lease?.abandonReason !== "HERMES_CYCLE_PROCESS_EXIT") {
          throw Object.assign(new Error("Orphan recovery fence changed during projection"), {
            code: "HERMES_ORPHAN_RECOVERY_FENCE_WALL",
          })
        }
      }
      assertExactFence()
      const projected = await retryRuntimeProjection(() => projectLease({
        outcomeId: Number(snapshot.outcomeId),
        attempt: snapshot.fencingToken,
        checkpointSequence: snapshot.checkpoint.sequence,
        lease: { status: "ABANDONED", expiresAt: snapshot.lease.expiresAt },
      }), { sleep })
      assertExactFence()
      return projected
    }
    const alreadyAbandoned = typeof execution.lease.abandonedAt === "string"
      && execution.lease.abandonedAt === execution.lease.expiresAt
      && Number.isFinite(Date.parse(execution.lease.abandonedAt))
      && execution.lease.abandonReason === "HERMES_CYCLE_PROCESS_EXIT"
    if (execution.lease.abandonedAt && !alreadyAbandoned) {
      throw Object.assign(new Error("Recorded orphan recovery marker is malformed"), {
        code: "HERMES_ORPHAN_RECOVERY_STATE_WALL",
      })
    }
    if (alreadyAbandoned) {
      await projectAbandonedSnapshot(execution)
      return {
        result: "RECOVERED", outcomeId: execution.outcomeId,
        fencingToken: execution.fencingToken, replayed: true,
      }
    }
    const holderMatch = /^([^:]+):(\d+):([0-9a-f-]{36})$/i.exec(String(execution.lease.holderId ?? ""))
    const processId = Number(holderMatch?.[2])
    if (!holderMatch
      || holderMatch[1].toLowerCase() !== os.hostname().toLowerCase()
      || !Number.isSafeInteger(processId)
      || processId <= 0
      || isProcessAlive(processId)) {
      throw Object.assign(new Error("Recorded validation recovery holder is not a dead local process"), {
        code: "HERMES_ORPHAN_RECOVERY_HOLDER_WALL",
      })
    }
    state.abandonLease({
      idempotencyKey: `${execution.outcomeId}:abandon:${execution.fencingToken}:orphan-recovery:${execution.checkpoint.sequence}`,
      outcomeId: execution.outcomeId,
      holderId: execution.lease.holderId,
      fencingToken: execution.fencingToken,
      reason: "HERMES_CYCLE_PROCESS_EXIT",
    })
    const abandoned = state.read().executions[String(execution.outcomeId)]
    await projectAbandonedSnapshot(abandoned)
    return {
      result: "RECOVERED", outcomeId: execution.outcomeId,
      fencingToken: execution.fencingToken, replayed: false,
    }
  }

  function projectionMetadata(value = {}) {
    return Object.fromEntries([
      ["prNumber", value.prNumber],
      ["commit", value.commit],
      ["headRefOid", value.headRefOid],
      ["mergeSha", value.mergeSha],
      ["terminalCleanupRecoveryProofDigest", value.terminalCleanupRecoveryProofDigest],
    ].filter(([field, fieldValue]) => (
      field === "headRefOid"
        ? fieldValue !== undefined && (fieldValue !== null
          || value.validationRecoveryPhase === "PENDING_HOST_VALIDATION")
        : fieldValue !== null && fieldValue !== undefined
    )))
  }

  async function projectCurrentExecution(outcomeId) {
    const execution = state.read().executions[String(outcomeId)]
    if (!execution) {
      throw Object.assign(new Error("Runtime execution is absent after durable mutation"), {
        code: "HERMES_RUNTIME_PROJECTION_STATE_WALL",
      })
    }
    const { workContract, executionBinding } = deriveHermesRuntimeProjectionBindings(
      execution.metadata?.outcome,
      { resolver: workContractResolver },
    )
    try {
      return await retryRuntimeProjection(() => projectCheckpoint({
        outcomeId: Number(outcomeId),
        attempt: execution.fencingToken,
        workContract,
        executionBinding,
        checkpoint: {
          sequence: execution.checkpoint.sequence,
          state: execution.checkpoint.state,
          detail: execution.checkpoint.detail,
          ...(execution.checkpoint.state === "CODEX_TURN_COMPLETED"
            && Object.hasOwn(execution.metadata?.turnResult ?? {}, "findings")
            ? { findings: execution.metadata.turnResult.findings }
            : {}),
          metadata: {
            ...projectionMetadata(execution.metadata),
            workContractId: workContract.id,
            workContractDigest: workContract.digest,
          },
        },
      }), { sleep })
    } catch (error) {
      throw Object.assign(new Error("Persisted runtime projection failed"), {
        code: "HERMES_RUNTIME_PROJECTION_WALL",
        cause: error,
      })
    }
  }

  async function projectCurrentLease(outcomeId, explicitStatus = null) {
    const execution = state.read().executions[String(outcomeId)]
    if (!execution) {
      throw Object.assign(new Error("Runtime execution is absent after lease mutation"), {
        code: "HERMES_RUNTIME_PROJECTION_STATE_WALL",
      })
    }
    const projectedStatus = explicitStatus
      ?? (execution.lease.status === "ACTIVE" && execution.lease.abandonedAt
        ? "ABANDONED"
        : execution.lease.status)
    try {
      return await retryRuntimeProjection(() => projectLease({
        outcomeId: Number(outcomeId),
        attempt: execution.fencingToken,
        checkpointSequence: execution.checkpoint.sequence,
        lease: {
          status: projectedStatus,
          expiresAt: execution.lease.expiresAt,
        },
      }), { sleep })
    } catch (error) {
      throw Object.assign(new Error("Persisted runtime lease projection failed"), {
        code: "HERMES_RUNTIME_PROJECTION_WALL",
        cause: error,
      })
    }
  }

  async function abandonLease(request) {
    const result = state.abandonLease(request)
    await projectCurrentLease(request.outcomeId, "ABANDONED")
    return result
  }

  async function releaseLease(request) {
    const result = state.releaseLease(request)
    await projectCurrentLease(request.outcomeId, "RELEASED")
    return result
  }

  async function deferLease(request) {
    const result = state.deferProviderWall(request)
    await projectCurrentExecution(request.outcomeId)
    await projectCurrentLease(request.outcomeId, "DEFERRED")
    return result
  }

  async function checkpoint(lease, sequence, checkpointState, detail, metadata = {}) {
    const recorded = state.checkpoint({
      idempotencyKey: `${lease.outcomeId}:checkpoint:${sequence + 1}:${checkpointState}`,
      outcomeId: lease.outcomeId,
      holderId,
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: sequence,
      state: checkpointState,
      detail,
      metadata,
    })
    try {
      await projectCurrentExecution(lease.outcomeId)
    } catch (error) {
      state.abandonLease({
        idempotencyKey: `${lease.outcomeId}:abandon:${lease.fencingToken}:runtime-projection:${recorded.checkpointSequence}`,
        outcomeId: lease.outcomeId,
        holderId,
        fencingToken: lease.fencingToken,
        reason: "HERMES_RUNTIME_PROJECTION_WALL",
      })
      throw error
    }
    return recorded
  }

  async function finalizeMerged({ lease, sequence, outcome, branch, reservations, worktreePath, prNumber }) {
    const pr = await lifecycle.inspectPullRequest(prNumber)
    const mergeSha = pr.mergeCommit?.oid
    if (pr.state !== "MERGED" || pr.baseRefName !== "main" || pr.unresolvedThreadCount !== 0
      || !SHA.test(pr.headRefOid ?? "") || !SHA.test(mergeSha ?? "")) {
      throw Object.assign(new Error("Merged PR failed independent verification"), { code: "HERMES_PR_VERIFICATION_WALL" })
    }
    const changedPaths = await lifecycle.inspectPullRequestFiles(prNumber)
    assertChangedPathsAllowed(changedPaths, reservations)
    if (!await lifecycle.verifyOriginMainContains(mergeSha)) {
      throw Object.assign(new Error("Merge commit is absent from origin/main"), { code: "HERMES_MAIN_VERIFICATION_WALL" })
    }
    try {
      await lifecycle.cleanupOwnedWorktree({
        branch, worktreePath, mergeCommitSha: mergeSha, expectedHeadSha: pr.headRefOid,
      })
    } catch (error) {
      throw Object.assign(new Error("Owned post-merge cleanup failed"), {
        code: "HERMES_POST_MERGE_CLEANUP_WALL",
        causeCode: error?.code ?? "HERMES_REPOSITORY_CLEANUP_WALL",
      })
    }
    const runtimeEvidenceRef = `EV-HERMES-${outcome.id}-${lease.fencingToken}-${sequence + 1}`
    const completed = await checkpoint(lease, sequence, "COMPLETE", `PR #${prNumber} merged and verified`, {
      prNumber, branch, mergeSha, headRefOid: pr.headRefOid, runtimeEvidenceRef,
    })
    const outcomeCompleted = await markComplete({
      outcomeId: outcome.id,
      ...queueSettlementContext(outcome),
      evidence: {
        prNumber,
        mergeSha,
        branch,
        runtimeEvidenceRef,
        ownerTouchCount: 0,
        blockedScopeCrossed: false,
      },
    })
    if (!outcomeCompleted) {
      throw Object.assign(new Error("Persisted outcome could not be closed after merge"), { code: "HERMES_OUTCOME_COMPLETION_WALL" })
    }
    await releaseLease({
      idempotencyKey: `${lease.outcomeId}:release:complete:${lease.fencingToken}`,
      outcomeId: lease.outcomeId, holderId, fencingToken: lease.fencingToken,
    })
    return { result: "COMPLETE", outcomeId: lease.outcomeId, prNumber, mergeSha, changedPaths }
  }

  async function finalizeTerminal({ lease, sequence, outcome, nextState, metadata = {} }) {
    const terminal = await checkpoint(lease, sequence, "FAILED_TERMINAL", nextState, {
      ...metadata,
      validationRecoveryPhase: null,
      validationRecoveryFencingToken: null,
    })
    const outcomeTerminalized = await markTerminal({
      outcomeId: outcome.id, ...queueSettlementContext(outcome),
      result: "FAILED_TERMINAL", nextState,
    })
    if (!outcomeTerminalized) {
      throw Object.assign(new Error("Persisted outcome could not be terminalized"), {
        code: "HERMES_OUTCOME_TERMINAL_WALL",
      })
    }
    await releaseLease({
      idempotencyKey: `${lease.outcomeId}:release:FAILED_TERMINAL:${nextState}:${lease.fencingToken}`,
      outcomeId: lease.outcomeId, holderId, fencingToken: lease.fencingToken,
    })
    return {
      result: "FAILED_TERMINAL", outcomeId: lease.outcomeId, nextState,
      checkpointSequence: terminal.checkpointSequence,
    }
  }

  async function settlePostMergeCleanupFailure({ lease, outcome, error }) {
    const current = state.read().executions[lease.outcomeId]
    const retryCount = (current?.metadata?.postMergeCleanupRetryCount ?? 0) + 1
    if (retryCount >= MAX_PROVIDER_REDISPATCHES) {
      const nextState = "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
      return finalizeTerminal({
        lease, sequence: current.checkpoint.sequence, outcome, nextState,
        metadata: { postMergeCleanupRetryCount: retryCount },
      })
    }
    const retry = await checkpoint(
      lease, current.checkpoint.sequence, "POST_MERGE_CLEANUP_RETRY",
      error?.code ?? "HERMES_POST_MERGE_CLEANUP_WALL",
      { postMergeCleanupRetryCount: retryCount },
    )
    await abandonLease({
      idempotencyKey: `${lease.outcomeId}:abandon-post-merge:${lease.fencingToken}:${retry.checkpointSequence}`,
      outcomeId: lease.outcomeId, holderId, fencingToken: lease.fencingToken,
      reason: error?.code ?? "HERMES_POST_MERGE_CLEANUP_WALL",
    })
    return null
  }

  async function advanceCommittedHead({
    lease, sequence, outcome, branch, reservations, record, commit, remediationRound = 0,
    assertLeaseProjectionHealthy = async () => {},
    quiesceLeaseRenewal = async () => {},
  }) {
    await assertLeaseProjectionHealthy()
    if (await lifecycle.inspectWorktreeHead(record) !== commit) {
      throw Object.assign(new Error("Recorded commit no longer matches the owned worktree"), { code: "HERMES_COMMIT_RECOVERY_WALL" })
    }
    await lifecycle.pushBranch(record)
    await assertLeaseProjectionHealthy()
    const pullRequest = await lifecycle.createPullRequest({
      branch,
      title: `feat(williamos): deliver ${safeLeaf(outcomeRef(outcome))}`,
      body: `Hermes-delivered bounded WilliamOS-native R0/R1 feature for ${outcomeRef(outcome)}.\n\nOwner touch count: 0. Blocked scope crossed: false.`,
    })
    const prNumber = pullRequestNumber(pullRequest)
    let candidate = await lifecycle.inspectPullRequest(prNumber)
    await assertLeaseProjectionHealthy()
    if (candidate.state !== "OPEN" || candidate.baseRefName !== "main"
      || candidate.isDraft || candidate.headRefOid !== commit) {
      throw Object.assign(new Error("Pull request identity changed during delivery"), { code: "HERMES_PR_VERIFICATION_WALL" })
    }
    let nextSequence = sequence
    if (!candidate.reviewed && !candidate.reviewRequested) {
      await lifecycle.requestCodexReview({ number: prNumber, headRefOid: commit })
      const requested = await checkpoint(lease, nextSequence, "PR_REVIEW_REQUESTED", `PR #${prNumber}`, {
        prNumber, branch, headRefOid: commit, remediationRound,
      })
      nextSequence = requested.checkpointSequence
    }
    let findings = []
    for (let pollAttempt = 0; pollAttempt < reviewPollAttempts; pollAttempt += 1) {
      if (candidate.state !== "OPEN" || candidate.baseRefName !== "main"
        || candidate.isDraft || candidate.headRefOid !== commit) {
        throw Object.assign(new Error("Pull request identity changed during review"), { code: "HERMES_PR_VERIFICATION_WALL" })
      }
      if (candidate.reviewCompleted && candidate.codexReviewFindings?.length > 0) {
        findings = candidate.codexReviewFindings.map((body) => ({
          threadId: null,
          isOutdated: false,
          path: "pull-request review",
          line: null,
          body,
        }))
        break
      }
      if (candidate.reviewCompleted && candidate.unresolvedThreadCount > 0) {
        findings = await lifecycle.inspectReviewFindings(prNumber)
        const reReviewedOutdatedFindings = remediationRound > 0 && candidate.cleanReviewEvidence
          && findings.length > 0 && findings.every((finding) => finding.isOutdated)
        if (reReviewedOutdatedFindings) {
          await lifecycle.resolveReviewThreads(findings.map((finding) => finding.threadId))
          candidate = await lifecycle.inspectPullRequest(prNumber)
          findings = []
          continue
        }
        break
      }
      if (candidate.checksComplete && candidate.failedChecks?.length > 0) {
        findings = candidate.failedChecks.map((check) => ({
          threadId: null,
          isOutdated: false,
          path: "pull-request checks",
          line: null,
          body: `${check.name} concluded ${check.state}`,
        }))
        break
      }
      if (candidate.checksGreen && candidate.reviewed) break
      await sleep(reviewPollIntervalMs)
      candidate = await lifecycle.inspectPullRequest(prNumber)
      await assertLeaseProjectionHealthy()
    }
    if (findings.length > 0 || candidate.unresolvedThreadCount > 0) {
      if (findings.length === 0) findings = await lifecycle.inspectReviewFindings(prNumber)
      if (findings.length === 0 || remediationRound >= MAX_REMEDIATION_ROUNDS) {
        return {
          kind: "TERMINAL",
          result: await finalizeTerminal({
            lease, sequence: nextSequence, outcome, nextState: "REVIEW_REMEDIATION_EXHAUSTED",
          }),
        }
      }
      const remediation = await checkpoint(lease, nextSequence, "REVIEW_REMEDIATION_REQUIRED", `PR #${prNumber}`, {
        prNumber, branch, headRefOid: commit, remediationRound,
      })
      return {
        kind: "REMEDIATION", sequence: remediation.checkpointSequence, prNumber, findings,
        nextRemediationRound: remediationRound + 1,
      }
    }
    if (!candidate.checksGreen || !candidate.reviewed || candidate.unresolvedThreadCount !== 0) {
      throw Object.assign(new Error("Pull request did not reach a green reviewed state"), {
        code: "HERMES_REVIEW_CONTINUITY_WALL",
      })
    }
    const worktreeChangedPaths = await lifecycle.inspectChangedPaths(record)
    assertChangedPathsAllowed(worktreeChangedPaths, reservations)
    const changedPaths = await lifecycle.inspectPullRequestFiles(prNumber)
    assertChangedPathsAllowed(changedPaths, reservations)
    await quiesceLeaseRenewal()
    await lifecycle.mergePullRequest({ number: prNumber, branch })
    const pr = await lifecycle.inspectPullRequest(prNumber)
    await assertLeaseProjectionHealthy()
    const mergeSha = pr.mergeCommit?.oid
    if (pr.state !== "MERGED" || pr.baseRefName !== "main"
      || pr.unresolvedThreadCount !== 0 || !SHA.test(mergeSha ?? "")) {
      throw Object.assign(new Error("Merged PR failed independent verification"), { code: "HERMES_PR_VERIFICATION_WALL" })
    }
    const merged = await checkpoint(lease, nextSequence, "PR_MERGED", `PR #${prNumber} merged`, {
      prNumber, branch, mergeSha, headRefOid: pr.headRefOid,
    })
    return {
      kind: "COMPLETE",
      result: await finalizeMerged({
        lease, sequence: merged.checkpointSequence, outcome, branch, reservations,
        worktreePath: record.worktreePath, prNumber,
      }),
    }
  }

  async function cycle(options = {}) {
    if (readControl(activationPath, "disabled") !== "enabled") return { result: "DISABLED" }
    const initialized = state.initialize()
    if (initialized.killSwitch.active) return { result: "KILL_SWITCH_ACTIVE" }
    assertOwnerTouchCountersZero(initialized)
    const unfinished = Object.values(initialized.executions).filter((execution) => execution?.lease?.status === "ACTIVE")
    if (unfinished.length > 1) throw Object.assign(new Error("Multiple unfinished executions found"), { code: "HERMES_EXECUTION_CONCURRENCY_WALL" })
    const pendingExecution = unfinished[0] ?? null
    const approvedReleasedExecutions = []
    const releasedDecisionProofs = new Map()
    for (const execution of Object.values(initialized.executions)) {
      if (execution?.lease?.status !== "RELEASED"
        || execution?.checkpoint?.state !== "OWNER_DECISION_REQUIRED") continue
      const outcome = execution.metadata?.outcome
      if (!outcome || String(outcome.id) !== String(execution.outcomeId)) {
        throw Object.assign(new Error("Released owner wall is missing its exact outcome"), {
          code: "HERMES_EXECUTION_STATE_WALL",
        })
      }
      const proof = await readApprovedDecision({
        outcomeId: Number(outcome.id),
        workOrderId: execution.metadata?.ownerDecisionWorkOrderId ?? null,
        terminalEventId: execution.metadata?.ownerDecisionTerminalEventId ?? null,
        ownerUserId: outcome.userId,
        expectedNextState: execution.checkpoint.detail,
      })
      releasedDecisionProofs.set(String(execution.outcomeId), proof)
      if (proof?.approved === true) approvedReleasedExecutions.push({ execution, proof })
    }
    approvedReleasedExecutions.sort((left, right) =>
      Number(left.proof.decisionId) - Number(right.proof.decisionId)
        || String(left.execution.outcomeId).localeCompare(String(right.execution.outcomeId)))
    const validationRecoveryCandidates = Object.values(initialized.executions).filter((execution) => (
      execution?.lease?.status !== "RELEASED"
      && (recoverableValidationStates.has(execution?.checkpoint?.state)
        || execution?.metadata?.validationRecoveryPhase !== null)
      && (execution?.metadata?.validationRecoveryProofDigest !== null
        || execution?.metadata?.validationRecoveryPhase !== null
        || execution?.lease?.recoverReason === "VALIDATION_INFRASTRUCTURE_REMEDIATED")
    ))
    for (const execution of validationRecoveryCandidates) {
      if (!matchesRecoverableValidationState(execution, initialized)
        || !/^[0-9a-f]{64}$/.test(String(execution?.metadata?.validationRecoveryProofDigest ?? ""))) {
        throw Object.assign(new Error("Persisted validation recovery state is incomplete"), {
          code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
        })
      }
    }
    const validationRecoveries = validationRecoveryCandidates
    const verifiedValidationRecoveries = new Map()
    for (const execution of validationRecoveries) {
      const legacyRecoveredCheckpoint = execution.checkpoint.state === "VALIDATION_INFRASTRUCTURE_RECOVERED"
      const pendingRecoveryPhase = execution.metadata?.validationRecoveryPhase === "PENDING_HOST_VALIDATION"
      const originalRecoveryMarker = execution.lease.status === "ABANDONED"
        && execution.lease.recoverReason === "VALIDATION_INFRASTRUCTURE_REMEDIATED"
      const abandonedReacquiredRecovery = execution.lease.status === "ACTIVE"
        && pendingRecoveryPhase
        && typeof execution.lease.abandonedAt === "string"
        && execution.lease.abandonedAt === execution.lease.expiresAt
        && Number.isFinite(Date.parse(execution.lease.abandonedAt))
      if ((legacyRecoveredCheckpoint && execution.checkpoint.detail !== VALIDATION_INFRASTRUCTURE_RETRY_STATE)
        || (legacyRecoveredCheckpoint && !originalRecoveryMarker && !abandonedReacquiredRecovery)
        || !matchesRecoverableValidationState(execution, initialized)
        || !/^[0-9a-f]{64}$/.test(String(execution.metadata?.validationRecoveryProofDigest ?? ""))) {
        throw Object.assign(new Error("Persisted validation recovery state is incomplete"), {
          code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
        })
      }
      const resolvedProof = await resolveValidationRecovery({
        outcomeId: Number(execution.outcomeId),
        expectedNextState: VALIDATION_INFRASTRUCTURE_RETRY_STATE,
        proofDigest: execution.metadata.validationRecoveryProofDigest,
        expectedFencingToken: validationRecoverySourceFence(execution, initialized),
      })
      const persistedRecoveryFencingToken = validationRecoverySourceFence(execution, initialized)
      if (!resolvedProof
        || resolvedProof.expectedNextState !== VALIDATION_INFRASTRUCTURE_RETRY_STATE
        || resolvedProof.proofDigest !== execution.metadata.validationRecoveryProofDigest
        || !Number.isSafeInteger(resolvedProof.recoveryFencingToken)
        || resolvedProof.recoveryFencingToken <= 0
        || (persistedRecoveryFencingToken !== null
          && resolvedProof.recoveryFencingToken !== persistedRecoveryFencingToken)) {
        throw Object.assign(new Error("Persisted validation recovery proof is incomplete"), {
          code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
        })
      }
      verifiedValidationRecoveries.set(String(execution.outcomeId), {
        expectedNextState: VALIDATION_INFRASTRUCTURE_RETRY_STATE,
        proofDigest: execution.metadata.validationRecoveryProofDigest,
        recoveryFencingToken: resolvedProof.recoveryFencingToken,
      })
    }
    const verifiedReviewRecoveries = new Map()
    for (const execution of Object.values(initialized.executions)) {
      if (execution?.lease?.status !== "ABANDONED"
        || execution?.checkpoint?.state !== "REVIEW_REMEDIATION_RECOVERED"
        || execution?.checkpoint?.detail !== "REVIEW_REMEDIATION_EXHAUSTED") continue
      const prNumber = Number(execution?.metadata?.prNumber)
      const reviewedHeadSha = execution?.metadata?.headRefOid
      const mergeSha = execution?.metadata?.mergeSha
      const proofDigest = execution?.metadata?.reviewRecoveryProofDigest
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0
        || typeof reviewedHeadSha !== "string" || !/^[0-9a-f]{40}$/.test(reviewedHeadSha)
        || typeof mergeSha !== "string" || !/^[0-9a-f]{40}$/.test(mergeSha)
        || typeof proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proofDigest)) {
        throw Object.assign(new Error("Persisted review recovery proof is incomplete"), {
          code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
        })
      }
      verifiedReviewRecoveries.set(String(execution.outcomeId), {
        expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
        proofDigest,
        prNumber,
        reviewedHeadSha,
        mergeSha,
      })
    }
    const recoveredCandidates = Object.values(initialized.executions).filter((execution) => (
      execution?.lease?.status === "ABANDONED"
      && (
        (execution?.checkpoint?.state === "VALIDATION_INFRASTRUCTURE_RECOVERED"
          && execution?.checkpoint?.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
          && execution?.lease?.recoverReason === "VALIDATION_INFRASTRUCTURE_REMEDIATED"
          && /^[0-9a-f]{64}$/.test(String(execution?.metadata?.validationRecoveryProofDigest ?? "")))
        || (execution?.checkpoint?.state === "REVIEW_REMEDIATION_RECOVERED"
          && execution?.checkpoint?.detail === "REVIEW_REMEDIATION_EXHAUSTED")
        || (execution?.checkpoint?.state === "POST_MERGE_CLEANUP_RECOVERED"
          && /^PR #\d+$/.test(execution?.checkpoint?.detail ?? ""))
        || OWNER_DECISION_RESUME_STATES.has(execution?.checkpoint?.state)
        || matchesRecoverableValidationState(execution, initialized)
        || hasOwnerDecisionResume(execution?.metadata)
      )
    ))
    const recoveredExecutions = []
    for (const execution of recoveredCandidates) recoveredExecutions.push(execution)
    const deferredExecutions = Object.values(initialized.executions).filter((execution) => (
      execution?.lease?.status === "DEFERRED"
      && execution?.checkpoint?.state === "DEFERRED_PROVIDER_UNAVAILABLE"
    ))
    if (recoveredExecutions.length > 1
      || deferredExecutions.length > 1
      || [pendingExecution, recoveredExecutions[0], deferredExecutions[0]].filter(Boolean).length > 1) {
      throw Object.assign(new Error("Multiple recoverable executions found"), {
        code: "HERMES_EXECUTION_CONCURRENCY_WALL",
      })
    }
    const approvedReleased = pendingExecution || recoveredExecutions.length > 0
      || deferredExecutions.length > 0
      ? null
      : approvedReleasedExecutions[0] ?? null
    const durableExecution = pendingExecution
      ?? recoveredExecutions[0]
      ?? deferredExecutions[0]
      ?? approvedReleased?.execution
      ?? null
    const durableOutcome = durableExecution?.metadata?.outcome ?? null
    if (durableExecution && (!durableOutcome
      || String(durableOutcome.id) !== String(durableExecution.outcomeId))) {
      throw Object.assign(new Error("Durable execution is missing its exact outcome"), {
        code: "HERMES_EXECUTION_STATE_WALL",
      })
    }
    const requestedOutcome = options.outcome ?? null
    if (requestedOutcome && durableExecution
      && String(requestedOutcome.id) !== String(durableExecution.outcomeId)) {
      throw Object.assign(new Error("Requested outcome conflicts with the active execution"), {
        code: "HERMES_EXECUTION_CONCURRENCY_WALL",
      })
    }
    const initialProjectionObservedAt = now()
    for (const execution of Object.values(initialized.executions)) {
      if (execution?.metadata?.outcome
        && String(execution.metadata.outcome.id) === String(execution.outcomeId)
        && execution?.lease?.status !== "RELEASED") {
        if (shouldRefreshExpiredBindingBeforeProjection(execution, initialProjectionObservedAt)) continue
        await projectCurrentExecution(execution.outcomeId)
        await projectCurrentLease(execution.outcomeId)
      }
    }
    const notBefore = readControl(notBeforePath, now().toISOString())
    let outcome = durableOutcome ?? requestedOutcome ?? await selectOutcome({
      enabled: true, killSwitch: false, standingAuthority: true, notBefore,
    })
    if (!outcome) return { result: "NO_ELIGIBLE_OUTCOME" }

    const decision = evaluateOutcomePolicy({
      outcome,
      actor: "bsvalues",
      repository: "bsvalues/terragroq",
      enabled: true,
      standingAuthority: true,
    })
    if (!decision.allowed) return { result: "POLICY_WALL", reasonCode: decision.reasonCode }

    const outcomeId = String(outcome.id)
    let current = durableExecution ?? state.read().executions[outcomeId]
    if (current?.lease?.status === "RELEASED"
      && current.checkpoint?.state === "OWNER_DECISION_REQUIRED") {
      const expectedNextState = current.checkpoint.detail
      if (typeof expectedNextState !== "string" || expectedNextState.length === 0) {
        throw Object.assign(new Error("Persisted owner decision wall is incomplete"), {
          code: "HERMES_OWNER_DECISION_STATE_WALL",
        })
      }
      const proof = releasedDecisionProofs.has(outcomeId)
        ? releasedDecisionProofs.get(outcomeId)
        : await readApprovedDecision({
          outcomeId: Number(outcome.id),
          workOrderId: current.metadata?.ownerDecisionWorkOrderId ?? null,
          terminalEventId: current.metadata?.ownerDecisionTerminalEventId ?? null,
          ownerUserId: outcome.userId,
          expectedNextState,
        })
      if (proof?.approved === true) {
        outcome = await resumeQueueAfterDecision(outcome, proof)
        state.reopenOwnerDecisionWall({
          idempotencyKey: `${outcomeId}:owner-decision-reopen:${proof.decisionId}`,
          outcomeId,
          expectedFencingToken: current.fencingToken,
          expectedNextState,
          ownerDecisionId: proof.decisionId,
          ownerDecisionRef: proof.decisionRef,
          requestKey: proof.requestKey,
          decisionPacket: proof.decisionPacket,
          decisionPacketDigest: proof.decisionPacketDigest,
          workOrderId: proof.workOrderId,
          terminalEventId: proof.terminalEventId,
          outcome,
        })
        await projectCurrentExecution(outcomeId)
        await projectCurrentLease(outcomeId, "ABANDONED")
        current = state.read().executions[outcomeId]
      }
    }
    if (current?.lease?.status === "RELEASED") return { result: "ALREADY_FINALIZED", outcomeId }
    const terminalReplay = current?.checkpoint?.state === "COMPLETE"
      ? {
          state: "COMPLETE",
          evidence: {
            prNumber: current.metadata.prNumber,
            mergeSha: current.metadata.mergeSha,
            runtimeEvidenceRef: current.metadata.runtimeEvidenceRef,
          },
        }
      : current?.checkpoint?.state === "FAILED_TERMINAL"
        ? { state: "FAILED_TERMINAL", nextState: current.checkpoint.detail }
        : current?.checkpoint?.state === "OWNER_DECISION_REQUIRED"
          ? { state: "OWNER_DECISION_REQUIRED", nextState: current.checkpoint.detail }
        : null
    const validationRecoveryProof = verifiedValidationRecoveries.get(outcomeId)
    if (validationRecoveryProof) {
      outcome = await resumeQueueAfterValidationRecovery(outcome, validationRecoveryProof)
    }
    const reviewRecoveryProof = verifiedReviewRecoveries.get(outcomeId)
    if (reviewRecoveryProof) {
      outcome = await resumeQueueAfterReviewRecovery(outcome, reviewRecoveryProof)
    }
    outcome = terminalReplay
      ? await refreshQueueOutcome(outcome, terminalReplay)
      : await refreshQueueOutcome(outcome)

    let lease
    if (current) {
      const abandoned = current.lease.status === "ABANDONED" || Boolean(current.lease.abandonedAt)
      if (!abandoned && Date.parse(current.lease.expiresAt) > now().getTime()) {
        return { result: "LEASE_HELD", outcomeId }
      }
      lease = state.reclaimLease({
        idempotencyKey: `${outcomeId}:reclaim:${current.fencingToken + 1}`,
        outcomeId,
        expectedFencingToken: current.fencingToken,
        holderId,
        leaseDurationMs: LEASE_DURATION_MS,
        metadata: {
          ...current.metadata,
          outcome,
          ...(current.checkpoint.state === "DEFERRED_PROVIDER_UNAVAILABLE"
            ? { threadId: null, turnId: null }
            : {}),
        },
      })
    } else {
      lease = state.acquireLease({
        idempotencyKey: `${outcomeId}:acquire:1`, outcomeId, holderId,
        leaseDurationMs: LEASE_DURATION_MS, metadata: { outcome },
      })
    }
    let sequence = lease.checkpointSequence
    try {
      const projection = await projectCurrentExecution(outcomeId)
      if (!terminalReplay && projection?.workOrderId) {
        const needsDurableBinding = Boolean(outcome?.queueBinding)
          && outcome.queueBinding.activeWorkOrderId === undefined
        const boundOutcome = projection.status
          ? await bindQueueWorkOrder(outcome, projection.workOrderId, projection.status)
          : await bindQueueWorkOrder(outcome, projection.workOrderId)
        if (boundOutcome?.queueBinding) outcome = boundOutcome
        if (needsDurableBinding && outcome?.queueBinding?.activeWorkOrderId === projection.workOrderId) {
          const bound = await checkpoint(
            lease,
            sequence,
            "QUEUE_WORK_ORDER_BOUND",
            `Work Order ${projection.workOrderId}`,
            { outcome },
          )
          sequence = bound.checkpointSequence
        }
      }
      await projectCurrentLease(outcomeId)
    } catch (error) {
      state.abandonLease({
        idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:runtime-projection`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
        reason: error?.code ?? "HERMES_RUNTIME_PROJECTION_WALL",
      })
      throw error
    }

    if (current?.checkpoint?.state === "COMPLETE") {
      const evidence = {
        prNumber: current.metadata.prNumber,
        mergeSha: current.metadata.mergeSha,
        branch: current.metadata.branch,
        runtimeEvidenceRef: current.metadata.runtimeEvidenceRef,
        ownerTouchCount: 0,
        blockedScopeCrossed: false,
      }
      if (!await markComplete({
        outcomeId: outcome.id,
        ...queueSettlementContext(outcome),
        evidence,
      })) {
        throw Object.assign(new Error("Persisted outcome could not be closed after merge"), {
          code: "HERMES_OUTCOME_COMPLETION_WALL",
        })
      }
      await releaseLease({
        idempotencyKey: `${outcomeId}:release:complete:${lease.fencingToken}`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
      })
      return {
        result: "COMPLETE",
        outcomeId,
        prNumber: evidence.prNumber,
        mergeSha: evidence.mergeSha,
        recovered: true,
      }
    }
    if (current?.checkpoint?.state === "PROVIDER_UNAVAILABLE") {
      const recordedRetryAt = Date.parse(current.checkpoint.detail ?? "")
      const retryAfter = new Date(recordedRetryAt > now().getTime()
        ? recordedRetryAt : now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
      try {
        if (!await deferOutcome({
          outcomeId: outcome.id, ...queueSettlementContext(outcome), retryAfter,
        })) {
          throw Object.assign(new Error("Provider-unavailable outcome could not be deferred"), { code: "HERMES_PROVIDER_SETTLEMENT_WALL" })
        }
      } catch (error) {
        await abandonLease({
          idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:provider-settlement`,
          outcomeId, holderId, fencingToken: lease.fencingToken, reason: "HERMES_PROVIDER_SETTLEMENT_WALL",
        })
        throw error
      }
      await deferLease({
        idempotencyKey: `${outcomeId}:defer:PROVIDER_UNAVAILABLE:${retryAfter}`,
        outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
      })
      return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
    }
    if (current?.checkpoint?.state === "FAILED_TERMINAL") {
      const nextState = current.checkpoint.detail
      if (typeof nextState !== "string" || !nextState) {
        throw Object.assign(new Error("Persisted terminal checkpoint is incomplete"), {
          code: "HERMES_OUTCOME_TERMINAL_WALL",
        })
      }
      const outcomeTerminalized = await markTerminal({
        outcomeId: outcome.id, ...queueSettlementContext(outcome),
        result: "FAILED_TERMINAL", nextState,
      })
      if (!outcomeTerminalized) {
        throw Object.assign(new Error("Persisted outcome could not be terminalized"), {
          code: "HERMES_OUTCOME_TERMINAL_WALL",
        })
      }
      await releaseLease({
        idempotencyKey: `${outcomeId}:release:FAILED_TERMINAL:${nextState}:${lease.fencingToken}`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
      })
      return { result: "FAILED_TERMINAL", outcomeId, nextState }
    }
    if (current?.checkpoint?.state === "OWNER_DECISION_REQUIRED") {
      const nextState = current.checkpoint.detail
      let decisionPacket
      try {
        decisionPacket = ownerDecisionPacket({
          ...(current.metadata.ownerDecisionPacket ?? {}),
          nextState,
        })
      } catch (error) {
        await abandonLease({
          idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:owner-decision-packet`,
          outcomeId,
          holderId,
          fencingToken: lease.fencingToken,
          reason: error?.code ?? "HERMES_OWNER_DECISION_PACKET_WALL",
        })
        throw error
      }
      const outcomeTerminalized = await markTerminal({
        outcomeId: outcome.id,
        ...queueSettlementContext(outcome),
        result: "OWNER_DECISION_REQUIRED",
        nextState,
        metadata: decisionPacket,
      })
      if (!outcomeTerminalized) {
        throw Object.assign(new Error("Persisted owner wall could not be terminalized"), {
          code: "HERMES_OUTCOME_TERMINAL_WALL",
        })
      }
      await releaseLease({
        idempotencyKey: `${outcomeId}:release:OWNER_DECISION_REQUIRED:${lease.fencingToken}`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
      })
      return { result: "OWNER_DECISION_REQUIRED", outcomeId, nextState }
    }
    const branch = lease.metadata?.branch ?? `codex/hermes-${safeLeaf(outcomeRef(outcome))}-${outcome.id}`
    const { contract: workContract, projection: projectedContract } = projectedWorkContract(
      outcome,
      workContractResolver,
    )
    const reservations = workContract.reservations
    const workOrderRef = workOrderRefFor(outcome)
    const baseSha = lease.metadata?.baseSha ?? await lifecycle.refreshOriginMain()
    const recoveryCheckpointState = current?.checkpoint?.state ?? null
    const worktreePath = lease.metadata?.worktreePath
      ?? path.join(runtimeRoot, "worktrees", branch.slice("codex/".length))
    if (lease.metadata?.prNumber && lease.metadata?.mergeSha) {
      try {
        return await finalizeMerged({
          lease, sequence, outcome, branch, reservations, worktreePath,
          prNumber: lease.metadata.prNumber,
        })
      } catch (error) {
        if (error?.code === "HERMES_POST_MERGE_CLEANUP_WALL") {
          const terminal = await settlePostMergeCleanupFailure({ lease, outcome, error })
          if (terminal) return terminal
        }
        throw error
      }
    }
    if (current?.metadata?.branch === branch) {
      const prior = await lifecycle.discoverPullRequest(branch)
      if (prior?.state === "MERGED") {
        const merged = await lifecycle.inspectPullRequest(prior.number)
        const mergeSha = merged.mergeCommit?.oid
        if (!SHA.test(mergeSha ?? "")) throw Object.assign(new Error("Merged PR SHA missing"), { code: "HERMES_PR_VERIFICATION_WALL" })
        const recovered = await checkpoint(lease, sequence, "PR_MERGED", `Recovered PR #${prior.number}`, {
          prNumber: prior.number, branch, worktreePath, baseSha,
          mergeSha, headRefOid: merged.headRefOid,
        })
        return finalizeMerged({
          lease, sequence: recovered.checkpointSequence, outcome, branch, reservations, worktreePath,
          prNumber: prior.number,
        })
      }
    }
    let cp = await checkpoint(lease, sequence, "WORKTREE_INTENT", null, { branch, worktreePath, baseSha })
    sequence = cp.checkpointSequence
    const record = await lifecycle.ensureOwnedWorktree({
      branch, baseSha, name: branch.slice("codex/".length), worktreePath: cp.metadata.worktreePath,
    })
    cp = await checkpoint(lease, sequence, "WORKTREE_READY", null, { branch, worktreePath: record.worktreePath, baseSha })
    sequence = cp.checkpointSequence

    let pendingFindings = []
    let pendingValidationFailure = lease.metadata?.validationFailure || null
    let initialRemediationRound = 0
    initialRemediationRound = Math.max(
      initialRemediationRound, lease.metadata?.validationRemediationRound ?? 0,
    )
    const validationCommandsFor = async (workingPaths) => {
      const candidates = workingPaths.filter((changedPath) =>
        changedPath.startsWith("tests/") && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(changedPath))
      const focusedTests = []
      for (const changedPath of candidates) {
        const entry = await executionBackend.stat({
          workspacePath: record.worktreePath,
          relPath: changedPath,
        })
        if (entry.exists && entry.isFile) focusedTests.push(changedPath)
      }
      const unregisteredFocusedTest = focusedTests.find((testPath) => (
        !workContract.validationCommands.some((entry) => entry.args?.includes(testPath))
      ))
      if (unregisteredFocusedTest) {
        throw Object.assign(new Error("Changed test is absent from the exact work contract"), {
          code: "HERMES_WORK_CONTRACT_VALIDATOR_WALL",
        })
      }
      return workContract.validationCommands
    }
    const runDeterministicValidation = async (workingPaths) => {
      await lifecycle.ensureValidationDependencies(record)
      try {
        return await lifecycle.runValidationCommands({
          ...record,
          commands: await validationCommandsFor(workingPaths),
        })
      } finally {
        await lifecycle.removeValidationDependencies(record)
      }
    }
    let durableHeadRefOid = lease.metadata?.headRefOid ?? null
    const validationRecoveryPending = lease.metadata?.validationRecoveryPhase === "PENDING_HOST_VALIDATION"
    const durableValidationRecoveryFencingToken = validationRecoverySourceFence(lease, state.read())
    if (validationRecoveryPending || [
      "HOST_VALIDATION_STARTED",
      "VALIDATION_INFRASTRUCTURE_RECOVERED",
    ].includes(recoveryCheckpointState)) {
      durableHeadRefOid = null
    }
    if (!durableHeadRefOid && (validationRecoveryPending || [
      "HOST_VALIDATION_STARTED",
      "VALIDATION_INFRASTRUCTURE_RECOVERED",
    ].includes(recoveryCheckpointState))) {
      if (validationRecoveryPending) {
        cp = await checkpoint(
          lease,
          sequence,
          "HOST_VALIDATION_STARTED",
          "Recovered validation infrastructure",
          {
            headRefOid: null,
            validationEvidence: null,
            validationRecoveryPhase: "PENDING_HOST_VALIDATION",
          },
        )
        sequence = cp.checkpointSequence
      }
      const workingPaths = await lifecycle.inspectWorkingTreePaths(record)
      if (workingPaths.length === 0) {
        throw Object.assign(new Error("Interrupted host validation has no owned file changes"), {
          code: "HERMES_VALIDATION_RECOVERY_WALL",
        })
      }
      assertChangedPathsAllowed(workingPaths, reservations)
      try {
        const validation = await runDeterministicValidation(workingPaths)
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_PASSED", "Recovered deterministic validation", {
          validationEvidence: validation,
          validationFailure: "",
          validationRemediationRound: 0,
          validationRecoveryPhase: null,
          validationRecoveryFencingToken: null,
          headRefOid: null,
          ...consumedTurnResultMetadata(),
        })
        sequence = cp.checkpointSequence
        const committed = await lifecycle.commitChanges({
          ...record,
          paths: workingPaths,
          message: `feat(williamos): deliver ${safeLeaf(outcomeRef(outcome))}`,
        })
        cp = await checkpoint(lease, sequence, "COMMIT_CREATED", committed.commit, {
          headRefOid: committed.commit,
          remediationRound: initialRemediationRound,
        })
        sequence = cp.checkpointSequence
        durableHeadRefOid = committed.commit
      } catch (error) {
        if (error?.code !== "HERMES_VALIDATION_FAILED" || !error?.validation) throw error
        if (initialRemediationRound >= MAX_REMEDIATION_ROUNDS) {
          return finalizeTerminal({
            lease, sequence, outcome, nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
          })
        }
        const detail = `${error.validation.command} ${error.validation.args.join(" ")} exited ${error.validation.code}\n${error.validation.output}`
          .slice(0, 4_000)
        cp = await checkpoint(lease, sequence, "VALIDATION_REMEDIATION_REQUIRED", null, {
          validationFailure: detail,
          validationRemediationRound: initialRemediationRound + 1,
          validationRecoveryPhase: durableValidationRecoveryFencingToken === null
            ? null
            : "VALIDATION_REMEDIATION",
          validationRecoveryFencingToken: durableValidationRecoveryFencingToken,
          validationEvidence: null,
          ...consumedTurnResultMetadata(),
        })
        sequence = cp.checkpointSequence
        pendingValidationFailure = detail
        initialRemediationRound += 1
      }
    }
    if (!durableHeadRefOid && recoveryCheckpointState === "HOST_VALIDATION_PASSED") {
      const workingPaths = await lifecycle.inspectWorkingTreePaths(record)
      const worktreeHead = await lifecycle.inspectWorktreeHead(record)
      if (workingPaths.length > 0) {
        assertChangedPathsAllowed(workingPaths, reservations)
        const recoveredCommit = await lifecycle.commitChanges({
          ...record,
          paths: workingPaths,
          message: `feat(williamos): deliver ${safeLeaf(outcomeRef(outcome))}`,
        })
        cp = await checkpoint(lease, sequence, "COMMIT_RECOVERED", recoveredCommit.commit, {
          branch, worktreePath: record.worktreePath, baseSha, headRefOid: recoveredCommit.commit,
        })
        sequence = cp.checkpointSequence
        durableHeadRefOid = recoveredCommit.commit
      } else if (worktreeHead !== baseSha) {
        const changedPaths = await lifecycle.inspectChangedPaths(record)
        assertChangedPathsAllowed(changedPaths, reservations)
        cp = await checkpoint(lease, sequence, "COMMIT_RECOVERED", worktreeHead, {
          branch, worktreePath: record.worktreePath, baseSha, headRefOid: worktreeHead,
        })
        sequence = cp.checkpointSequence
        durableHeadRefOid = worktreeHead
      }
    }
    if (SHA.test(durableHeadRefOid ?? "")) {
      const recoveredRemediationRound = lease.metadata.remediationRound ?? 0
      const workingPaths = await lifecycle.inspectWorkingTreePaths(record)
      if (workingPaths.length === 0) {
        const recovered = await advanceCommittedHead({
          lease, sequence, outcome, branch, reservations, record,
          commit: durableHeadRefOid, remediationRound: recoveredRemediationRound,
        })
        if (recovered.kind !== "REMEDIATION") return recovered.result
        sequence = recovered.sequence
        pendingFindings = recovered.findings
        initialRemediationRound = Math.max(initialRemediationRound, recovered.nextRemediationRound)
      } else if (lease.metadata?.prNumber) {
        const candidate = await lifecycle.inspectPullRequest(lease.metadata.prNumber)
        if (candidate.unresolvedThreadCount > 0) {
          pendingFindings = await lifecycle.inspectReviewFindings(lease.metadata.prNumber)
          initialRemediationRound = Math.max(initialRemediationRound, recoveredRemediationRound + 1)
        }
      }
    }

    const client = clientFactory
      ? await clientFactory(record.worktreePath)
      : await executionBackend.runCodexClient({
          workspacePath: record.worktreePath,
          timeoutMs: TURN_TIMEOUT_MS,
        })
    let replayedTurnResult = cp.metadata.turnResult
      ? normalizeHermesTurnResult(cp.metadata.turnResult)
      : null
    const ownerDecisionResume = hasOwnerDecisionResume(cp.metadata)
    const consumedOwnerDecisionResume = hasConsumedOwnerDecisionResume(cp.metadata)
    let renewal
    const renewalProjections = new Set()
    let renewalFailure = null
    const renewLeaseAndProject = () => {
      if (renewalFailure) return
      try {
        state.renewLease({
          idempotencyKey: `${outcomeId}:renew:${Date.now()}`,
          outcomeId, holderId, fencingToken: lease.fencingToken, leaseDurationMs: LEASE_DURATION_MS,
        })
        const projection = Promise.all([
          projectCurrentLease(outcomeId),
          renewQueueLease(outcome),
        ]).catch((error) => {
          renewalFailure = Object.assign(
            new Error("Renewed lease could not be projected to persisted runtime truth"),
            { code: "HERMES_RUNTIME_PROJECTION_WALL", cause: error },
          )
        })
        renewalProjections.add(projection)
        void projection.then(() => renewalProjections.delete(projection))
      } catch (error) {
        renewalFailure = Object.assign(
          new Error("Resident lease renewal failed"),
          { code: "HERMES_RUNTIME_PROJECTION_WALL", cause: error },
        )
      }
    }
    const assertLeaseProjectionHealthy = async () => {
      while (renewalProjections.size > 0) {
        await Promise.all([...renewalProjections])
      }
      if (renewalFailure) throw renewalFailure
    }
    const quiesceLeaseRenewal = async () => {
      if (renewal) {
        clearInterval(renewal)
        renewal = undefined
      }
      await assertLeaseProjectionHealthy()
      renewLeaseAndProject()
      await assertLeaseProjectionHealthy()
    }
    try {
      let threadId = cp.metadata.threadId
      let clientReady = false
      const ensureClientReady = async () => {
        if (clientReady) return
        await client.connect()
        if (ownerDecisionResume) {
          const proof = await readApprovedDecision({
            outcomeId: Number(outcome.id),
            workOrderId: cp.metadata.ownerDecisionWorkOrderId,
            terminalEventId: cp.metadata.ownerDecisionTerminalEventId,
            ownerUserId: outcome.userId,
            expectedNextState: cp.metadata.ownerDecisionNextState,
          })
          if (proof?.approved !== true
            || Number(proof.decisionId) !== Number(cp.metadata.ownerDecisionId)
            || proof.decisionRef !== cp.metadata.ownerDecisionRef
            || proof.requestKey !== cp.metadata.ownerDecisionRequestKey
            || proof.decisionPacketDigest !== cp.metadata.ownerDecisionPacketDigest
            || JSON.stringify(proof.decisionPacket) !== JSON.stringify(cp.metadata.ownerDecisionPacket)) {
            throw Object.assign(new Error("Approved owner resume no longer matches canonical authority proof"), {
              code: "HERMES_OWNER_DECISION_AUTHORITY_WALL",
            })
          }
        }
        if (ownerDecisionResume && !threadId) {
          throw Object.assign(new Error("Approved owner resume is missing its original Codex thread"), {
            code: "HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL",
          })
        }
        if (threadId) {
          try {
            await client.resumeThread(threadId, {
              cwd: record.worktreePath, approvalPolicy: "never", sandbox: "workspace-write",
            })
          } catch (error) {
            if (ownerDecisionResume) {
              throw Object.assign(new Error("Approved owner resume could not restore its original Codex thread"), {
                code: "HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL",
                cause: error,
              })
            }
            threadId = null
          }
        }
        if (!threadId) {
          threadId = await client.startThread({
            cwd: record.worktreePath,
            approvalPolicy: "never",
            sandbox: "workspace-write",
            ephemeral: false,
          })
        }
        cp = await checkpoint(lease, sequence, "CODEX_THREAD_READY", null, { threadId })
        sequence = cp.checkpointSequence
        clientReady = true
      }
      if (!replayedTurnResult) await ensureClientReady()

      renewal = setInterval(renewLeaseAndProject, leaseRenewalIntervalMs)
      renewal.unref?.()

      let deliveryPrompt = pendingValidationFailure
        ? buildValidationRemediationPrompt({
          workOrderId: workOrderRef, branch,
          outcome: outcome.command, reservations, validation: pendingValidationFailure,
        })
        : pendingFindings.length > 0
          ? buildRemediationPrompt({
            workOrderId: workOrderRef, branch,
            outcome: outcome.command, reservations, findings: pendingFindings,
          })
        : ownerDecisionResume
          ? buildOwnerDecisionResumePrompt({
            workOrderId: workOrderRef,
            branch,
            outcome: outcome.command,
            reservations,
            packet: cp.metadata.ownerDecisionPacket,
            nextState: cp.metadata.ownerDecisionNextState,
          })
          : consumedOwnerDecisionResume
            ? buildOwnerDecisionPostResumePrompt({
              workOrderId: workOrderRef,
              branch,
              outcome: outcome.command,
              reservations,
            })
          : buildHermesCodexPrompt({
        outcome: outcome.command,
        outcomeRef: outcomeRef(outcome),
        workOrderId: workOrderRef,
        branch,
        baseSha,
        attempt: (cp.metadata.providerRetryCount ?? 0) + 1,
        reservations,
        validators: projectedContract.validators,
        })
      for (let remediationRound = initialRemediationRound;
        remediationRound <= MAX_REMEDIATION_ROUNDS; remediationRound += 1) {
        let result
        if (replayedTurnResult) {
          result = replayedTurnResult
          replayedTurnResult = null
        } else {
          await ensureClientReady()
          const turn = await client.runTurn({
            threadId,
            prompt: deliveryPrompt,
            turn: {
              outputSchema: HERMES_TURN_OUTPUT_SCHEMA,
              effort: "ultra",
              approvalPolicy: "never",
              runtimeWorkspaceRoots: [record.worktreePath],
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: [record.worktreePath],
                networkAccess: true,
                excludeTmpdirEnvVar: true,
                excludeSlashTmp: true,
              },
            },
            timeoutMs: TURN_TIMEOUT_MS,
          })
          result = validatedTurnResult(turn.finalText)
          cp = await checkpoint(lease, sequence, "CODEX_TURN_COMPLETED", turn.status, {
            threadId: turn.threadId,
            turnId: turn.turnId,
            turnResult: result,
            turnResultDigest: hermesTurnResultDigest(result),
            ...(ownerDecisionResume ? { ownerDecisionResumePhase: "CONSUMED" } : {}),
          })
          sequence = cp.checkpointSequence
          await assertLeaseProjectionHealthy()
        }
        assertOwnerTouchCountersZero(state.read())

        if (result.result === "RETRYABLE_PROVIDER_WALL") {
          const providerRetryCount = (cp.metadata.providerRetryCount ?? 0) + 1
          if (providerRetryCount >= MAX_PROVIDER_REDISPATCHES) {
            const retryAfter = new Date(now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
            cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, {
              providerRetryCount, threadId: null, turnId: null,
              ...consumedTurnResultMetadata(),
            })
            if (!await deferOutcome({
              outcomeId: outcome.id, ...queueSettlementContext(outcome), retryAfter,
            })) {
              throw Object.assign(new Error("Provider-unavailable outcome could not be deferred"), { code: "HERMES_PROVIDER_SETTLEMENT_WALL" })
            }
            await deferLease({
              idempotencyKey: `${outcomeId}:defer:PROVIDER_UNAVAILABLE:${retryAfter}`,
              outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
            })
            return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
          }
          cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null, {
            providerRetryCount, threadId: null, turnId: null,
            ...consumedTurnResultMetadata(),
          })
          await abandonLease({
            idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:${cp.checkpointSequence}`,
            outcomeId, holderId, fencingToken: lease.fencingToken,
            reason: result.nextState ?? "RETRYABLE_PROVIDER_WALL",
          })
          return { result: result.result, outcomeId, nextState: result.nextState ?? null }
        }

        if (["OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"].includes(result.result)) {
          const decisionPacket = result.result === "OWNER_DECISION_REQUIRED"
            ? ownerDecisionPacket(result)
            : null
          cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null, {
            ownerDecisionPacket: decisionPacket,
            ownerDecisionId: null,
            ownerDecisionRef: null,
            ownerDecisionRequestKey: null,
            ownerDecisionNextState: null,
            ownerDecisionResumePhase: null,
            ownerDecisionWorkOrderId: null,
            ownerDecisionTerminalEventId: null,
            ownerDecisionPacketDigest: null,
            ...consumedTurnResultMetadata(),
          })
          sequence = cp.checkpointSequence
          await markTerminal({
            outcomeId: outcome.id,
            ...queueSettlementContext(outcome),
            result: result.result,
            nextState: result.nextState ?? null,
            ...(decisionPacket ? { metadata: decisionPacket } : {}),
          })
          await releaseLease({
            idempotencyKey: `${outcomeId}:release:${result.result}:${lease.fencingToken}`,
            outcomeId, holderId, fencingToken: lease.fencingToken,
          })
          return { result: result.result, outcomeId, nextState: result.nextState ?? null }
        }
        if (result.result !== "READY_FOR_VALIDATION" || result.commit !== null || result.prUrl !== null
          || result.merged || result.mergeCommit !== null || result.ownerTouchCount !== 0
          || result.blockedScopeCrossed || result.reviewThreads !== 0) {
          throw Object.assign(new Error("Codex result did not satisfy the file handoff contract"), { code: "HERMES_COMPLETION_GATE_WALL" })
        }

        const workingPaths = await lifecycle.inspectWorkingTreePaths(record)
        if (workingPaths.length === 0) {
          throw Object.assign(new Error("Codex handoff contained no file changes"), { code: "HERMES_COMPLETION_GATE_WALL" })
        }
        assertChangedPathsAllowed(workingPaths, reservations)
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_STARTED", null, {
          validationEvidence: null,
          headRefOid: null,
          ...consumedTurnResultMetadata(),
        })
        sequence = cp.checkpointSequence
        let validation
        try {
          validation = await runDeterministicValidation(workingPaths)
          await assertLeaseProjectionHealthy()
        } catch (error) {
          if (error?.code !== "HERMES_VALIDATION_FAILED" || !error?.validation) throw error
          if (remediationRound >= MAX_REMEDIATION_ROUNDS) {
            return finalizeTerminal({
              lease, sequence, outcome, nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
            })
          }
          const detail = `${error.validation.command} ${error.validation.args.join(" ")} exited ${error.validation.code}\n${error.validation.output}`
            .slice(0, 4_000)
          cp = await checkpoint(lease, sequence, "VALIDATION_REMEDIATION_REQUIRED", null, {
            validationFailure: detail, validationRemediationRound: remediationRound + 1,
            validationEvidence: null,
            validationRecoveryPhase: durableValidationRecoveryFencingToken === null
              ? null
              : "VALIDATION_REMEDIATION",
            validationRecoveryFencingToken: durableValidationRecoveryFencingToken,
          })
          sequence = cp.checkpointSequence
          pendingValidationFailure = detail
          deliveryPrompt = buildValidationRemediationPrompt({
            workOrderId: workOrderRef, branch,
            outcome: outcome.command, reservations, validation: detail,
          })
          continue
        }
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_PASSED", null, {
          validationEvidence: validation, validationFailure: "", validationRemediationRound: 0,
          headRefOid: null, validationRecoveryPhase: null,
          validationRecoveryFencingToken: null,
        })
        sequence = cp.checkpointSequence

        const committed = await lifecycle.commitChanges({
          ...record,
          paths: workingPaths,
          message: `feat(williamos): deliver ${safeLeaf(outcomeRef(outcome))}`,
        })
        cp = await checkpoint(lease, sequence, "COMMIT_CREATED", committed.commit, {
          headRefOid: committed.commit, remediationRound,
        })
        sequence = cp.checkpointSequence
        pendingFindings = []
        const advanced = await advanceCommittedHead({
          lease, sequence, outcome, branch, reservations, record,
          commit: committed.commit, remediationRound,
          assertLeaseProjectionHealthy, quiesceLeaseRenewal,
        })
        if (advanced.kind === "REMEDIATION") {
          pendingFindings = advanced.findings
          sequence = advanced.sequence
          deliveryPrompt = buildRemediationPrompt({
            workOrderId: workOrderRef, branch,
            outcome: outcome.command, reservations, findings: pendingFindings,
          })
          continue
        }
        return advanced.result
      }
      throw Object.assign(new Error("Review remediation budget exhausted"), { code: "HERMES_REVIEW_REMEDIATION_WALL" })
    } catch (error) {
      const rejectedTurnResult = [
        "HERMES_EMPTY_RESULT_WALL",
        "HERMES_RESULT_PARSE_WALL",
        "HERMES_RESULT_FORMAT_WALL",
        "INVALID_TURN_RESULT",
        "TURN_RESULT_SECRET_WALL",
        "HERMES_COMPLETION_GATE_WALL",
      ].includes(error?.code)
      if (ownerDecisionResume && rejectedTurnResult
        && cp?.metadata?.ownerDecisionResumePhase === "PENDING") {
        try {
          cp = await checkpoint(
            lease,
            sequence,
            "CODEX_TURN_RESULT_REJECTED",
            error.code,
            {
              ownerDecisionResumePhase: "CONSUMED",
              ...consumedTurnResultMetadata(),
            },
          )
          sequence = cp.checkpointSequence
        } catch {}
      }
      const externalToolWall = error?.code === "APP_SERVER_EXTERNAL_TOOL_WALL"
      const postMergeCleanupWall = error?.code === "HERMES_POST_MERGE_CLEANUP_WALL"
      const runtimeProjectionWall = error?.code === "HERMES_RUNTIME_PROJECTION_WALL"
      const consumedOwnerDecisionParseWall = rejectedTurnResult
        && cp?.metadata?.ownerDecisionResumePhase === "CONSUMED"
      const ownerDecisionPacketWall = error?.code === "HERMES_OWNER_DECISION_PACKET_WALL"
      if (postMergeCleanupWall) {
        const terminal = await settlePostMergeCleanupFailure({ lease, outcome, error })
        if (terminal) return terminal
        throw error
      }
      if (error?.code === "HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL") {
        try {
          cp = await checkpoint(
            lease,
            sequence,
            "OWNER_DECISION_THREAD_RECOVERY_WALL",
            cp?.metadata?.threadId ?? null,
          )
          sequence = cp.checkpointSequence
          await abandonLease({
            idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:owner-thread-recovery:${sequence}`,
            outcomeId,
            holderId,
            fencingToken: lease.fencingToken,
            reason: error.code,
          })
        } catch {}
        throw error
      }
      if (RECOVERABLE_DELIVERY_WALLS.has(error?.code)) {
        const retryAfter = new Date(now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
        cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, {
          threadId: null,
          turnId: null,
          ...consumedTurnResultMetadata(),
        })
        sequence = cp.checkpointSequence
        try {
          if (!await deferOutcome({
            outcomeId: outcome.id,
            ...queueSettlementContext(outcome),
            retryAfter,
          })) {
            throw Object.assign(new Error("Delivery-continuity outcome could not be deferred"), {
              code: "HERMES_PROVIDER_SETTLEMENT_WALL",
            })
          }
          await deferLease({
            idempotencyKey: `${outcomeId}:defer:${error.code}:${retryAfter}`,
            outcomeId,
            holderId,
            fencingToken: lease.fencingToken,
            retryAfter,
          })
        } catch (settlementError) {
          try {
            await abandonLease({
              idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:delivery-continuity`,
              outcomeId,
              holderId,
              fencingToken: lease.fencingToken,
              reason: "HERMES_PROVIDER_SETTLEMENT_WALL",
            })
          } catch {}
          throw settlementError
        }
        return {
          result: "PROVIDER_UNAVAILABLE",
          outcomeId,
          nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
          reasonCode: error.code,
          retryAfter,
        }
      }
      const externalToolRetryCount = externalToolWall
        ? (cp?.metadata?.externalToolRetryCount ?? 0) + 1
        : cp?.metadata?.externalToolRetryCount ?? 0
      if (externalToolWall && externalToolRetryCount >= MAX_PROVIDER_REDISPATCHES) {
        const retryAfter = new Date(now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
        cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, {
          externalToolRetryCount, threadId: null, turnId: null,
        })
        if (!await deferOutcome({
          outcomeId: outcome.id, ...queueSettlementContext(outcome), retryAfter,
        })) {
          throw Object.assign(new Error("External-tool wall outcome could not be deferred"), {
            code: "HERMES_PROVIDER_SETTLEMENT_WALL",
          })
        }
        await deferLease({
          idempotencyKey: `${outcomeId}:defer:EXTERNAL_TOOL_WALL:${retryAfter}`,
          outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
        })
        return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
      }
      try {
        cp = await checkpoint(lease, sequence, "RETRYABLE_WALL", retryableWallDetail(error),
          externalToolWall ? { externalToolRetryCount, threadId: null, turnId: null } : {})
        sequence = cp.checkpointSequence
      } catch {}
      if (cp?.state === "PROVIDER_UNAVAILABLE"
        || runtimeProjectionWall
        || rejectedTurnResult
        || consumedOwnerDecisionParseWall
        || ownerDecisionPacketWall
        || ["APP_SERVER_TURN_INTERRUPTED", "APP_SERVER_TURN_FAILED", "APP_SERVER_TIMEOUT", "APP_SERVER_EXTERNAL_TOOL_WALL", "HERMES_PROVIDER_SETTLEMENT_WALL"].includes(error?.code)) {
        try {
          await abandonLease({
            idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:${sequence}`,
            outcomeId, holderId, fencingToken: lease.fencingToken,
            reason: error?.code ?? "HERMES_PROVIDER_SETTLEMENT_WALL",
          })
        } catch {}
      }
      throw error
    } finally {
      if (renewal) clearInterval(renewal)
      client.close()
    }
  }

  return Object.freeze({
    cycle, state, runtimeRoot, statePath, activationPath, notBeforePath,
    abandonOwnedCycleLease, recoverOrphanedValidationCycleLease,
  })
}
