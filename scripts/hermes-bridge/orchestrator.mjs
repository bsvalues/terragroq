import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { CodexAppServerClient } from "./app-server-client.mjs"
import {
  completeOutcome,
  deferProviderOutcome,
  projectOutcomeRuntimeCheckpoint,
  selectNextOutcome,
  terminalizeOutcome,
} from "./outcome-source.mjs"
import { evaluateOutcomePolicy } from "./policy.mjs"
import { buildHermesCodexPrompt, HERMES_BLOCKED_SCOPE, HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"
import { createRepositoryLifecycle } from "./repository-lifecycle.mjs"
import { createHermesStateStore } from "./state-store.mjs"

const LEASE_DURATION_MS = 50 * 60 * 1000
const TURN_TIMEOUT_MS = 45 * 60 * 1000
const MAX_PROVIDER_REDISPATCHES = 3
const PROVIDER_RETRY_COOLDOWN_MS = 15 * 60 * 1000
const MAX_REMEDIATION_ROUNDS = 3
const REVIEW_POLL_INTERVAL_MS = 15_000
const REVIEW_POLL_ATTEMPTS = 80
const SHA = /^[0-9a-f]{40}$/

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

export const DEFAULT_VALIDATORS = Object.freeze([
  "npx vitest run focused changed tests",
  ...DEFAULT_VALIDATION_COMMANDS.map((entry) => `${entry.command} ${entry.args.join(" ")}`),
])

const RESERVATIONS = Object.freeze({
  docs: Object.freeze(["docs/**", "tests/**"]),
  ui: Object.freeze(["app/(shell)/**", "components/**", "tests/**", "docs/reports/**"]),
  read_model: Object.freeze(["app/(shell)/**", "components/**", "lib/**", "tests/**", "docs/reports/**"]),
})

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

Remediate every valid finding using only repository file reads and edits inside the existing reserved paths. Do not run native commands, Git, or GitHub CLI. This is one bounded remediation lane: do not invoke subagents, MCP, dynamic tools, web search, or external connectors. Review the resulting file changes directly. Return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null, merged false, ownerTouchCount 0, blockedScopeCrossed false, and reviewThreads 0. Do not contact William.`
}

function buildValidationRemediationPrompt({ workOrderId, branch, outcome, reservations, validation }) {
  return `Continue ${workOrderId} on ${branch}.

${remediationContext({ outcome, reservations })}

Hermes native-host validation rejected the current file handoff:
${validation}

Use only repository file reads and edits inside the existing reserved paths. Correct the validation failure, independently review the resulting file changes, and do not run native commands, Git, or GitHub CLI. This is one bounded remediation lane: do not invoke subagents, MCP, dynamic tools, web search, or external connectors. Return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null, merged false, ownerTouchCount 0, blockedScopeCrossed false, and reviewThreads 0. Do not contact William.`
}

function allowedPath(changedPath, reservations) {
  if (FORBIDDEN_CHANGED_PATH.test(changedPath)) return false
  return reservations.some((reservation) => {
    const prefix = reservation.replace(/\*\*$/, "")
    return changedPath.startsWith(prefix)
  })
}

function assertOwnerTouchCountersZero(value) {
  const counters = value?.ownerTouchCounters
  if (!counters || Object.values(counters).some((count) => count !== 0)) {
    throw Object.assign(new Error("Durable owner-touch counters must remain zero"), { code: "HERMES_OWNER_TOUCH_WALL" })
  }
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

export function createHermesOrchestrator(options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd())
  const runtimeRoot = path.resolve(options.runtimeRoot ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT
    ?? path.join(os.homedir(), ".williamos", "hermes-bridge"))
  const statePath = path.join(runtimeRoot, "state", "state.json")
  const activationPath = path.join(runtimeRoot, "control", "activation")
  const notBeforePath = path.join(runtimeRoot, "control", "authority-not-before")
  const state = options.state ?? createHermesStateStore(statePath)
  const lifecycle = options.lifecycle ?? createRepositoryLifecycle({
    workspaceRoot: workspace,
    ownedWorktreeRoot: path.join(runtimeRoot, "worktrees"),
    validationCommands: DEFAULT_VALIDATION_COMMANDS,
  })
  const selectOutcome = options.selectOutcome ?? selectNextOutcome
  const markComplete = options.markComplete ?? completeOutcome
  const markTerminal = options.markTerminal ?? terminalizeOutcome
  const deferOutcome = options.deferOutcome ?? deferProviderOutcome
  const projectCheckpoint = options.projectCheckpoint ?? projectOutcomeRuntimeCheckpoint
  const clientFactory = options.clientFactory ?? ((cwd) => new CodexAppServerClient({ cwd, timeoutMs: TURN_TIMEOUT_MS }))
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
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

  function projectionMetadata(value = {}) {
    return Object.fromEntries([
      ["prNumber", value.prNumber],
      ["commit", value.commit],
      ["headRefOid", value.headRefOid],
      ["mergeSha", value.mergeSha],
    ].filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined))
  }

  async function projectCurrentExecution(outcomeId) {
    const execution = state.read().executions[String(outcomeId)]
    if (!execution) {
      throw Object.assign(new Error("Runtime execution is absent after durable mutation"), {
        code: "HERMES_RUNTIME_PROJECTION_STATE_WALL",
      })
    }
    try {
      return await projectCheckpoint({
        outcomeId: Number(outcomeId),
        attempt: execution.fencingToken,
        checkpoint: {
          sequence: execution.checkpoint.sequence,
          state: execution.checkpoint.state,
          detail: execution.checkpoint.detail,
          metadata: projectionMetadata(execution.metadata),
        },
      })
    } catch {
      throw Object.assign(new Error("Persisted runtime projection failed"), {
        code: "HERMES_RUNTIME_PROJECTION_WALL",
      })
    }
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
    const outcomeCompleted = await markComplete({
      outcomeId: outcome.id,
      evidence: { prNumber, mergeSha, branch, ownerTouchCount: 0, blockedScopeCrossed: false },
    })
    if (!outcomeCompleted) {
      throw Object.assign(new Error("Persisted outcome could not be closed after merge"), { code: "HERMES_OUTCOME_COMPLETION_WALL" })
    }
    await checkpoint(lease, sequence, "COMPLETE", `PR #${prNumber} merged and verified`, {
      prNumber, branch, mergeSha, headRefOid: pr.headRefOid,
    })
    state.releaseLease({
      idempotencyKey: `${lease.outcomeId}:release:complete`,
      outcomeId: lease.outcomeId, holderId, fencingToken: lease.fencingToken,
    })
    return { result: "COMPLETE", outcomeId: lease.outcomeId, prNumber, mergeSha, changedPaths }
  }

  async function finalizeTerminal({ lease, sequence, outcome, nextState, metadata = {} }) {
    const terminal = await checkpoint(lease, sequence, "FAILED_TERMINAL", nextState, metadata)
    const outcomeTerminalized = await markTerminal({
      outcomeId: outcome.id, result: "FAILED_TERMINAL", nextState,
    })
    if (!outcomeTerminalized) {
      throw Object.assign(new Error("Persisted outcome could not be terminalized"), {
        code: "HERMES_OUTCOME_TERMINAL_WALL",
      })
    }
    state.releaseLease({
      idempotencyKey: `${lease.outcomeId}:release:FAILED_TERMINAL:${nextState}`,
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
    state.abandonLease({
      idempotencyKey: `${lease.outcomeId}:abandon-post-merge:${lease.fencingToken}:${retry.checkpointSequence}`,
      outcomeId: lease.outcomeId, holderId, fencingToken: lease.fencingToken,
      reason: error?.code ?? "HERMES_POST_MERGE_CLEANUP_WALL",
    })
    return null
  }

  async function advanceCommittedHead({
    lease, sequence, outcome, branch, reservations, record, commit, remediationRound = 0,
  }) {
    if (await lifecycle.inspectWorktreeHead(record) !== commit) {
      throw Object.assign(new Error("Recorded commit no longer matches the owned worktree"), { code: "HERMES_COMMIT_RECOVERY_WALL" })
    }
    await lifecycle.pushBranch(record)
    const pullRequest = await lifecycle.createPullRequest({
      branch,
      title: `feat(williamos): deliver ${safeLeaf(outcomeRef(outcome))}`,
      body: `Hermes-delivered bounded WilliamOS-native R0/R1 feature for ${outcomeRef(outcome)}.\n\nOwner touch count: 0. Blocked scope crossed: false.`,
    })
    const prNumber = pullRequestNumber(pullRequest)
    let candidate = await lifecycle.inspectPullRequest(prNumber)
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
      throw Object.assign(new Error("Pull request did not reach a green reviewed state"), { code: "HERMES_PR_VERIFICATION_WALL" })
    }
    const worktreeChangedPaths = await lifecycle.inspectChangedPaths(record)
    assertChangedPathsAllowed(worktreeChangedPaths, reservations)
    const changedPaths = await lifecycle.inspectPullRequestFiles(prNumber)
    assertChangedPathsAllowed(changedPaths, reservations)
    await lifecycle.mergePullRequest({ number: prNumber, branch })
    const pr = await lifecycle.inspectPullRequest(prNumber)
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

  async function cycle() {
    if (readControl(activationPath, "disabled") !== "enabled") return { result: "DISABLED" }
    const initialized = state.initialize()
    if (initialized.killSwitch.active) return { result: "KILL_SWITCH_ACTIVE" }
    assertOwnerTouchCountersZero(initialized)
    const unfinished = Object.values(initialized.executions).filter((execution) => execution?.lease?.status === "ACTIVE")
    if (unfinished.length > 1) throw Object.assign(new Error("Multiple unfinished executions found"), { code: "HERMES_EXECUTION_CONCURRENCY_WALL" })
    const pendingExecution = unfinished[0] ?? null
    const notBefore = readControl(notBeforePath, now().toISOString())
    const outcome = pendingExecution?.metadata?.outcome ?? await selectOutcome({
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
    const current = pendingExecution ?? state.read().executions[outcomeId]
    if (current?.lease?.status === "RELEASED") return { result: "ALREADY_FINALIZED", outcomeId }

    let lease
    if (current) {
      if (Date.parse(current.lease.expiresAt) > now().getTime()) return { result: "LEASE_HELD", outcomeId }
      lease = state.reclaimLease({
        idempotencyKey: `${outcomeId}:reclaim:${current.fencingToken + 1}`,
        outcomeId,
        expectedFencingToken: current.fencingToken,
        holderId,
        leaseDurationMs: LEASE_DURATION_MS,
        metadata: current.checkpoint.state === "DEFERRED_PROVIDER_UNAVAILABLE"
          ? { ...current.metadata, threadId: null, turnId: null }
          : current.metadata,
      })
    } else {
      lease = state.acquireLease({
        idempotencyKey: `${outcomeId}:acquire:1`, outcomeId, holderId,
        leaseDurationMs: LEASE_DURATION_MS, metadata: { outcome },
      })
    }
    try {
      await projectCurrentExecution(outcomeId)
    } catch (error) {
      state.abandonLease({
        idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:runtime-projection`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
        reason: error?.code ?? "HERMES_RUNTIME_PROJECTION_WALL",
      })
      throw error
    }

    let sequence = lease.checkpointSequence
    if (current?.checkpoint?.state === "PROVIDER_UNAVAILABLE") {
      const recordedRetryAt = Date.parse(current.checkpoint.detail ?? "")
      const retryAfter = new Date(recordedRetryAt > now().getTime()
        ? recordedRetryAt : now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
      try {
        if (!await deferOutcome({ outcomeId: outcome.id, retryAfter })) {
          throw Object.assign(new Error("Provider-unavailable outcome could not be deferred"), { code: "HERMES_PROVIDER_SETTLEMENT_WALL" })
        }
      } catch (error) {
        state.abandonLease({
          idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:provider-settlement`,
          outcomeId, holderId, fencingToken: lease.fencingToken, reason: "HERMES_PROVIDER_SETTLEMENT_WALL",
        })
        throw error
      }
      state.deferProviderWall({
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
        outcomeId: outcome.id, result: "FAILED_TERMINAL", nextState,
      })
      if (!outcomeTerminalized) {
        throw Object.assign(new Error("Persisted outcome could not be terminalized"), {
          code: "HERMES_OUTCOME_TERMINAL_WALL",
        })
      }
      state.releaseLease({
        idempotencyKey: `${outcomeId}:release:FAILED_TERMINAL:${nextState}`,
        outcomeId, holderId, fencingToken: lease.fencingToken,
      })
      return { result: "FAILED_TERMINAL", outcomeId, nextState }
    }
    const branch = lease.metadata?.branch ?? `codex/hermes-${safeLeaf(outcomeRef(outcome))}-${outcome.id}`
    const reservations = RESERVATIONS[outcome.lane]
    if (!reservations) throw Object.assign(new Error("No reservation for outcome lane"), { code: "HERMES_RESERVATION_WALL" })
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
      branch, name: branch.slice("codex/".length), worktreePath: cp.metadata.worktreePath,
    })
    cp = await checkpoint(lease, sequence, "WORKTREE_READY", null, { branch, worktreePath: record.worktreePath, baseSha })
    sequence = cp.checkpointSequence

    let pendingFindings = []
    let pendingValidationFailure = lease.metadata?.validationFailure || null
    let initialRemediationRound = 0
    initialRemediationRound = Math.max(
      initialRemediationRound, lease.metadata?.validationRemediationRound ?? 0,
    )
    let durableHeadRefOid = lease.metadata?.headRefOid ?? null
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

    const client = clientFactory(record.worktreePath)
    let renewal
    try {
      await client.connect()
      let threadId = cp.metadata.threadId
      if (threadId) {
        try {
          await client.resumeThread(threadId, {
            cwd: record.worktreePath, approvalPolicy: "never", sandbox: "workspace-write",
          })
        } catch {
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

      renewal = setInterval(() => {
        try {
          state.renewLease({
            idempotencyKey: `${outcomeId}:renew:${Date.now()}`,
            outcomeId, holderId, fencingToken: lease.fencingToken, leaseDurationMs: LEASE_DURATION_MS,
          })
        } catch {}
      }, 5 * 60 * 1000)
      renewal.unref?.()

      let deliveryPrompt = pendingValidationFailure
        ? buildValidationRemediationPrompt({
          workOrderId: `WO-HERMES-${outcome.id}-001`, branch,
          outcome: outcome.command, reservations, validation: pendingValidationFailure,
        })
        : pendingFindings.length > 0
          ? buildRemediationPrompt({
            workOrderId: `WO-HERMES-${outcome.id}-001`, branch,
            outcome: outcome.command, reservations, findings: pendingFindings,
          })
        : buildHermesCodexPrompt({
        outcome: outcome.command,
        outcomeRef: outcomeRef(outcome),
        workOrderId: `WO-HERMES-${outcome.id}-001`,
        branch,
        baseSha,
        attempt: (cp.metadata.providerRetryCount ?? 0) + 1,
        reservations,
        validators: DEFAULT_VALIDATORS,
        })
      for (let remediationRound = initialRemediationRound;
        remediationRound <= MAX_REMEDIATION_ROUNDS; remediationRound += 1) {
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
        cp = await checkpoint(lease, sequence, "CODEX_TURN_COMPLETED", turn.status, {
          threadId: turn.threadId, turnId: turn.turnId,
        })
        sequence = cp.checkpointSequence
        const result = parseTurnResult(turn.finalText)
        assertOwnerTouchCountersZero(state.read())

        if (result.result === "RETRYABLE_PROVIDER_WALL") {
          const providerRetryCount = (cp.metadata.providerRetryCount ?? 0) + 1
          if (providerRetryCount >= MAX_PROVIDER_REDISPATCHES) {
            const retryAfter = new Date(now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
            cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, {
              providerRetryCount, threadId: null, turnId: null,
            })
            if (!await deferOutcome({ outcomeId: outcome.id, retryAfter })) {
              throw Object.assign(new Error("Provider-unavailable outcome could not be deferred"), { code: "HERMES_PROVIDER_SETTLEMENT_WALL" })
            }
            state.deferProviderWall({
              idempotencyKey: `${outcomeId}:defer:PROVIDER_UNAVAILABLE:${retryAfter}`,
              outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
            })
            return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
          }
          cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null, {
            providerRetryCount, threadId: null, turnId: null,
          })
          state.abandonLease({
            idempotencyKey: `${outcomeId}:abandon:${lease.fencingToken}:${cp.checkpointSequence}`,
            outcomeId, holderId, fencingToken: lease.fencingToken,
            reason: result.nextState ?? "RETRYABLE_PROVIDER_WALL",
          })
          return { result: result.result, outcomeId, nextState: result.nextState ?? null }
        }

        if (["OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"].includes(result.result)) {
          cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null)
          sequence = cp.checkpointSequence
          await markTerminal({ outcomeId: outcome.id, result: result.result, nextState: result.nextState ?? null })
          state.releaseLease({
            idempotencyKey: `${outcomeId}:release:${result.result}`,
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
        const focusedTests = workingPaths.filter((changedPath) =>
          changedPath.startsWith("tests/") && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(changedPath)
            && fs.statSync(path.join(record.worktreePath, changedPath), { throwIfNoEntry: false })?.isFile())
        const validationCommands = [
          ...(focusedTests.length > 0 ? [{
            command: "npx", args: ["vitest", "run", ...focusedTests], timeoutMs: 5 * 60 * 1000,
          }] : []),
          ...DEFAULT_VALIDATION_COMMANDS,
        ]
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_STARTED", null, { validationEvidence: null })
        sequence = cp.checkpointSequence
        let validation
        try {
          lifecycle.ensureValidationDependencies(record)
          validation = await lifecycle.runValidationCommands({ ...record, commands: validationCommands })
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
          })
          sequence = cp.checkpointSequence
          pendingValidationFailure = detail
          deliveryPrompt = buildValidationRemediationPrompt({
            workOrderId: `WO-HERMES-${outcome.id}-001`, branch,
            outcome: outcome.command, reservations, validation: detail,
          })
          continue
        } finally {
          lifecycle.removeValidationDependencies(record)
        }
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_PASSED", null, {
          validationEvidence: validation, validationFailure: "", validationRemediationRound: 0,
          headRefOid: null,
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
        })
        if (advanced.kind === "REMEDIATION") {
          pendingFindings = advanced.findings
          sequence = advanced.sequence
          deliveryPrompt = buildRemediationPrompt({
            workOrderId: `WO-HERMES-${outcome.id}-001`, branch,
            outcome: outcome.command, reservations, findings: pendingFindings,
          })
          continue
        }
        return advanced.result
      }
      throw Object.assign(new Error("Review remediation budget exhausted"), { code: "HERMES_REVIEW_REMEDIATION_WALL" })
    } catch (error) {
      const externalToolWall = error?.code === "APP_SERVER_EXTERNAL_TOOL_WALL"
      const postMergeCleanupWall = error?.code === "HERMES_POST_MERGE_CLEANUP_WALL"
      const runtimeProjectionWall = error?.code === "HERMES_RUNTIME_PROJECTION_WALL"
      if (postMergeCleanupWall) {
        const terminal = await settlePostMergeCleanupFailure({ lease, outcome, error })
        if (terminal) return terminal
        throw error
      }
      const externalToolRetryCount = externalToolWall
        ? (cp?.metadata?.externalToolRetryCount ?? 0) + 1
        : cp?.metadata?.externalToolRetryCount ?? 0
      if (externalToolWall && externalToolRetryCount >= MAX_PROVIDER_REDISPATCHES) {
        const retryAfter = new Date(now().getTime() + PROVIDER_RETRY_COOLDOWN_MS).toISOString()
        cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, {
          externalToolRetryCount, threadId: null, turnId: null,
        })
        if (!await deferOutcome({ outcomeId: outcome.id, retryAfter })) {
          throw Object.assign(new Error("External-tool wall outcome could not be deferred"), {
            code: "HERMES_PROVIDER_SETTLEMENT_WALL",
          })
        }
        state.deferProviderWall({
          idempotencyKey: `${outcomeId}:defer:EXTERNAL_TOOL_WALL:${retryAfter}`,
          outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
        })
        return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
      }
      try {
        cp = await checkpoint(lease, sequence, "RETRYABLE_WALL", error?.code ?? "HERMES_CYCLE_FAILED",
          externalToolWall ? { externalToolRetryCount, threadId: null, turnId: null } : {})
        sequence = cp.checkpointSequence
      } catch {}
      if (cp?.state === "PROVIDER_UNAVAILABLE"
        || runtimeProjectionWall
        || ["APP_SERVER_TURN_INTERRUPTED", "APP_SERVER_TURN_FAILED", "APP_SERVER_TIMEOUT", "APP_SERVER_EXTERNAL_TOOL_WALL", "HERMES_PROVIDER_SETTLEMENT_WALL"].includes(error?.code)) {
        try {
          state.abandonLease({
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

  return Object.freeze({ cycle, state, runtimeRoot, statePath, activationPath, notBeforePath })
}
