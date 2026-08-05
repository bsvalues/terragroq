import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { CodexAppServerClient, sanitizeAppServerText } from "./app-server-client.mjs"
import { createHermesOrchestrator } from "./orchestrator.mjs"
import { createHermesOutcomeQueueRuntime } from "./outcome-queue-runtime.mjs"
import {
  NATIVE_PROVIDER_RETRY_STATE,
  VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  projectOutcomeRuntimeCheckpoint,
  recordValidationInfrastructureRecoveryProof,
  recoverNativeProviderOutcome,
  recoverReviewedOutcome,
  recoverTerminalPostMergeCleanupOutcome,
  verifyReviewRecoveryProjectionCollision,
  recoverValidationInfrastructureOutcome,
} from "./outcome-source.mjs"
import { createHermesRepositoryLifecycle } from "./repository-lifecycle.mjs"
import { produceRuntimeAgreement } from "./runtime-agreement.mjs"
import { isValidationInfrastructureFailure, readHermesState } from "./state-store.mjs"

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function flushStdout() {
  return new Promise((resolve, reject) => {
    process.stdout.write("", (error) => error ? reject(error) : resolve())
  })
}

function boundedReviewRemediationFiles(files, expectedDigest) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 20) return false
  const allowed = /^(?:app\/|components\/|lib\/|scripts\/hermes-bridge\/|tests\/)/
  const blocked = /(?:^|\/)(?:\.github|prisma|migrations?|runtime-operator|multi-agent-operator|terraform|terrafusion|pacs|county)(?:\/|$)|(?:^|\/)(?:package(?:-lock)?\.json|vercel\.json|\.env(?:\.|$))/i
  const normalized = [...files].sort()
  return typeof expectedDigest === "string"
    && /^[0-9a-f]{64}$/.test(expectedDigest)
    && sha256(JSON.stringify(normalized)) === expectedDigest
    && normalized.every((file) => typeof file === "string" && allowed.test(file) && !blocked.test(file))
}

export function sanitizeBridgeMessage(value) {
  return sanitizeAppServerText(String(value ?? ""))
    .replace(/\bpostgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
}

const STATUS_CAPABILITY_FIELDS = new Set([
  "leaseToken",
  "executionBinding",
  "acquisitionKey",
])

export function redactHermesStatus(value) {
  if (Array.isArray(value)) return value.map(redactHermesStatus)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !STATUS_CAPABILITY_FIELDS.has(key))
    .map(([key, entry]) => [key, redactHermesStatus(entry)]))
}

export function createResidentHermesOrchestrator(options = {}) {
  const queueRuntime = options.queueRuntime ?? createHermesOutcomeQueueRuntime()
  const orchestrator = createHermesOrchestrator({
    workspace: options.workspace ?? process.cwd(),
    ...(options.orchestratorOptions ?? {}),
    selectOutcome: queueRuntime.selectOutcome,
    markComplete: queueRuntime.completeOutcome,
    markTerminal: queueRuntime.terminalizeOutcome,
    deferOutcome: queueRuntime.deferOutcome,
    renewQueueLease: queueRuntime.renewOutcomeLease,
    bindQueueWorkOrder: queueRuntime.bindWorkOrder,
    refreshQueueOutcome: queueRuntime.refreshOutcome,
    resumeQueueAfterDecision: queueRuntime.resumeAfterOwnerDecision,
    resumeQueueAfterValidationRecovery: queueRuntime.resumeAfterValidationRecovery,
  })
  return Object.freeze({
    ...orchestrator,
    close: queueRuntime.close,
  })
}

export async function runHermesQueueDrain({ orchestrator, maxOutcomes = 100 } = {}) {
  if (!orchestrator || !Number.isInteger(maxOutcomes) || maxOutcomes <= 0) {
    throw Object.assign(new Error("Hermes queue drain input is invalid"), {
      code: "HERMES_QUEUE_DRAIN_INPUT_WALL",
    })
  }
  const settled = []
  try {
    for (let index = 0; index < maxOutcomes; index += 1) {
      const result = await orchestrator.cycle()
      if (!["COMPLETE", "FAILED_TERMINAL"].includes(result.result)) {
        if (settled.length === 0) return result
        return {
          result: "QUEUE_DRAINED",
          settled,
          stopReason: result.result,
          ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
        }
      }
      settled.push({
        result: result.result,
        outcomeId: result.outcomeId,
        ...(result.prNumber ? { prNumber: result.prNumber } : {}),
        ...(result.mergeSha ? { mergeSha: result.mergeSha } : {}),
        ...(result.nextState ? { nextState: result.nextState } : {}),
      })
    }
    throw Object.assign(new Error("Hermes queue drain exceeded its bounded outcome budget"), {
      code: "HERMES_QUEUE_DRAIN_BUDGET_WALL",
      settled,
    })
  } finally {
    try {
      await orchestrator.abandonOwnedCycleLease?.()
    } catch {
      // The local fence is already abandoned before projection; preserve the primary drain outcome.
    }
  }
}

