import { randomUUID } from "node:crypto"
import os from "node:os"

import {
  acquireNextEligibleOutcome,
  bindOutcomeQueueWorkOrder,
  completeOutcomeQueueItem,
  deferOutcomeQueueLease,
  readOutcomeQueue,
  renewOutcomeQueueLease,
  resumeOutcomeQueueAfterDecision,
  transitionOutcomeQueueItem,
} from "./outcome-queue-source.mjs"
import {
  completeOutcome as completeGoalOutcome,
  deferProviderOutcome as deferGoalOutcome,
  terminalizeOutcome as terminalizeGoalOutcome,
} from "./outcome-source.mjs"
import { evaluateOutcomePolicy } from "./policy.mjs"

const DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"
const QUEUE_LEASE_DURATION_MS = 50 * 60 * 1000

function wall(message, code) {
  throw Object.assign(new Error(message), { code })
}

function queueBinding(outcome) {
  const binding = outcome?.queueBinding
  if (!binding || typeof binding !== "object"
    || typeof binding.userId !== "string" || binding.userId.trim() === ""
    || typeof binding.outcomeKey !== "string" || binding.outcomeKey.trim() === ""
    || !Number.isSafeInteger(binding.expectedVersion) || binding.expectedVersion < 0
    || typeof binding.executionBinding !== "string" || binding.executionBinding.trim() === ""
    || typeof binding.leaseToken !== "string" || binding.leaseToken.trim() === ""
    || !Number.isSafeInteger(binding.fencingToken) || binding.fencingToken <= 0
    || typeof binding.acquisitionKey !== "string" || binding.acquisitionKey.trim() === "") {
    wall("Hermes outcome is missing its durable queue binding", "HERMES_OUTCOME_QUEUE_BINDING_WALL")
  }
  return binding
}

function createLazyPool(databaseUrl, createPool) {
  let poolPromise = null
  let closed = false

  async function pool() {
    if (closed) {
      wall("Hermes outcome queue runtime is closed", "HERMES_OUTCOME_QUEUE_RUNTIME_CLOSED")
    }
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      wall("DATABASE_URL is required", "DATABASE_URL_REQUIRED")
    }
    if (!poolPromise) {
      const pending = Promise.resolve()
        .then(async () => createPool
          ? createPool(databaseUrl)
          : new (await import("pg")).Pool({
              connectionString: databaseUrl,
              allowExitOnIdle: true,
            }))
        .then((candidate) => {
          if (!candidate || typeof candidate.query !== "function" || typeof candidate.end !== "function") {
            wall("Hermes outcome queue database pool is invalid", "HERMES_OUTCOME_QUEUE_POOL_WALL")
          }
          candidate.on?.("error", () => {
            if (poolPromise === pending) {
              poolPromise = null
              void candidate.end().catch(() => {})
            }
          })
          return candidate
        })
        .catch((error) => {
          if (poolPromise === pending) poolPromise = null
          throw error
        })
      poolPromise = pending
    }
    return poolPromise
  }

  return {
    async withPool(action) {
      return action(await pool())
    },
    async close() {
      if (closed) return
      closed = true
      const pending = poolPromise
      poolPromise = null
      if (pending) await (await pending).end()
    },
  }
}

async function loadDeclaredPrimary(withPool) {
  return withPool(async (pool) => {
    const result = await pool.query(
      `SELECT id, email
       FROM "user"
       WHERE lower(email) = lower($1)
       ORDER BY id
       LIMIT 2`,
      [DECLARED_PRIMARY_EMAIL],
    )
    if (result.rows.length !== 1) {
      wall("Declared Primary identity is not uniquely available", "HERMES_PRIMARY_IDENTITY_WALL")
    }
    return result.rows[0]
  })
}

