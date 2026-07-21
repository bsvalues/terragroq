import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { CodexAppServerClient } from "./app-server-client.mjs"
import { completeOutcome, selectNextOutcome } from "./outcome-source.mjs"
import { evaluateOutcomePolicy } from "./policy.mjs"
import { buildHermesCodexPrompt, HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"
import { createRepositoryLifecycle } from "./repository-lifecycle.mjs"
import { createHermesStateStore } from "./state-store.mjs"

const LEASE_DURATION_MS = 15 * 60 * 1000
const TURN_TIMEOUT_MS = 5.5 * 60 * 60 * 1000
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
  const runtimeRoot = path.resolve(options.runtimeRoot ?? path.join(os.homedir(), ".williamos", "hermes-bridge"))
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

  async function cycle() {
    if (readControl(activationPath, "disabled") !== "enabled") return { result: "DISABLED" }
    const initialized = state.initialize()
    if (initialized.killSwitch.active) return { result: "KILL_SWITCH_ACTIVE" }
    const notBefore = readControl(notBeforePath, now().toISOString())
    const outcome = await selectOutcome({ enabled: true, killSwitch: false, standingAuthority: true, notBefore })
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
    const current = state.read().executions[outcomeId]
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
        leaseDurationMs: LEASE_DURATION_MS,
      })
    }

    let sequence = lease.checkpointSequence
    const branch = lease.metadata?.branch ?? `codex/hermes-${safeLeaf(outcomeRef(outcome))}-${outcome.id}`
    const reservations = RESERVATIONS[outcome.lane]
    if (!reservations) throw Object.assign(new Error("No reservation for outcome lane"), { code: "HERMES_RESERVATION_WALL" })
    const baseSha = lease.metadata?.baseSha ?? await lifecycle.refreshOriginMain()
    const record = lease.metadata?.worktreePath
      ? await lifecycle.resumeOwnedWorktree({ branch, worktreePath: lease.metadata.worktreePath })
      : await lifecycle.createWorktree({ branch, name: branch.slice("codex/".length) })

    let cp = await checkpoint(lease, sequence, "WORKTREE_READY", null, {
      branch, worktreePath: record.worktreePath, baseSha,
    })
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
            environments: [], selectedCapabilityRoots: [], dynamicTools: [],
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
          environments: [],
          selectedCapabilityRoots: [],
          dynamicTools: [],
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
        attempt: current ? 2 : 1,
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

      if (result.result !== "COMPLETE") {
        cp = await checkpoint(lease, sequence, result.result, result.nextState ?? null)
        sequence = cp.checkpointSequence
        state.releaseLease({
          idempotencyKey: `${outcomeId}:release:${result.result}`,
          outcomeId, holderId, fencingToken: lease.fencingToken,
        })
        return { result: result.result, outcomeId, nextState: result.nextState ?? null }
      }
      if (!result.merged || result.ownerTouchCount !== 0 || result.blockedScopeCrossed || result.reviewThreads !== 0) {
        throw Object.assign(new Error("Codex result did not satisfy the completion contract"), { code: "HERMES_COMPLETION_GATE_WALL" })
      }
      const prNumber = Number(new URL(result.prUrl).pathname.split("/").at(-1))
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw Object.assign(new Error("Valid PR URL required"), { code: "HERMES_PR_WALL" })
      const pr = await lifecycle.inspectPullRequest(prNumber)
      const mergeSha = pr.mergeCommit?.oid ?? result.mergeCommit
      if (pr.state !== "MERGED" || !pr.checksGreen || !pr.reviewed
        || pr.unresolvedThreadCount !== 0 || !SHA.test(mergeSha ?? "")) {
        throw Object.assign(new Error("Merged PR failed independent verification"), { code: "HERMES_PR_VERIFICATION_WALL" })
      }
      const changedPaths = await lifecycle.inspectPullRequestFiles(prNumber)
      assertChangedPathsAllowed(changedPaths, reservations)
      if (!await lifecycle.verifyOriginMainContains(mergeSha)) {
        throw Object.assign(new Error("Merge commit is absent from origin/main"), { code: "HERMES_MAIN_VERIFICATION_WALL" })
      }
      await markComplete({
        outcomeId: outcome.id,
        evidence: { prNumber, mergeSha, branch, ownerTouchCount: 0, blockedScopeCrossed: false },
      })
      cp = await checkpoint(lease, sequence, "COMPLETE", `PR #${prNumber} merged and verified`, {
        prNumber, branch, threadId: turn.threadId, turnId: turn.turnId,
      })
      state.releaseLease({
        idempotencyKey: `${outcomeId}:release:complete`, outcomeId, holderId, fencingToken: lease.fencingToken,
      })
      return { result: "COMPLETE", outcomeId, prNumber, mergeSha, changedPaths }
    } catch (error) {
      try {
        await checkpoint(lease, sequence, "RETRYABLE_WALL", error?.code ?? "HERMES_CYCLE_FAILED")
      } catch {}
      throw error
    } finally {
      if (renewal) clearInterval(renewal)
      client.close()
    }
  }

  return Object.freeze({ cycle, runtimeRoot, statePath, activationPath, notBeforePath })
}