export async function captureRuntimeAgreement(options = {}) {
  const runtimeRoot = path.resolve(
    options.runtimeRoot
      ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT
      ?? path.join(os.homedir(), ".williamos", "hermes-bridge"),
  )
  const producer = options.producer ?? produceRuntimeAgreement
  return producer({
    statePath: path.join(runtimeRoot, "state", "state.json"),
    outputPath: path.join(runtimeRoot, "evidence", "queue-runtime-agreement.json"),
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    query: options.query,
    createPool: options.createPool,
    now: options.now,
  })
}

async function smoke() {
  const client = new CodexAppServerClient({ cwd: process.cwd(), timeoutMs: 180_000 })
  try {
    await client.connect()
    const threadId = await client.startThread({
      cwd: process.cwd(), approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
    })
    const result = await client.runTurn({
      threadId,
      prompt: "Read-only Hermes transport proof. Do not use tools or modify files. Reply exactly HERMES_APP_SERVER_READY.",
      timeoutMs: 180_000,
    })
    if (result.status !== "completed" || result.finalText.trim() !== "HERMES_APP_SERVER_READY") {
      throw Object.assign(new Error("Hermes App Server smoke response mismatch"), { code: "HERMES_SMOKE_WALL" })
    }
    return { result: "PASS", transport: "CODEX_APP_SERVER_STDIO", rejectedIssue357Reused: false }
  } finally {
    client.close()
  }
}