async function loadLinkedGoal(withPool, queueItem) {
  if (!Number.isSafeInteger(Number(queueItem?.goalId)) || Number(queueItem.goalId) <= 0) {
    wall("Acquired queue item is not linked to a governed goal", "HERMES_OUTCOME_QUEUE_GOAL_WALL")
  }
  return withPool(async (pool) => {
    const result = await pool.query(
      `SELECT id, "userId" AS "userId", ref, command, lane, mode, risk,
              authority, verdict, "requiresApproval" AS "requiresApproval",
              "matchedRules" AS "matchedRules", status,
              "createdAt" AS "createdAt", "updatedAt" AS "updatedAt"
       FROM goal
       WHERE id = $1 AND "userId" = $2 AND ref = $3 AND status = 'classified'
       LIMIT 1`,
      [Number(queueItem.goalId), queueItem.userId, queueItem.goalRef],
    )
    if (result.rows.length !== 1) {
      wall("Acquired queue item does not match an executable governed goal", "HERMES_OUTCOME_QUEUE_GOAL_WALL")
    }
    return result.rows[0]
  })
}

function completionEvidence(evidence) {
  const refs = []
  if (/^EV-HERMES-\d+-\d+-\d+$/.test(String(evidence?.runtimeEvidenceRef ?? ""))) {
    refs.push(evidence.runtimeEvidenceRef)
  }
  if (Number.isSafeInteger(Number(evidence?.prNumber)) && Number(evidence.prNumber) > 0) {
    refs.push(`pr:${Number(evidence.prNumber)}`)
  }
  if (/^[0-9a-f]{40}$/.test(String(evidence?.mergeSha ?? ""))) {
    refs.push(`merge:${evidence.mergeSha}`)
  }
  return refs
}

function requiredMergeSha(evidence) {
  const mergeSha = evidence?.mergeSha
  if (typeof mergeSha !== "string" || !/^[0-9a-f]{40}$/.test(mergeSha)) {
    wall(
      "Queue completion requires an exact 40-hex merge SHA",
      "HERMES_OUTCOME_QUEUE_MERGE_SHA_WALL",
    )
  }
  return mergeSha
}

function persistedBinding(item) {
  return {
    userId: item.userId,
    outcomeKey: item.outcomeKey,
    expectedVersion: Number(item.version),
    executionBinding: item.executionBinding,
    leaseToken: item.leaseToken,
    fencingToken: Number(item.fencingToken),
    acquisitionKey: item.acquisitionKey,
  }
}

