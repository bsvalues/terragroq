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
const SHA = /^[0-9a-f]{40}$/

export const DEFAULT_VALIDATORS = Object.freeze([
  "npx vitest run focused tests for changed behavior",
  "npm run lint",
  "npm test -- --run",
  "NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build",
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
  })
  const selectOutcome = options.selectOutcome ?? selectNextOutcome
  const markComplete = options.markComplete ?? completeOutcome
  const markTerminal = options.markTerminal ?? terminalizeOutcome
  const deferOutcome = options.deferOutcome ?? deferProviderOutcome
  const clientFactory = options.clientFactory ?? ((cwd) => new CodexAppServerClient({ cwd, timeoutMs: TURN_TIMEOUT_MS }))
  const now = options.now ?? (() => new Date())
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

      const prompt = buildHermesCodexPrompt({
        outcome: outcome.command,
        outcomeRef: outcomeRef(outcome),
        workOrderId: `WO-HERMES-${outcome.id}-001`,
        branch,
        baseSha,
        attempt: (cp.metadata.providerRetryCount ?? 0) + 1,
        reservations,
        validators: DEFAULT_VALIDATORS,
      })
      const turn = await client.runTurn({
        threadId,
        prompt,
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
        await markTerminal({
          outcomeId: outcome.id,
          result: result.result,
          nextState: result.nextState ?? null,
        })
        state.releaseLease({
          idempotencyKey: `${outcomeId}:release:${result.result}`,
          outcomeId, holderId, fencingToken: lease.fencingToken,
        })
        return { result: result.result, outcomeId, nextState: result.nextState ?? null }
      }
      if (result.result !== "READY_FOR_MERGE" || result.merged || result.mergeCommit !== null
        || result.ownerTouchCount !== 0 || result.blockedScopeCrossed || result.reviewThreads !== 0
        || !SHA.test(result.commit ?? "")) {
        throw Object.assign(new Error("Codex result did not satisfy the completion contract"), { code: "HERMES_COMPLETION_GATE_WALL" })
      }
      let prUrl
      try { prUrl = new URL(result.prUrl) } catch {
        throw Object.assign(new Error("Valid PR URL required"), { code: "HERMES_PR_WALL" })
      }
      const match = prUrl.origin === "https://github.com"
        ? prUrl.pathname.match(/^\/bsvalues\/terragroq\/pull\/(\d+)\/?$/) : null
      const prNumber = Number(match?.[1])
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw Object.assign(new Error("Valid PR URL required"), { code: "HERMES_PR_WALL" })
      const candidate = await lifecycle.inspectPullRequest(prNumber)
      if (candidate.state !== "OPEN" || candidate.baseRefName !== "main"
        || candidate.isDraft || !candidate.checksGreen || !candidate.reviewed
        || candidate.unresolvedThreadCount !== 0 || candidate.headRefOid !== result.commit) {
        throw Object.assign(new Error("Pull request failed the pre-merge verification gate"), { code: "HERMES_PR_VERIFICATION_WALL" })
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
      cp = await checkpoint(lease, sequence, "PR_MERGED", `PR #${prNumber} merged`, {
        prNumber, branch, mergeSha, headRefOid: pr.headRefOid,
      })
      sequence = cp.checkpointSequence
      return finalizeMerged({
        lease, sequence, outcome, branch, reservations, worktreePath: record.worktreePath, prNumber,
      })
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
