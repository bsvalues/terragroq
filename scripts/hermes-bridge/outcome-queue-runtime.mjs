import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

import {
  acquireNextEligibleOutcome,
  bindOutcomeQueueWorkOrder,
  completeOutcomeQueueItem,
  deferOutcomeQueueLease,
  ensureOutcomeQueueHardeningSchema,
  readOutcomeQueue,
  renewOutcomeQueueLease,
  resumeOutcomeQueueAfterDecision,
  transitionOutcomeQueueItem,
  verifyOutcomeQueueWorkOrderBinding,
} from "./outcome-queue-source.mjs"
import { readHermesState } from "./state-store.mjs"
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

function effectiveQueueCommand(item, goal) {
  for (const candidate of [item?.objective, item?.title, goal?.command]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim()
    }
  }
  wall("Durable queue outcome is missing an executable command", "HERMES_OUTCOME_QUEUE_COMMAND_WALL")
}

function governedQueueOutcome(item, goal) {
  return {
    ...goal,
    ...(typeof item?.title === "string" && item.title.trim() !== ""
      ? { title: item.title.trim() }
      : {}),
    command: effectiveQueueCommand(item, goal),
  }
}

function residentCheckpointProvider({ runtimeRoot, readState = readHermesState }) {
  const statePath = path.join(runtimeRoot, "state", "state.json")
  return async ({ outcome }) => {
    const state = readState(statePath)
    const outcomeId = String(outcome.goalId)
    const candidate = state.executions?.[outcomeId] ?? null
    const execution = candidate?.metadata?.outcome?.queueBinding?.outcomeKey === outcome.outcomeKey
      ? candidate
      : null
    const activeWorkOrderId = Number(outcome.activeWorkOrderId)
    return {
      outcomeId,
      outcomeKey: outcome.outcomeKey,
      workOrderId: Number.isSafeInteger(activeWorkOrderId) && activeWorkOrderId > 0
        ? activeWorkOrderId
        : null,
      fencingToken: Number(outcome.fencingToken),
      sequence: execution?.checkpoint?.sequence ?? 0,
      state: execution?.checkpoint?.state ?? "LEASED",
      commit: {
        headSha: execution?.metadata?.headRefOid ?? null,
        mergeSha: execution?.metadata?.mergeSha ?? null,
        prNumber: execution?.metadata?.prNumber ?? null,
      },
    }
  }
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
    || typeof binding.acquisitionKey !== "string" || binding.acquisitionKey.trim() === ""
    || (binding.activeWorkOrderId !== undefined
      && (!Number.isSafeInteger(binding.activeWorkOrderId) || binding.activeWorkOrderId <= 0))) {
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
  const activeWorkOrderId = Number(item.activeWorkOrderId)
  return {
    userId: item.userId,
    outcomeKey: item.outcomeKey,
    expectedVersion: Number(item.version),
    executionBinding: item.executionBinding,
    leaseToken: item.leaseToken,
    fencingToken: Number(item.fencingToken),
    acquisitionKey: item.acquisitionKey,
    ...(Number.isSafeInteger(activeWorkOrderId) && activeWorkOrderId > 0
      ? { activeWorkOrderId }
      : {}),
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
  if (["FAILED_TERMINAL", "OWNER_DECISION_REQUIRED"].includes(terminalReplay?.state)) {
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

function isExactLiveBinding(item, binding, activeWorkOrderId) {
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && Number(item.version) === binding.expectedVersion
    && item.executionBinding === binding.executionBinding
    && item.leaseToken === binding.leaseToken
    && Number(item.fencingToken) === binding.fencingToken
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.activeWorkOrderId) === activeWorkOrderId
}

function isExactProviderDeferral(item, binding, retryAfter, holderId) {
  return isExactLiveBinding(item, binding, Number(binding.activeWorkOrderId))
    && item.leaseHolder === holderId
    && item.lifecycleReason === "PROVIDER_UNAVAILABLE"
    && new Date(item.leaseExpiresAt).toISOString() === new Date(retryAfter).toISOString()
}

function isExactOwnerDecisionResume(item, binding, holderId, at) {
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.lifecycleReason === "OWNER_DECISION_RESUMED"
    && item.approvalState === "approved"
    && item.authorityState === "matched"
    && Number(item.version) === binding.expectedVersion + 2
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.fencingToken) === binding.fencingToken + 1
    && item.leaseHolder === holderId
    && item.leaseToken === binding.leaseToken
    && Date.parse(String(item.leaseExpiresAt)) > at.getTime()
}

export function createHermesOutcomeQueueRuntime(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  const database = createLazyPool(databaseUrl, options.createPool)
  const acquire = options.acquire ?? acquireNextEligibleOutcome
  const bindQueueWorkOrder = options.bindQueueWorkOrder ?? bindOutcomeQueueWorkOrder
  const verifyQueueWorkOrder = options.verifyQueueWorkOrder
    ?? verifyOutcomeQueueWorkOrderBinding
  const ensureQueueSchema = options.ensureQueueSchema
    ?? (options.acquire ? async () => true : ensureOutcomeQueueHardeningSchema)
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
  const runtimeRoot = path.resolve(
    options.runtimeRoot
      ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT
      ?? path.join(os.homedir(), ".williamos", "hermes-bridge"),
  )
  const campaignWindowId = options.campaignWindowId ?? process.env.HERMES_CAMPAIGN_WINDOW_ID
  const processIdentity = options.processIdentity ?? process.env.HERMES_PROCESS_IDENTITY
  const checkpointProofProvider = options.checkpointProofProvider
    ?? residentCheckpointProvider({ runtimeRoot, readState: options.readHermesState })
  let schemaReady = null

  function requireExecutionProofContext() {
    if (typeof campaignWindowId !== "string" || campaignWindowId.trim() === "") {
      wall("Trusted resident campaign window is required", "HERMES_CAMPAIGN_WINDOW_REQUIRED")
    }
    if (typeof processIdentity !== "string" || processIdentity.trim() === "") {
      wall("Trusted resident process identity is required", "HERMES_PROCESS_IDENTITY_REQUIRED")
    }
  }

  async function ensureReady() {
    if (!schemaReady) {
      schemaReady = Promise.resolve(ensureQueueSchema({ databaseUrl }))
        .catch((error) => {
          schemaReady = null
          throw error
        })
    }
    await schemaReady
  }

  async function selectOutcome() {
    requireExecutionProofContext()
    await ensureReady()
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
        campaignWindowId,
        processIdentity,
        checkpointProofProvider,
        now: now(),
      })
      if (!acquired?.outcome || !acquired.acquired) return null
      const item = acquired.outcome
      try {
        const goal = await resolveGoal(item)
        const governedOutcome = governedQueueOutcome(item, goal)
        const decision = evaluateOutcomePolicy({
          outcome: governedOutcome,
          actor: "bsvalues",
          repository: "bsvalues/terragroq",
          enabled: true,
          standingAuthority: true,
        })
        if (!decision.allowed) {
          wall(decision.reasonCode, `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`)
        }
        return {
          ...governedOutcome,
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
    requireExecutionProofContext()
    if (!outcome?.queueBinding) {
      return completeGoal({ databaseUrl, outcomeId, evidence })
    }
    const binding = queueBinding(outcome)
    const mergeSha = requiredMergeSha(evidence)
    const refs = completionEvidence(evidence)
    if (refs.length === 0) {
      wall("Queue completion requires reviewed delivery evidence", "HERMES_OUTCOME_QUEUE_EVIDENCE_WALL")
    }
    try {
      await completeQueue({
        databaseUrl,
        ...binding,
        terminalKey: `hermes:${binding.outcomeKey}:${binding.fencingToken}:${mergeSha}`,
        terminalResult: "COMPLETE",
        terminalEvidenceRefs: refs,
        now: now(),
      })
    } catch (error) {
      const current = (await readQueue({
        databaseUrl,
        userId: binding.userId,
      })).find((item) => item.outcomeKey === binding.outcomeKey)
      if (!isExactTerminalSettlement(current, binding, {
        state: "COMPLETE",
        evidence,
      })) throw error
    }
    return completeGoal({ databaseUrl, outcomeId, evidence })
  }

  async function terminalizeOutcome({ outcomeId, outcome, result, nextState, metadata }) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) {
      return terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })
    }
    const binding = queueBinding(outcome)
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
    return terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })
  }

  async function deferOutcome({ outcomeId, outcome, retryAfter }) {
    requireExecutionProofContext()
    if (outcome?.queueBinding) {
      const binding = queueBinding(outcome)
      try {
        await deferQueue({
          databaseUrl,
          ...binding,
          retryAfter,
          lifecycleReason: "PROVIDER_UNAVAILABLE",
          now: now(),
        })
      } catch (error) {
        const current = (await readQueue({
          databaseUrl,
          userId: binding.userId,
        })).find((item) => item.outcomeKey === binding.outcomeKey)
        if (!isExactProviderDeferral(current, binding, retryAfter, holderId)) throw error
      }
    }
    return deferGoal({ databaseUrl, outcomeId, retryAfter })
  }

  async function renewOutcomeLease(outcome) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return null
    return renewQueue({
      databaseUrl,
      ...queueBinding(outcome),
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      campaignWindowId,
      processIdentity,
      checkpointProofProvider,
      now: now(),
    })
  }

  async function bindWorkOrder(outcome, activeWorkOrderId, expectedWorkOrderStatus = "active") {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    if (!Number.isSafeInteger(activeWorkOrderId) || activeWorkOrderId <= 0) {
      wall("Projected Work Order identity is invalid", "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL")
    }
    if (binding.activeWorkOrderId !== undefined) {
      if (binding.activeWorkOrderId !== activeWorkOrderId) {
        wall(
          "Persisted queue Work Order binding does not match the canonical projection",
          "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
        )
      }
      const verified = await verifyQueueWorkOrder({
        databaseUrl,
        ...binding,
        activeWorkOrderId,
        expectedWorkOrderStatus,
        now: now(),
      })
      if (!isExactLiveBinding(verified, binding, activeWorkOrderId)) {
        wall(
          "Persisted queue Work Order binding did not match the live queue fence",
          "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
        )
      }
      return withPersistedBinding(outcome, verified)
    }
    const bound = await bindQueueWorkOrder({
      databaseUrl,
      ...binding,
      activeWorkOrderId,
      now: now(),
    })
    if (!isExactLiveBinding(bound, binding, activeWorkOrderId)) {
      wall(
        "Initial queue Work Order binding did not return its exact live fence",
        "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
      )
    }
    return withPersistedBinding(outcome, bound)
  }

  async function refreshOutcome(outcome, terminalReplay = null) {
    requireExecutionProofContext()
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
      campaignWindowId,
      processIdentity,
      checkpointProofProvider,
      now: now(),
    })
    if (refreshed?.outcome && refreshed.acquired) {
      const governedOutcome = governedQueueOutcome(refreshed.outcome, outcome)
      const decision = evaluateOutcomePolicy({
        outcome: governedOutcome,
        actor: "bsvalues",
        repository: "bsvalues/terragroq",
        enabled: true,
        standingAuthority: true,
      })
      if (!decision.allowed) {
        await transitionQueue({
          databaseUrl,
          userId: refreshed.outcome.userId,
          outcomeKey: refreshed.outcome.outcomeKey,
          fromState: "active",
          toState: "blocked",
          expectedVersion: Number(refreshed.outcome.version),
          executionBinding: refreshed.outcome.executionBinding,
          leaseToken: refreshed.outcome.leaseToken,
          fencingToken: Number(refreshed.outcome.fencingToken),
          lifecycleReason: `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`,
          now: now(),
        })
        wall(decision.reasonCode, `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`)
      }
      return withPersistedBinding(governedOutcome, refreshed.outcome)
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
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    const resumeAt = now()
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
      now: resumeAt,
    })
    if (!isExactOwnerDecisionResume(resumed, binding, holderId, resumeAt)) {
      wall(
        "Owner-decision resume did not return its exact fresh queue fence",
        "HERMES_OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL",
      )
    }
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