function withPersistedBinding(outcome, item) {
  return { ...outcome, queueBinding: persistedBinding(item) }
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function isExactTerminalSettlement(item, binding, terminalReplay) {
  if (!item
    || item.userId !== binding.userId
    || item.outcomeKey !== binding.outcomeKey
    || Number(item.version) !== binding.expectedVersion + 1
    || item.executionBinding !== binding.executionBinding
    || Number(item.fencingToken) !== binding.fencingToken
    || item.acquisitionKey !== binding.acquisitionKey
    || item.leaseHolder != null
    || item.leaseToken != null
    || item.leaseExpiresAt != null) return false

  if (terminalReplay?.state === "COMPLETE") {
    if (!/^[0-9a-f]{40}$/.test(String(terminalReplay.evidence?.mergeSha ?? ""))) return false
    const refs = completionEvidence(terminalReplay.evidence)
    return refs.length > 0
      && item.lifecycleState === "completed"
      && item.lifecycleReason == null
      && item.terminalResult === "COMPLETE"
      && item.terminalEvidenceId == null
      && item.terminalKey === `hermes:${binding.outcomeKey}:${binding.fencingToken}:${terminalReplay.evidence?.mergeSha}`
      && sameStrings(item.terminalEvidenceRefs, refs)
  }
  if (terminalReplay?.state === "FAILED_TERMINAL") {
    return typeof terminalReplay.nextState === "string"
      && terminalReplay.nextState.length > 0
      && item.lifecycleState === "blocked"
      && item.lifecycleReason === terminalReplay.nextState
      && item.terminalResult == null
      && item.terminalEvidenceId == null
      && sameStrings(item.terminalEvidenceRefs ?? [], [])
      && item.terminalKey == null
      && item.terminalAt == null
  }
  return false
}

export function createHermesOutcomeQueueRuntime(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  const database = createLazyPool(databaseUrl, options.createPool)
  const acquire = options.acquire ?? acquireNextEligibleOutcome
  const bindQueueWorkOrder = options.bindQueueWorkOrder ?? bindOutcomeQueueWorkOrder
  const completeQueue = options.completeQueue ?? completeOutcomeQueueItem
  const renewQueue = options.renewQueue ?? renewOutcomeQueueLease
  const deferQueue = options.deferQueue ?? deferOutcomeQueueLease
  const resumeQueue = options.resumeQueue ?? resumeOutcomeQueueAfterDecision
  const readQueue = options.readQueue ?? readOutcomeQueue
  const transitionQueue = options.transitionQueue ?? transitionOutcomeQueueItem
  const completeGoal = options.completeGoal ?? completeGoalOutcome
  const terminalizeGoal = options.terminalizeGoal ?? terminalizeGoalOutcome
  const deferGoal = options.deferGoal ?? deferGoalOutcome
  const resolvePrimary = options.resolvePrimary ?? (() => loadDeclaredPrimary(database.withPool))
  const resolveGoal = options.resolveGoal ?? ((item) => loadLinkedGoal(database.withPool, item))
  const now = options.now ?? (() => new Date())
  const holderId = options.holderId ?? `${os.hostname()}:hermes-outcome-queue`

  async function selectOutcome() {
    const primary = await resolvePrimary()
    for (let rejected = 0; rejected < 100; rejected += 1) {
      const acquired = await acquire({
        databaseUrl,
        userId: primary.id,
        acquisitionKey: randomUUID(),
        leaseHolder: holderId,
        leaseToken: randomUUID(),
        executionBinding: randomUUID(),
        leaseDurationMs: QUEUE_LEASE_DURATION_MS,
        now: now(),
      })
      if (!acquired?.outcome || !acquired.acquired) return null
      const item = acquired.outcome
      try {
        const goal = await resolveGoal(item)
        const decision = evaluateOutcomePolicy({
          outcome: goal,
          actor: "bsvalues",
          repository: "bsvalues/terragroq",
          enabled: true,
          standingAuthority: true,
        })
        if (!decision.allowed) {
          wall(decision.reasonCode, `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`)
        }
        return {
          ...goal,
          queueBinding: persistedBinding(item),
        }
      } catch (error) {
        if (error?.code !== "HERMES_OUTCOME_QUEUE_GOAL_WALL"
          && !String(error?.code ?? "").startsWith("HERMES_OUTCOME_QUEUE_POLICY_")) {
          throw error
        }
        await transitionQueue({
          databaseUrl,
          userId: item.userId,
          outcomeKey: item.outcomeKey,
          fromState: "active",
          toState: "blocked",
          expectedVersion: Number(item.version),
          executionBinding: item.executionBinding,
          leaseToken: item.leaseToken,
          fencingToken: Number(item.fencingToken),
          lifecycleReason: error?.code ?? "HERMES_OUTCOME_QUEUE_GOAL_WALL",
          now: now(),
        })
      }
    }
    wall("Queue contains too many invalid executable bindings", "HERMES_OUTCOME_QUEUE_REJECTION_BUDGET_WALL")
  }

  async function completeOutcome({ outcomeId, outcome, evidence }) {
    if (!outcome?.queueBinding) {
      return completeGoal({ databaseUrl, outcomeId, evidence })
    }
    const binding = queueBinding(outcome)
    const mergeSha = requiredMergeSha(evidence)
    const refs = completionEvidence(evidence)
    if (refs.length === 0) {
      wall("Queue completion requires reviewed delivery evidence", "HERMES_OUTCOME_QUEUE_EVIDENCE_WALL")
    }
    if (!await completeGoal({ databaseUrl, outcomeId, evidence })) return false
    await completeQueue({
      databaseUrl,
      ...binding,
      terminalKey: `hermes:${binding.outcomeKey}:${binding.fencingToken}:${mergeSha}`,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: refs,
      now: now(),
    })
    return true
  }

  async function terminalizeOutcome({ outcomeId, outcome, result, nextState, metadata }) {
    if (!outcome?.queueBinding) {
      return terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })
    }
    const binding = queueBinding(outcome)
    if (!await terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })) return false
    const lifecycleReason = nextState ?? result
    try {
      await transitionQueue({
        databaseUrl,
        userId: binding.userId,
        outcomeKey: binding.outcomeKey,
        fromState: "active",
        toState: "blocked",
        expectedVersion: binding.expectedVersion,
        executionBinding: binding.executionBinding,
        leaseToken: binding.leaseToken,
        fencingToken: binding.fencingToken,
        lifecycleReason,
        now: now(),
      })
    } catch (error) {
      const current = (await readQueue({
        databaseUrl,
        userId: binding.userId,
      })).find((item) => item.outcomeKey === binding.outcomeKey)
      if (current?.lifecycleState !== "blocked"
        || current.lifecycleReason !== lifecycleReason
        || Number(current.version) !== binding.expectedVersion + 1
        || current.executionBinding !== binding.executionBinding
        || Number(current.fencingToken) !== binding.fencingToken
        || current.acquisitionKey !== binding.acquisitionKey) throw error
    }
    return true
  }

  async function deferOutcome({ outcomeId, outcome, retryAfter }) {
    if (!await deferGoal({ databaseUrl, outcomeId, retryAfter })) return false
    if (outcome?.queueBinding) {
      await deferQueue({
        databaseUrl,
        ...queueBinding(outcome),
        retryAfter,
        lifecycleReason: "PROVIDER_UNAVAILABLE",
        now: now(),
      })
    }
    return true
  }

  async function renewOutcomeLease(outcome) {
    if (!outcome?.queueBinding) return null
    return renewQueue({
      databaseUrl,
      ...queueBinding(outcome),
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: now(),
    })
  }

  async function bindWorkOrder(outcome, activeWorkOrderId) {
    if (!outcome?.queueBinding) return null
    return bindQueueWorkOrder({
      databaseUrl,
      ...queueBinding(outcome),
      activeWorkOrderId,
      now: now(),
    })
  }

  async function refreshOutcome(outcome, terminalReplay = null) {
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    const refreshed = await acquire({
      databaseUrl,
      userId: binding.userId,
      acquisitionKey: binding.acquisitionKey,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      executionBinding: binding.executionBinding,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: now(),
    })
    if (refreshed?.outcome && refreshed.acquired) {
      return withPersistedBinding(outcome, refreshed.outcome)
    }
    const current = refreshed?.outcome ?? (await readQueue({
      databaseUrl,
      userId: binding.userId,
    })).find((item) => item.outcomeKey === binding.outcomeKey)
    if (isExactTerminalSettlement(current, binding, terminalReplay)) {
      // Preserve the pre-settlement capability so the settlement API can verify its idempotent replay.
      return outcome
    }
    wall(
      refreshed?.reason ?? "Queue binding could not be refreshed",
      "HERMES_OUTCOME_QUEUE_REFRESH_WALL",
    )
  }

  async function resumeAfterOwnerDecision(outcome, proof) {
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    const resumed = await resumeQueue({
      databaseUrl,
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      expectedVersion: binding.expectedVersion + 1,
      executionBinding: binding.executionBinding,
      acquisitionKey: binding.acquisitionKey,
      fencingToken: binding.fencingToken,
      ownerDecisionId: proof?.decisionId,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: now(),
    })
    return withPersistedBinding(outcome, resumed)
  }

  return {
    selectOutcome,
    completeOutcome,
    terminalizeOutcome,
    deferOutcome,
    renewOutcomeLease,
    bindWorkOrder,
    refreshOutcome,
    resumeAfterOwnerDecision,
    close: database.close,
  }
}
