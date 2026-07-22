import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { CodexAppServerClient } from "./app-server-client.mjs"
import { completeOutcome, deferProviderOutcome, selectNextOutcome, terminalizeOutcome } from "./outcome-source.mjs"
import { evaluateOutcomePolicy } from "./policy.mjs"
import { buildHermesCodexPrompt, HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"
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
  Object.freeze({ command: "npm", args: Object.freeze(["run", "lint"]) }),
  Object.freeze({ command: "npm", args: Object.freeze(["test", "--", "--run"]) }),
  Object.freeze({
    command: "npm",
    args: Object.freeze(["run", "build"]),
    env: Object.freeze({ NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1" }),
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

function buildRemediationPrompt({ workOrderId, branch, findings }) {
  return `Continue ${workOrderId} on ${branch}.

Hermes completed native validation, commit, push, PR creation, and review monitoring. Independent review produced these actionable findings:
${findings.map((finding, index) => `${index + 1}. ${finding.path}${finding.line ? `:${finding.line}` : ""} - ${finding.body}`).join("\n")}

Remediate every valid finding using only repository file reads and edits inside the existing reserved paths. Do not run native commands, Git, or GitHub CLI. Independently review the resulting file changes. Return READY_FOR_VALIDATION with commit, prUrl, and mergeCommit set to null, merged false, ownerTouchCount 0, blockedScopeCrossed false, and reviewThreads 0. Do not contact William.`
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

  async function checkpoint(lease, sequence, checkpointState, detail, metadata = {}) {
    return state.checkpoint({
      idempotencyKey: `${lease.outcomeId}:checkpoint:${sequence + 1}:${checkpointState}`,
      outcomeId: lease.outcomeId,
      holderId,
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: sequence,
      state: checkpointState,
      detail,
      metadata,
    })
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
    await lifecycle.cleanupOwnedWorktree({
      branch, worktreePath, mergeCommitSha: mergeSha, expectedHeadSha: pr.headRefOid,
    })
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
    for (let pollAttempt = 0; pollAttempt < reviewPollAttempts; pollAttempt += 1) {
      if (candidate.state !== "OPEN" || candidate.baseRefName !== "main"
        || candidate.isDraft || candidate.headRefOid !== commit) {
        throw Object.assign(new Error("Pull request identity changed during review"), { code: "HERMES_PR_VERIFICATION_WALL" })
      }
      if (candidate.unresolvedThreadCount > 0 || (candidate.checksGreen && candidate.reviewed)) break
      await sleep(reviewPollIntervalMs)
      candidate = await lifecycle.inspectPullRequest(prNumber)
    }
    if (candidate.unresolvedThreadCount > 0) {
      const findings = await lifecycle.inspectReviewFindings(prNumber)
      if (findings.length === 0 || remediationRound >= MAX_REMEDIATION_ROUNDS) {
        throw Object.assign(new Error("Review remediation budget exhausted"), { code: "HERMES_REVIEW_REMEDIATION_WALL" })
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
        metadata: current.metadata,
      })
    } else {
      lease = state.acquireLease({
        idempotencyKey: `${outcomeId}:acquire:1`, outcomeId, holderId,
        leaseDurationMs: LEASE_DURATION_MS, metadata: { outcome },
      })
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
    const branch = lease.metadata?.branch ?? `codex/hermes-${safeLeaf(outcomeRef(outcome))}-${outcome.id}`
    const reservations = RESERVATIONS[outcome.lane]
    if (!reservations) throw Object.assign(new Error("No reservation for outcome lane"), { code: "HERMES_RESERVATION_WALL" })
    const baseSha = lease.metadata?.baseSha ?? await lifecycle.refreshOriginMain()
    const worktreePath = lease.metadata?.worktreePath
      ?? path.join(runtimeRoot, "worktrees", branch.slice("codex/".length))
    if (lease.metadata?.prNumber && lease.metadata?.mergeSha) {
      return finalizeMerged({
        lease, sequence, outcome, branch, reservations, worktreePath,
        prNumber: lease.metadata.prNumber,
      })
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
    let initialRemediationRound = 0
    if (SHA.test(lease.metadata?.headRefOid ?? "")) {
      const recoveredRemediationRound = lease.metadata.remediationRound ?? 0
      const workingPaths = await lifecycle.inspectWorkingTreePaths(record)
      if (workingPaths.length === 0) {
        const recovered = await advanceCommittedHead({
          lease, sequence, outcome, branch, reservations, record,
          commit: lease.metadata.headRefOid, remediationRound: recoveredRemediationRound,
        })
        if (recovered.kind === "COMPLETE") return recovered.result
        sequence = recovered.sequence
        pendingFindings = recovered.findings
        initialRemediationRound = recovered.nextRemediationRound
      } else if (lease.metadata?.prNumber) {
        const candidate = await lifecycle.inspectPullRequest(lease.metadata.prNumber)
        if (candidate.unresolvedThreadCount > 0) {
          pendingFindings = await lifecycle.inspectReviewFindings(lease.metadata.prNumber)
          initialRemediationRound = recoveredRemediationRound + 1
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

      let deliveryPrompt = pendingFindings.length > 0
        ? buildRemediationPrompt({ workOrderId: `WO-HERMES-${outcome.id}-001`, branch, findings: pendingFindings })
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
            cp = await checkpoint(lease, sequence, "PROVIDER_UNAVAILABLE", retryAfter, { providerRetryCount })
            if (!await deferOutcome({ outcomeId: outcome.id, retryAfter })) {
              throw Object.assign(new Error("Provider-unavailable outcome could not be deferred"), { code: "HERMES_PROVIDER_SETTLEMENT_WALL" })
            }
            state.deferProviderWall({
              idempotencyKey: `${outcomeId}:defer:PROVIDER_UNAVAILABLE:${retryAfter}`,
              outcomeId, holderId, fencingToken: lease.fencingToken, retryAfter,
            })
            return { result: "PROVIDER_UNAVAILABLE", outcomeId, nextState: "DEFERRED_PROVIDER_UNAVAILABLE", retryAfter }
          }
          cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null, { providerRetryCount })
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
        lifecycle.ensureValidationDependencies(record)
        const focusedTests = workingPaths.filter((changedPath) =>
          changedPath.startsWith("tests/") && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(changedPath))
        const validationCommands = [
          ...(focusedTests.length > 0 ? [{ command: "npx", args: ["vitest", "run", ...focusedTests] }] : []),
          ...DEFAULT_VALIDATION_COMMANDS,
        ]
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_STARTED", null)
        sequence = cp.checkpointSequence
        const validation = await lifecycle.runValidationCommands({ ...record, commands: validationCommands })
        cp = await checkpoint(lease, sequence, "HOST_VALIDATION_PASSED", null, { validation })
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
        if (pendingFindings.length > 0) {
          await lifecycle.resolveReviewThreads(pendingFindings.map((finding) => finding.threadId))
          pendingFindings = []
        }
        const advanced = await advanceCommittedHead({
          lease, sequence, outcome, branch, reservations, record,
          commit: committed.commit, remediationRound,
        })
        if (advanced.kind === "REMEDIATION") {
          pendingFindings = advanced.findings
          sequence = advanced.sequence
          deliveryPrompt = buildRemediationPrompt({
            workOrderId: `WO-HERMES-${outcome.id}-001`, branch, findings: pendingFindings,
          })
          continue
        }
        return advanced.result
      }
      throw Object.assign(new Error("Review remediation budget exhausted"), { code: "HERMES_REVIEW_REMEDIATION_WALL" })
    } catch (error) {
      try { await checkpoint(lease, sequence, "RETRYABLE_WALL", error?.code ?? "HERMES_CYCLE_FAILED") } catch {}
      if (cp?.state === "PROVIDER_UNAVAILABLE"
        || ["APP_SERVER_TURN_INTERRUPTED", "APP_SERVER_TURN_FAILED", "APP_SERVER_TIMEOUT", "HERMES_PROVIDER_SETTLEMENT_WALL"].includes(error?.code)) {
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