async function recoverNativeProviderWall() {
  const orchestrator = createResidentHermesOrchestrator()
  const state = orchestrator.state.read()
  const candidates = Object.values(state.executions).filter((execution) => (
    execution?.lease?.status === "RELEASED"
    && execution?.checkpoint?.state === "FAILED_TERMINAL"
    && execution?.checkpoint?.detail === NATIVE_PROVIDER_RETRY_STATE
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one native provider wall is required"), { code: "HERMES_PROVIDER_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const outcomeId = Number(candidate.outcomeId)
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("Native provider outcome id is invalid"), { code: "HERMES_PROVIDER_RECOVERY_OUTCOME_WALL" })
  }
  if (!await recoverNativeProviderOutcome({ outcomeId })) {
    throw Object.assign(new Error("Persisted native provider outcome did not match recovery evidence"), { code: "HERMES_PROVIDER_RECOVERY_DATABASE_WALL" })
  }
  const reopened = orchestrator.state.reopenProviderWall({
    idempotencyKey: `${candidate.outcomeId}:recover-native-provider:${candidate.fencingToken}`,
    outcomeId: candidate.outcomeId,
    expectedFencingToken: candidate.fencingToken,
    expectedDetail: NATIVE_PROVIDER_RETRY_STATE,
  })
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, checkpointSequence: reopened.checkpointSequence }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function recoverValidationInfrastructureWall(options = {}) {
  const orchestrator = options.orchestrator ?? createResidentHermesOrchestrator()
  const recordProof = options.recordProof ?? recordValidationInfrastructureRecoveryProof
  const recoverOutcome = options.recoverOutcome ?? recoverValidationInfrastructureOutcome
  const state = orchestrator.state.read()
  const ownerTouchesRemainZero = Object.values(state.ownerTouchCounters).every((value) => value === 0)
  if (!ownerTouchesRemainZero) {
    throw Object.assign(new Error("Owner-touch counters must remain zero"), { code: "HERMES_VALIDATION_RECOVERY_OWNER_TOUCH_WALL" })
  }
  const candidates = Object.values(state.executions).filter((execution) => (
    (execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "FAILED_TERMINAL"
      && execution?.checkpoint?.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
      && isValidationInfrastructureFailure(execution?.metadata?.validationFailure))
    || (execution?.lease?.status === "ABANDONED"
      && execution?.checkpoint?.state === "VALIDATION_INFRASTRUCTURE_RECOVERED"
      && execution?.checkpoint?.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
      && /^[0-9a-f]{64}$/.test(String(execution?.metadata?.validationRecoveryProofDigest ?? "")))
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one validation infrastructure wall is required"), { code: "HERMES_VALIDATION_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const outcomeId = Number(candidate.outcomeId)
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("Validation infrastructure outcome id is invalid"), { code: "HERMES_VALIDATION_RECOVERY_OUTCOME_WALL" })
  }
  let proofDigest = candidate.metadata.validationRecoveryProofDigest
  if (candidate.checkpoint.state === "FAILED_TERMINAL") {
    const validationFailureDigest = sha256(candidate.metadata.validationFailure)
    proofDigest = sha256(JSON.stringify({
      outcomeId: candidate.outcomeId,
      fencingToken: candidate.fencingToken,
      checkpointSequence: candidate.checkpoint.sequence,
      checkpointDetail: candidate.checkpoint.detail,
      validationFailureDigest,
    }))
    orchestrator.state.reopenValidationInfrastructureWall({
      idempotencyKey: `${candidate.outcomeId}:recover-validation-infrastructure:${candidate.fencingToken}`,
      outcomeId: candidate.outcomeId,
      expectedFencingToken: candidate.fencingToken,
      expectedDetail: VALIDATION_INFRASTRUCTURE_RETRY_STATE,
      expectedValidationFailureDigest: validationFailureDigest,
      proofDigest,
    })
  }
  if (!await recordProof({ outcomeId, proofDigest, fencingToken: candidate.fencingToken })) {
    throw Object.assign(new Error("Validation infrastructure proof was not persisted"), { code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL" })
  }
  if (!await recoverOutcome({ outcomeId, proofDigest })) {
    throw Object.assign(new Error("Persisted validation infrastructure outcome did not match recovery evidence"), { code: "HERMES_VALIDATION_RECOVERY_DATABASE_WALL" })
  }
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, proofRecorded: true }
}

export function recoverExternalToolWall(options = {}) {
  const orchestrator = options.orchestrator ?? createResidentHermesOrchestrator()
  const activationPath = path.join(orchestrator.runtimeRoot, "control", "activation")
  const supervisorPath = path.join(orchestrator.runtimeRoot, "state", "supervisor.json")
  const activation = fs.existsSync(activationPath) ? fs.readFileSync(activationPath, "utf8").trim() : "disabled"
  if (activation !== "disabled" || fs.existsSync(supervisorPath)) {
    throw Object.assign(new Error("Supervisor must be stopped before external-tool recovery"), { code: "HERMES_EXTERNAL_TOOL_RECOVERY_SUPERVISOR_WALL" })
  }
  const state = orchestrator.state.read()
  const candidates = Object.values(state.executions).filter((execution) => (
    execution?.lease?.status === "ACTIVE"
    && execution?.checkpoint?.state === "RETRYABLE_WALL"
    && execution?.checkpoint?.detail === "APP_SERVER_EXTERNAL_TOOL_WALL"
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one external-tool wall is required"), { code: "HERMES_EXTERNAL_TOOL_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const recovered = orchestrator.state.recoverExternalToolWall({
    idempotencyKey: `${candidate.outcomeId}:recover-external-tool:${candidate.fencingToken}`,
    outcomeId: candidate.outcomeId,
    expectedFencingToken: candidate.fencingToken,
    expectedHolderId: candidate.lease.holderId,
    activationDisabled: true,
  })
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, checkpointSequence: recovered.checkpointSequence }
}

export function recoverPostMergeCleanupWall(options = {}) {
  const orchestrator = options.orchestrator ?? createResidentHermesOrchestrator()
  const activationPath = path.join(orchestrator.runtimeRoot, "control", "activation")
  const supervisorPath = path.join(orchestrator.runtimeRoot, "state", "supervisor.json")
  const activation = fs.existsSync(activationPath) ? fs.readFileSync(activationPath, "utf8").trim() : "disabled"
  if (activation !== "disabled" || fs.existsSync(supervisorPath)) {
    throw Object.assign(new Error("Supervisor must be stopped before post-merge recovery"), { code: "HERMES_POST_MERGE_RECOVERY_SUPERVISOR_WALL" })
  }
  const candidates = Object.values(orchestrator.state.read().executions).filter((execution) => (
    execution?.lease?.status === "ACTIVE"
    && execution?.checkpoint?.state === "PR_MERGED"
    && Number.isInteger(execution?.metadata?.prNumber)
    && /^[0-9a-f]{40}$/.test(execution?.metadata?.headRefOid ?? "")
    && /^[0-9a-f]{40}$/.test(execution?.metadata?.mergeSha ?? "")
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one post-merge cleanup wall is required"), { code: "HERMES_POST_MERGE_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const recovered = orchestrator.state.recoverPostMergeCleanupWall({
    idempotencyKey: `${candidate.outcomeId}:recover-post-merge:${candidate.fencingToken}`,
    outcomeId: candidate.outcomeId,
    expectedFencingToken: candidate.fencingToken,
    expectedHolderId: candidate.lease.holderId,
    activationDisabled: true,
  })
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, checkpointSequence: recovered.checkpointSequence }
}

export async function recoverTerminalPostMergeCleanupWall(options = {}) {
  const orchestrator = options.orchestrator ?? createResidentHermesOrchestrator()
  const lifecycle = options.lifecycle ?? createHermesRepositoryLifecycle({
    workspaceRoot: process.cwd(),
    ownedWorktreeRoot: path.join(orchestrator.runtimeRoot, "worktrees"),
  })
  const projectCheckpoint = options.projectCheckpoint ?? projectOutcomeRuntimeCheckpoint
  const recoverOutcome = options.recoverOutcome ?? recoverTerminalPostMergeCleanupOutcome
  const activationPath = path.join(orchestrator.runtimeRoot, "control", "activation")
  const supervisorPath = path.join(orchestrator.runtimeRoot, "state", "supervisor.json")
  const assertContained = () => {
    const activation = fs.existsSync(activationPath) ? fs.readFileSync(activationPath, "utf8").trim() : "disabled"
    if (activation !== "disabled" || fs.existsSync(supervisorPath)) {
      throw Object.assign(new Error("Supervisor must be stopped before terminal post-merge recovery"), {
        code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_SUPERVISOR_WALL",
      })
    }
  }
  assertContained()
  const state = orchestrator.state.read()
  const ownerTouchesRemainZero = Object.values(state.ownerTouchCounters).every((value) => value === 0)
  const candidates = Object.values(state.executions).filter((execution) => (
    ((execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "FAILED_TERMINAL"
      && execution?.checkpoint?.detail === "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
      && execution?.metadata?.postMergeCleanupRetryCount === 3)
    || (execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "POST_MERGE_CLEANUP_TERMINAL_RECOVERY_PENDING"
      && execution?.checkpoint?.detail === "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED")
    || (execution?.lease?.status === "ABANDONED"
      && execution?.checkpoint?.state === "POST_MERGE_CLEANUP_RECOVERED"
      && /^PR #\d+$/.test(execution?.checkpoint?.detail ?? "")))
    && Number.isInteger(execution?.metadata?.prNumber)
    && /^[0-9a-f]{40}$/.test(execution?.metadata?.headRefOid ?? "")
    && /^[0-9a-f]{40}$/.test(execution?.metadata?.mergeSha ?? "")
    && typeof execution?.metadata?.branch === "string"
    && typeof execution?.metadata?.worktreePath === "string"
  ))
  if (!ownerTouchesRemainZero || candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one zero-touch terminal post-merge cleanup wall is required"), {
      code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_CANDIDATE_WALL",
    })
  }
  const candidate = candidates[0]
  const recoveredOutcome = candidate.metadata.outcome
  if (!recoveredOutcome || String(recoveredOutcome.id) !== String(candidate.outcomeId)) {
    throw Object.assign(new Error("Persisted outcome snapshot does not match terminal cleanup evidence"), {
      code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_OUTCOME_WALL",
    })
  }
  const pr = await lifecycle.inspectPullRequest(candidate.metadata.prNumber)
  if (pr.state !== "MERGED"
    || pr.baseRefName !== "main"
    || pr.headRefName !== candidate.metadata.branch
    || pr.headRefOid !== candidate.metadata.headRefOid
    || pr.mergeCommit?.oid !== candidate.metadata.mergeSha
    || pr.unresolvedThreadCount !== 0
    || !await lifecycle.verifyOriginMainContains(candidate.metadata.mergeSha)) {
    throw Object.assign(new Error("Merged PR identity does not match terminal cleanup evidence"), {
      code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_PR_WALL",
    })
  }
  const proofDigest = sha256(JSON.stringify({
    repository: "bsvalues/terragroq",
    outcomeId: String(candidate.outcomeId),
    prNumber: candidate.metadata.prNumber,
    branch: candidate.metadata.branch,
    worktreePath: path.resolve(candidate.metadata.worktreePath),
    headRefOid: candidate.metadata.headRefOid,
    mergeSha: candidate.metadata.mergeSha,
    unresolvedThreadCount: pr.unresolvedThreadCount,
    originMainContainsMerge: true,
    recoveryMode: "TERMINAL_POST_MERGE_CLEANUP",
  }))
  const pending = candidate.checkpoint.state === "POST_MERGE_CLEANUP_TERMINAL_RECOVERY_PENDING"
  const alreadyRecovered = candidate.checkpoint.state === "POST_MERGE_CLEANUP_RECOVERED"
  if ((pending || alreadyRecovered)
    && candidate.metadata.terminalCleanupRecoveryProofDigest !== proofDigest) {
    throw Object.assign(new Error("Terminal cleanup recovery proof changed"), {
      code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_PROOF_WALL",
    })
  }
  const reservation = pending || alreadyRecovered
    ? { checkpointSequence: candidate.checkpoint.sequence }
    : orchestrator.state.beginTerminalPostMergeCleanupRecovery({
        idempotencyKey: `${candidate.outcomeId}:begin-terminal-post-merge:${candidate.fencingToken}`,
        outcomeId: candidate.outcomeId,
        expectedFencingToken: candidate.fencingToken,
        expectedCheckpointSequence: candidate.checkpoint.sequence,
        activationDisabled: true,
        prNumber: candidate.metadata.prNumber,
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
        headRefOid: candidate.metadata.headRefOid,
        mergeSha: candidate.metadata.mergeSha,
        proofDigest,
      })
  assertContained()
  if (!alreadyRecovered) {
    if (fs.existsSync(candidate.metadata.worktreePath)) {
      await lifecycle.resumeOwnedWorktree({
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
      })
      await lifecycle.removeTerminalRecoveryDependencies({
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
        expectedHeadSha: candidate.metadata.headRefOid,
      })
    }
    await lifecycle.cleanupOwnedWorktree({
      branch: candidate.metadata.branch,
      worktreePath: candidate.metadata.worktreePath,
      mergeCommitSha: candidate.metadata.mergeSha,
      expectedHeadSha: candidate.metadata.headRefOid,
    })
  }
  assertContained()
  const reopened = alreadyRecovered
    ? reservation
    : orchestrator.state.finalizeTerminalPostMergeCleanupRecovery({
        idempotencyKey: `${candidate.outcomeId}:finalize-terminal-post-merge:${candidate.fencingToken}`,
        outcomeId: candidate.outcomeId,
        expectedFencingToken: candidate.fencingToken,
        expectedCheckpointSequence: reservation.checkpointSequence,
        activationDisabled: true,
        prNumber: candidate.metadata.prNumber,
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
        headRefOid: candidate.metadata.headRefOid,
        mergeSha: candidate.metadata.mergeSha,
        proofDigest,
      })
  await projectCheckpoint({
    outcomeId: Number(candidate.outcomeId),
    attempt: candidate.fencingToken,
    checkpoint: {
      sequence: reopened.checkpointSequence,
      state: "POST_MERGE_CLEANUP_RECOVERED",
      detail: `PR #${candidate.metadata.prNumber}`,
      metadata: {
        prNumber: candidate.metadata.prNumber,
        headRefOid: candidate.metadata.headRefOid,
        mergeSha: candidate.metadata.mergeSha,
        terminalCleanupRecoveryProofDigest: proofDigest,
      },
    },
  })
  if (!await recoverOutcome({
    outcomeId: Number(candidate.outcomeId),
    prNumber: candidate.metadata.prNumber,
    reviewedHeadSha: candidate.metadata.headRefOid,
    mergeSha: candidate.metadata.mergeSha,
    proofDigest,
  })) {
    throw Object.assign(new Error("Persisted terminal cleanup outcome did not match recovery evidence"), {
      code: "HERMES_TERMINAL_POST_MERGE_RECOVERY_DATABASE_WALL",
    })
  }
  return {
    result: "RECOVERED",
    outcomeId: candidate.outcomeId,
    prNumber: candidate.metadata.prNumber,
    mergeSha: candidate.metadata.mergeSha,
    checkpointSequence: reopened.checkpointSequence,
  }
}

export async function recoverReviewedMerge(options = {}) {
  const orchestrator = options.orchestrator ?? createResidentHermesOrchestrator()
  const lifecycle = options.lifecycle ?? createHermesRepositoryLifecycle({
    workspaceRoot: process.cwd(),
    ownedWorktreeRoot: path.join(orchestrator.runtimeRoot, "worktrees"),
  })
  const projectCheckpoint = options.projectCheckpoint ?? projectOutcomeRuntimeCheckpoint
  const recoverOutcome = options.recoverOutcome ?? recoverReviewedOutcome
  const verifyProjectionCollision = options.verifyProjectionCollision
    ?? verifyReviewRecoveryProjectionCollision
  const state = orchestrator.state.read()
  const ownerTouchesRemainZero = Object.values(state.ownerTouchCounters).every((value) => value === 0)
  const candidates = Object.values(state.executions).filter((execution) => (
    ((execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "FAILED_TERMINAL"
      && execution?.checkpoint?.detail === "REVIEW_REMEDIATION_EXHAUSTED")
    || (execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "REVIEW_REMEDIATION_RECOVERY_PENDING"
      && execution?.checkpoint?.detail === "REVIEW_REMEDIATION_EXHAUSTED")
    || (execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "PR_MERGED"
      && /^Recovered (?:reviewed )?PR #\d+(?: through reviewed remediation chain)?$/
        .test(execution?.checkpoint?.detail ?? ""))
    || (execution?.lease?.status === "ABANDONED"
      && execution?.checkpoint?.state === "REVIEW_REMEDIATION_RECOVERED"
      && execution?.checkpoint?.detail === "REVIEW_REMEDIATION_EXHAUSTED"))
    && Number.isInteger(execution?.metadata?.prNumber)
  ))
  if (!ownerTouchesRemainZero || candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one zero-touch review recovery candidate is required"), {
      code: "HERMES_REVIEW_RECOVERY_CANDIDATE_WALL",
    })
  }
  const candidate = candidates[0]
  const outcomeId = Number(candidate.outcomeId)
  const recoveredOutcome = candidate.metadata?.outcome
  if (!recoveredOutcome || String(recoveredOutcome.id) !== String(candidate.outcomeId)) {
    throw Object.assign(new Error("Recovery candidate is missing its exact outcome"), {
      code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
    })
  }
  const pr = await lifecycle.inspectPullRequest(candidate.metadata.prNumber)
  const reviewedHeadSha = pr.headRefOid
  const mergeSha = pr.mergeCommit?.oid
  const recoveryPending = candidate.checkpoint.state === "REVIEW_REMEDIATION_RECOVERY_PENDING"
  const mergeRecorded = candidate.checkpoint.state === "PR_MERGED"
  const alreadyReopened = candidate.checkpoint.state === "REVIEW_REMEDIATION_RECOVERED"
  const expectedPriorHeadRefOid = recoveryPending || mergeRecorded || alreadyReopened
    ? candidate.metadata.reviewRecoveryPriorHeadRefOid
    : candidate.metadata.headRefOid
  if (pr.state !== "MERGED" || pr.baseRefName !== "main" || pr.unresolvedThreadCount !== 0
    || pr.headRefName !== candidate.metadata.branch
    || !/^[0-9a-f]{40}$/.test(expectedPriorHeadRefOid ?? "")
    || !/^[0-9a-f]{40}$/.test(reviewedHeadSha ?? "")
    || !/^[0-9a-f]{40}$/.test(mergeSha ?? "")
    || !await lifecycle.verifyOriginMainContains(mergeSha)) {
    throw Object.assign(new Error("Reviewed merge proof is incomplete"), {
      code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
    })
  }
  const directReviewProof = pr.checksGreen === true && pr.reviewed === true
  const rateLimitedReviewOnly = pr.codeRabbitRateLimited === true
    && Array.isArray(pr.failedChecks) && pr.failedChecks.length === 0
    && Array.isArray(pr.pendingChecks) && pr.pendingChecks.length > 0
    && pr.pendingChecks.every((check) => /coderabbit/i.test(check.name))
  const remediationProof = []
  const claims = typeof lifecycle.inspectReviewRemediationClaims === "function"
    ? await lifecycle.inspectReviewRemediationClaims(candidate.metadata.prNumber)
    : []
  const useRemediationChain = Array.isArray(claims) && claims.length > 0
  if (useRemediationChain) {
    if ((!directReviewProof && !rateLimitedReviewOnly)
      || typeof lifecycle.inspectRemediationPullRequest !== "function"
      || typeof lifecycle.inspectPullRequestFiles !== "function") {
      throw Object.assign(new Error("Reviewed merge proof is incomplete"), {
        code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
      })
    }
    for (const claim of claims) {
      const remediation = await lifecycle.inspectRemediationPullRequest(claim.prNumber)
      const files = await lifecycle.inspectPullRequestFiles(claim.prNumber)
      const nestedClaims = await lifecycle.inspectReviewRemediationClaims(claim.prNumber)
      if (claim.prNumber <= candidate.metadata.prNumber
        || remediation.state !== "MERGED" || remediation.baseRefName !== "main"
        || remediation.headRefOid !== claim.headRefOid
        || remediation.mergeCommit?.oid !== claim.mergeSha
        || remediation.unresolvedThreadCount !== 0
        || remediation.checksGreen !== true || remediation.reviewed !== true
        || !boundedReviewRemediationFiles(files, claim.filesDigest)
        || !Array.isArray(nestedClaims) || nestedClaims.length !== 0
        || typeof lifecycle.verifyCommitAncestor !== "function"
        || !await lifecycle.verifyCommitAncestor(mergeSha, claim.mergeSha)
        || !await lifecycle.verifyOriginMainContains(claim.mergeSha)) {
        throw Object.assign(new Error("Reviewed remediation chain proof is incomplete"), {
          code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
        })
      }
      remediationProof.push({
        threadIds: claim.threadIds,
        prNumber: claim.prNumber,
        headRefOid: claim.headRefOid,
        mergeSha: claim.mergeSha,
        filesDigest: claim.filesDigest,
        files,
      })
    }
  } else if (!directReviewProof) {
    throw Object.assign(new Error("Reviewed merge proof is incomplete"), {
      code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
    })
  }
  const proofDigest = sha256(JSON.stringify({
    outcomeId,
    prNumber: candidate.metadata.prNumber,
    reviewedHeadSha,
    mergeSha,
    unresolvedThreadCount: pr.unresolvedThreadCount,
    reviewMode: useRemediationChain ? "REMEDIATION_CHAIN" : "DIRECT",
    checksGreen: useRemediationChain ? null : pr.checksGreen,
    reviewed: useRemediationChain ? null : pr.reviewed,
    remediationProof,
  }))
  if ((recoveryPending || mergeRecorded || alreadyReopened)
    && (candidate.metadata.reviewRecoveryProofDigest !== proofDigest
      || candidate.metadata.mergeSha !== mergeSha
      || candidate.metadata.headRefOid !== reviewedHeadSha)) {
    throw Object.assign(new Error("Reopened review recovery proof changed"), {
      code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
    })
  }
  const reservation = recoveryPending || mergeRecorded || alreadyReopened
    ? { checkpointSequence: candidate.checkpoint.sequence }
    : orchestrator.state.beginReviewRemediationRecovery({
      idempotencyKey: `${candidate.outcomeId}:begin-reviewed-merge-recovery:${candidate.fencingToken}`,
      outcomeId: candidate.outcomeId,
      expectedFencingToken: candidate.fencingToken,
      prNumber: candidate.metadata.prNumber,
      expectedPriorHeadRefOid,
      headRefOid: reviewedHeadSha,
      mergeSha,
      proofDigest,
    })
  const reviewedMergeDetail = remediationProof.length > 0
    ? `Recovered PR #${candidate.metadata.prNumber} through reviewed remediation chain`
    : `Recovered reviewed PR #${candidate.metadata.prNumber}`
  const mergedReservation = alreadyReopened
    ? null
    : mergeRecorded
      ? reservation
      : orchestrator.state.recordReviewRemediationMerge({
          idempotencyKey: `${candidate.outcomeId}:record-reviewed-merge:${candidate.fencingToken}`,
          outcomeId: candidate.outcomeId,
          expectedFencingToken: candidate.fencingToken,
          prNumber: candidate.metadata.prNumber,
          headRefOid: reviewedHeadSha,
          mergeSha,
          proofDigest,
          mergeDetail: reviewedMergeDetail,
        })
  if (!alreadyReopened) {
    await projectCheckpoint({
      outcomeId,
      attempt: candidate.fencingToken,
      checkpoint: {
        sequence: mergedReservation.checkpointSequence,
        state: "PR_MERGED",
        detail: reviewedMergeDetail,
        metadata: {
          prNumber: candidate.metadata.prNumber,
          headRefOid: reviewedHeadSha,
          mergeSha,
          remediationPullRequests: remediationProof.map((proof) => proof.prNumber),
        },
      },
    })
    if (!await recoverOutcome({
      outcomeId,
      prNumber: candidate.metadata.prNumber,
      reviewedHeadSha,
      mergeSha,
    })) {
      throw Object.assign(new Error("Persisted review outcome did not match recovery proof"), {
        code: "HERMES_REVIEW_RECOVERY_DATABASE_WALL",
      })
    }
  }
  const reopened = alreadyReopened
    ? { checkpointSequence: candidate.checkpoint.sequence }
    : orchestrator.state.finalizeReviewRemediationRecovery({
      idempotencyKey: `${candidate.outcomeId}:finalize-reviewed-merge-recovery:${candidate.fencingToken}`,
      outcomeId: candidate.outcomeId,
      expectedFencingToken: candidate.fencingToken,
      prNumber: candidate.metadata.prNumber,
      headRefOid: reviewedHeadSha,
      mergeSha,
      proofDigest,
      mergeDetail: reviewedMergeDetail,
    })
  const recoveredProjection = {
    outcomeId,
    attempt: candidate.fencingToken,
    checkpoint: {
      sequence: reopened.checkpointSequence,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
      metadata: {
        prNumber: candidate.metadata.prNumber,
        headRefOid: reviewedHeadSha,
        mergeSha,
        remediationPullRequests: remediationProof.map((proof) => proof.prNumber),
      },
    },
  }
  try {
    await projectCheckpoint(recoveredProjection)
  } catch (error) {
    if (!alreadyReopened || error?.code !== "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT"
      || typeof orchestrator.state.reconcileReviewRemediationProjection !== "function"
      || !await verifyProjectionCollision({
        outcomeId,
        attempt: candidate.fencingToken,
        checkpointSequence: reopened.checkpointSequence,
        checkpointDetail: reviewedMergeDetail,
        prNumber: candidate.metadata.prNumber,
        reviewedHeadSha,
        mergeSha,
      })) {
      throw error
    }
    const reconciled = orchestrator.state.reconcileReviewRemediationProjection({
      idempotencyKey: `${candidate.outcomeId}:reconcile-reviewed-merge-projection:${candidate.fencingToken}:${reopened.checkpointSequence}`,
      outcomeId: candidate.outcomeId,
      expectedFencingToken: candidate.fencingToken,
      expectedCheckpointSequence: reopened.checkpointSequence,
      prNumber: candidate.metadata.prNumber,
      headRefOid: reviewedHeadSha,
      mergeSha,
      proofDigest,
      mergeDetail: reviewedMergeDetail,
    })
    recoveredProjection.checkpoint.sequence = reconciled.checkpointSequence
    await projectCheckpoint(recoveredProjection)
    reopened.checkpointSequence = reconciled.checkpointSequence
  }
  const result = await orchestrator.cycle({ outcome: recoveredOutcome })
  return {
    result: result.result,
    outcomeId: candidate.outcomeId,
    prNumber: candidate.metadata.prNumber,
    mergeSha,
    checkpointSequence: reopened.checkpointSequence,
  }
}

export async function runCli(command = process.argv[2]) {
  let orchestrator = null
  try {
    if (command === "cycle") {
      orchestrator = createResidentHermesOrchestrator()
      print(await runHermesQueueDrain({ orchestrator }))
    }
    else if (command === "smoke") print(await smoke())
    else if (command === "recover-native-provider-wall") print(await recoverNativeProviderWall())
    else if (command === "recover-validation-infrastructure-wall") print(await recoverValidationInfrastructureWall())
    else if (command === "recover-external-tool-wall") print(recoverExternalToolWall())
    else if (command === "recover-post-merge-cleanup-wall") print(recoverPostMergeCleanupWall())
    else if (command === "recover-terminal-post-merge-cleanup-wall") print(await recoverTerminalPostMergeCleanupWall())
    else if (command === "recover-reviewed-merge") print(await recoverReviewedMerge())
    else if (command === "agreement") print(await captureRuntimeAgreement())
    else if (command === "status") {
      orchestrator = createResidentHermesOrchestrator()
      print(redactHermesStatus(
        readHermesState(path.join(orchestrator.runtimeRoot, "state", "state.json")),
      ))
    } else {
      throw Object.assign(new Error("Usage: cli.mjs cycle|smoke|status|agreement|recover-native-provider-wall|recover-validation-infrastructure-wall|recover-external-tool-wall|recover-post-merge-cleanup-wall|recover-terminal-post-merge-cleanup-wall|recover-reviewed-merge"), { code: "HERMES_CLI_USAGE" })
    }
  } catch (error) {
    print({
      result: "WALL",
      code: error?.code ?? "HERMES_CLI_FAILED",
      message: sanitizeBridgeMessage(error?.message ?? "Hermes bridge failed"),
      ...(Array.isArray(error?.settled) ? { settled: error.settled } : {}),
    })
    return 1
  } finally {
    await orchestrator?.close?.()
  }
  return 0
}

export async function runCliEntrypoint(command = process.argv[2], options = {}) {
  const run = options.run ?? runCli
  const flush = options.flush ?? flushStdout
  const exit = options.exit ?? process.exit
  const exitCode = await run(command)
  await flush()
  exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCliEntrypoint()
