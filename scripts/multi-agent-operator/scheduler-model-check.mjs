import { createHash } from "node:crypto"

import { checkReservationCompatibility } from "./reservation-set.mjs"

const OWNER_COUNTERS = Object.freeze({
  ownerOperationTouchCount: 0,
  ownerCredentialTouchCount: 0,
  ownerDiagnosticTouchCount: 0,
  ownerRoutineDecisionCount: 0,
  ownerRoutineContactCount: 0,
})

const TERMINAL = new Set(["COMPLETE", "EXPIRED", "FAILED_TERMINAL"])
const EVENT_TYPES = new Set(["SCHEDULE", "COMPLETE", "CANCEL", "ADVANCE_TIME"])
const EXTERNAL_BLOCKS = new Set([
  "BLOCKED_DEPENDENCY",
  "BLOCKED_NO_ELIGIBLE_PROVIDER",
  "BLOCKED_POLICY_CHANGED",
  "BLOCKED_RESERVATION",
])

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(stableCompare).map((key) => [key, canonical(value[key])]))
  }
  return value
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function violation(code, detail) {
  return Object.freeze({ code, detail })
}

function cyclePath(workById) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  function visit(workOrderId) {
    if (visiting.has(workOrderId)) {
      const start = stack.indexOf(workOrderId)
      return [...stack.slice(start), workOrderId]
    }
    if (visited.has(workOrderId)) return null
    visiting.add(workOrderId)
    stack.push(workOrderId)
    for (const dependency of [...workById.get(workOrderId).dependencies].sort(stableCompare)) {
      if (!workById.has(dependency)) continue
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(workOrderId)
    visited.add(workOrderId)
    return null
  }

  for (const workOrderId of [...workById.keys()].sort(stableCompare)) {
    const cycle = visit(workOrderId)
    if (cycle) return cycle
  }
  return null
}

function validateDefinition(definition) {
  const violations = []
  if (!Number.isSafeInteger(definition.initialTime) || definition.initialTime < 0) {
    violations.push(violation("MODEL_TIME_WALL", "initialTime"))
  }
  if (!Number.isSafeInteger(definition.maxConcurrency) || definition.maxConcurrency < 1) {
    violations.push(violation("MODEL_CONCURRENCY_WALL", "maxConcurrency"))
  }
  if (!Number.isSafeInteger(definition.starvationThresholdMs) || definition.starvationThresholdMs < 1) {
    violations.push(violation("MODEL_STARVATION_WALL", "starvationThresholdMs"))
  }
  if (!Array.isArray(definition.workOrders) || definition.workOrders.length === 0) {
    violations.push(violation("MODEL_WORK_ORDER_WALL", "workOrders"))
    return { violations, workById: new Map() }
  }

  const workById = new Map()
  for (const work of definition.workOrders) {
    if (typeof work?.workOrderId !== "string" || work.workOrderId.length === 0) {
      violations.push(violation("MODEL_WORK_ORDER_WALL", "workOrderId"))
      continue
    }
    if (workById.has(work.workOrderId)) {
      violations.push(violation("MODEL_DUPLICATE_WORK_ORDER", work.workOrderId))
      continue
    }
    if (!Array.isArray(work.dependencies) || new Set(work.dependencies).size !== work.dependencies.length) {
      violations.push(violation("MODEL_DEPENDENCY_WALL", work.workOrderId))
      continue
    }
    if (!Number.isSafeInteger(work.priority) || work.priority < 0) {
      violations.push(violation("MODEL_PRIORITY_WALL", work.workOrderId))
      continue
    }
    if (!Number.isSafeInteger(work.availableAt) || work.availableAt < definition.initialTime) {
      violations.push(violation("MODEL_TIME_WALL", `${work.workOrderId}.availableAt`))
      continue
    }
    if (work.expiresAt !== null && (!Number.isSafeInteger(work.expiresAt) || work.expiresAt <= work.availableAt)) {
      violations.push(violation("MODEL_EXPIRY_WALL", work.workOrderId))
      continue
    }
    if (work.externalBlock !== null && !EXTERNAL_BLOCKS.has(work.externalBlock)) {
      violations.push(violation("MODEL_EXTERNAL_BLOCK_WALL", work.workOrderId))
      continue
    }
    let normalizedReservation
    try {
      normalizedReservation = checkReservationCompatibility(work.reservationSet, {
        ...work.reservationSet,
        reservationSetId: `${work.reservationSet?.reservationSetId ?? "invalid"}-validation-peer`,
        workOrderId: `${work.workOrderId}-VALIDATION-PEER`,
      })
    } catch {
      violations.push(violation("MODEL_RESERVATION_WALL", work.workOrderId))
      continue
    }
    if (normalizedReservation.status === "INVALID") {
      violations.push(violation("MODEL_RESERVATION_WALL", work.workOrderId))
      continue
    }
    workById.set(work.workOrderId, Object.freeze({ ...work, dependencies: Object.freeze([...work.dependencies]) }))
  }

  for (const work of workById.values()) {
    for (const dependency of work.dependencies) {
      if (!workById.has(dependency)) violations.push(violation("MODEL_MISSING_DEPENDENCY", `${work.workOrderId}:${dependency}`))
    }
  }
  const cycle = cyclePath(workById)
  if (cycle) violations.push(violation("MODEL_CYCLE", cycle.join("->")))
  return { violations, workById }
}

function snapshot(state) {
  const workOrders = [...state.work.values()]
    .sort((left, right) => stableCompare(left.workOrderId, right.workOrderId))
    .map((entry) => ({ ...entry }))
  return Object.freeze({ time: state.time, workOrders: Object.freeze(workOrders) })
}

function createInitialState(definition, workById) {
  return {
    time: definition.initialTime,
    work: new Map([...workById].map(([id, work]) => [id, {
      ...work,
      lifecycleState: "PLANNED",
      reasonCode: null,
      firstEligibleAt: null,
      dispatchedAt: null,
      terminalAt: null,
      dispatchCount: 0,
    }])),
  }
}

function cloneState(state) {
  return {
    time: state.time,
    work: new Map([...state.work].map(([id, entry]) => [id, { ...entry }])),
  }
}

function semanticState(state) {
  return {
    time: state.time,
    workOrders: [...state.work.values()]
      .sort((left, right) => stableCompare(left.workOrderId, right.workOrderId))
      .map((entry) => ({
        workOrderId: entry.workOrderId,
        lifecycleState: entry.lifecycleState,
        reasonCode: entry.reasonCode,
        firstEligibleAt: entry.firstEligibleAt,
        dispatchedAt: entry.dispatchedAt,
        terminalAt: entry.terminalAt,
        dispatchCount: entry.dispatchCount,
      })),
  }
}

export function schedulerModelStateHash(stateSnapshot) {
  return digest({
    time: stateSnapshot.time,
    workOrders: [...stateSnapshot.workOrders]
      .sort((left, right) => stableCompare(left.workOrderId, right.workOrderId))
      .map((entry) => ({
        workOrderId: entry.workOrderId,
        lifecycleState: entry.lifecycleState,
        reasonCode: entry.reasonCode,
        firstEligibleAt: entry.firstEligibleAt,
        dispatchedAt: entry.dispatchedAt,
        terminalAt: entry.terminalAt,
        dispatchCount: entry.dispatchCount,
      })),
  })
}

function failDependents(state, rootWorkOrderId, reasonCode) {
  const queue = [rootWorkOrderId]
  while (queue.length > 0) {
    const failedId = queue.shift()
    for (const entry of state.work.values()) {
      if (TERMINAL.has(entry.lifecycleState) || !entry.dependencies.includes(failedId)) continue
      entry.lifecycleState = "FAILED_TERMINAL"
      entry.reasonCode = reasonCode
      entry.terminalAt = state.time
      queue.push(entry.workOrderId)
    }
  }
}

function expireWork(state) {
  for (const entry of state.work.values()) {
    if (!["PLANNED", "EXECUTING"].includes(entry.lifecycleState)
      || entry.expiresAt === null || entry.expiresAt > state.time) continue
    entry.lifecycleState = "EXPIRED"
    entry.reasonCode = "LEASE_OR_QUEUE_EXPIRY"
    entry.terminalAt = state.time
    failDependents(state, entry.workOrderId, "DEPENDENCY_EXPIRED")
  }
}

function dependencyComplete(state, entry) {
  return entry.dependencies.every((dependency) => state.work.get(dependency).lifecycleState === "COMPLETE")
}

function compatibleWithRunning(state, candidate) {
  for (const running of state.work.values()) {
    if (running.lifecycleState !== "EXECUTING") continue
    const compatibility = checkReservationCompatibility(candidate.reservationSet, running.reservationSet)
    if (!compatibility.compatible) return false
  }
  return true
}

function eligible(state, entry) {
  return entry.lifecycleState === "PLANNED"
    && entry.availableAt <= state.time
    && entry.dispatchable
    && entry.externalBlock === null
    && dependencyComplete(state, entry)
}

function schedule(state, definition) {
  const runningCount = () => [...state.work.values()].filter((entry) => entry.lifecycleState === "EXECUTING").length
  const candidates = [...state.work.values()].filter((entry) => eligible(state, entry))
  for (const entry of candidates) {
    if (entry.firstEligibleAt === null) entry.firstEligibleAt = state.time
  }
  candidates.sort((left, right) => {
    const leftStarved = state.time - left.firstEligibleAt >= definition.starvationThresholdMs
    const rightStarved = state.time - right.firstEligibleAt >= definition.starvationThresholdMs
    return Number(rightStarved) - Number(leftStarved)
      || right.priority - left.priority
      || left.firstEligibleAt - right.firstEligibleAt
      || stableCompare(left.workOrderId, right.workOrderId)
  })

  for (const candidate of candidates) {
    if (runningCount() >= definition.maxConcurrency) break
    if (!compatibleWithRunning(state, candidate)) continue
    candidate.lifecycleState = "EXECUTING"
    candidate.reasonCode = null
    candidate.dispatchCount += 1
    candidate.dispatchedAt = state.time
  }
}

function assertInvariants(state, definition, violations) {
  const running = [...state.work.values()].filter((entry) => entry.lifecycleState === "EXECUTING")
  if (running.length > definition.maxConcurrency) {
    violations.push(violation("MODEL_CONCURRENCY_EXCEEDED", String(running.length)))
  }
  for (let left = 0; left < running.length; left += 1) {
    const entry = running[left]
    if (!entry.dependencies.every((id) => state.work.get(id).lifecycleState === "COMPLETE")) {
      violations.push(violation("MODEL_FAN_IN_VIOLATION", entry.workOrderId))
    }
    if (entry.expiresAt !== null && entry.expiresAt <= state.time) {
      violations.push(violation("MODEL_EXPIRY_VIOLATION", entry.workOrderId))
    }
    for (let right = left + 1; right < running.length; right += 1) {
      const compatibility = checkReservationCompatibility(entry.reservationSet, running[right].reservationSet)
      if (!compatibility.compatible) {
        violations.push(violation("MODEL_RESERVATION_COLLISION", `${entry.workOrderId}:${running[right].workOrderId}`))
      }
    }
  }
  for (const entry of state.work.values()) {
    if (entry.dispatchCount > 1) violations.push(violation("MODEL_DUPLICATE_EFFECT", entry.workOrderId))
  }
}

function assertTerminalImmutability(previous, next, transition, violations) {
  for (const prior of previous.work.values()) {
    if (!TERMINAL.has(prior.lifecycleState)) continue
    const current = next.work.get(prior.workOrderId)
    const priorTerminal = {
      lifecycleState: prior.lifecycleState,
      reasonCode: prior.reasonCode,
      terminalAt: prior.terminalAt,
      dispatchCount: prior.dispatchCount,
    }
    const currentTerminal = {
      lifecycleState: current.lifecycleState,
      reasonCode: current.reasonCode,
      terminalAt: current.terminalAt,
      dispatchCount: current.dispatchCount,
    }
    if (digest(priorTerminal) !== digest(currentTerminal)) {
      violations.push(violation("MODEL_TERMINAL_IMMUTABILITY_VIOLATION", `${prior.workOrderId}:${transition.type}`))
    }
  }
}

function blockedByExternalRoot(state, entry, seen = new Set()) {
  if (entry.externalBlock !== null) return entry.externalBlock
  if (seen.has(entry.workOrderId)) return null
  const nextSeen = new Set(seen).add(entry.workOrderId)
  for (const dependency of entry.dependencies) {
    const dependencyEntry = state.work.get(dependency)
    if (dependencyEntry.lifecycleState === "COMPLETE") continue
    const reason = blockedByExternalRoot(state, dependencyEntry, nextSeen)
    if (reason !== null) return reason
  }
  return null
}

function externalBlockOutcome(state) {
  const unfinished = [...state.work.values()].filter((entry) => !TERMINAL.has(entry.lifecycleState))
  if (unfinished.length === 0 || unfinished.some((entry) => entry.lifecycleState === "EXECUTING")) return null
  const blocked = unfinished.map((entry) => ({
    workOrderId: entry.workOrderId,
    reasonCode: blockedByExternalRoot(state, entry),
  }))
  if (blocked.some(({ reasonCode }) => reasonCode === null)) return null
  return Object.freeze({
    workOrderIds: Object.freeze(blocked.map(({ workOrderId }) => workOrderId).sort(stableCompare)),
    reasonCodes: Object.freeze([...new Set(blocked.map(({ reasonCode }) => reasonCode))].sort(stableCompare)),
  })
}

function deadlock(state) {
  const unfinished = [...state.work.values()].filter((entry) => !TERMINAL.has(entry.lifecycleState))
  if (unfinished.length === 0 || unfinished.some((entry) => entry.lifecycleState === "EXECUTING")) return null
  if (externalBlockOutcome(state) !== null) return null
  if (unfinished.some((entry) => entry.availableAt > state.time)) return null
  if (unfinished.some((entry) => eligible(state, entry))) return null
  return Object.freeze(unfinished.map((entry) => entry.workOrderId).sort(stableCompare))
}

function applyTransition(state, definition, transition) {
  const next = cloneState(state)
  if (transition.type === "ADVANCE_TIME") {
    next.time = transition.to
    expireWork(next)
  } else if (transition.type === "SCHEDULE") {
    schedule(next, definition)
  } else {
    const entry = next.work.get(transition.workOrderId)
    if (transition.type === "COMPLETE") {
      entry.lifecycleState = "COMPLETE"
      entry.reasonCode = null
      entry.terminalAt = next.time
    } else {
      entry.lifecycleState = "FAILED_TERMINAL"
      entry.reasonCode = "CANCELLED"
      entry.terminalAt = next.time
      failDependents(next, entry.workOrderId, "DEPENDENCY_CANCELLED")
    }
  }
  return next
}

function nextAdvanceTime(state, definition, options) {
  const boundaries = []
  let hasRunningWork = false
  for (const entry of state.work.values()) {
    if (TERMINAL.has(entry.lifecycleState)) continue
    if (entry.lifecycleState === "EXECUTING") hasRunningWork = true
    if (entry.availableAt > state.time) boundaries.push(entry.availableAt)
    if (entry.expiresAt !== null && entry.expiresAt > state.time) boundaries.push(entry.expiresAt)
    if (entry.firstEligibleAt !== null) {
      const starvationAt = entry.firstEligibleAt + definition.starvationThresholdMs
      if (starvationAt > state.time) boundaries.push(starvationAt)
    }
  }
  if (hasRunningWork) boundaries.push(state.time + options.advanceTimeStepMs)
  if (boundaries.length === 0) return null
  const next = Math.min(...boundaries.filter((value) => value > state.time))
  return next <= options.maxTime ? next : null
}

function generatedTransitions(state, definition, options) {
  if ([...state.work.values()].every((entry) => TERMINAL.has(entry.lifecycleState))) return []
  const transitions = []
  const scheduled = applyTransition(state, definition, { type: "SCHEDULE" })
  if (digest(semanticState(scheduled)) !== digest(semanticState(state))) transitions.push(Object.freeze({ type: "SCHEDULE" }))

  const ordered = [...state.work.values()].sort((left, right) => stableCompare(left.workOrderId, right.workOrderId))
  for (const entry of ordered) {
    if (entry.lifecycleState === "EXECUTING") {
      transitions.push(Object.freeze({ type: "COMPLETE", workOrderId: entry.workOrderId }))
    }
  }
  for (const entry of ordered) {
    if (!TERMINAL.has(entry.lifecycleState)) {
      transitions.push(Object.freeze({ type: "CANCEL", workOrderId: entry.workOrderId }))
    }
  }
  const advanceTo = nextAdvanceTime(state, definition, options)
  if (advanceTo !== null) transitions.push(Object.freeze({ type: "ADVANCE_TIME", to: advanceTo }))
  return transitions
}

function actionableStarved(state, definition) {
  const runningCount = [...state.work.values()].filter((entry) => entry.lifecycleState === "EXECUTING").length
  if (runningCount >= definition.maxConcurrency) return []
  return [...state.work.values()]
    .filter((entry) => eligible(state, entry)
      && entry.firstEligibleAt !== null
      && state.time - entry.firstEligibleAt >= definition.starvationThresholdMs
      && compatibleWithRunning(state, entry))
    .map(({ workOrderId }) => workOrderId)
    .sort(stableCompare)
}

function explorerOptions(definition, options) {
  const normalized = {
    maxDepth: options?.maxDepth ?? 8,
    maxStates: options?.maxStates ?? 500,
    maxTime: options?.maxTime ?? definition.initialTime + definition.starvationThresholdMs * 2,
    advanceTimeStepMs: options?.advanceTimeStepMs ?? definition.starvationThresholdMs,
  }
  if (!Number.isSafeInteger(normalized.maxDepth) || normalized.maxDepth < 0) {
    return { normalized, violation: violation("MODEL_EXPLORER_BOUND_WALL", "maxDepth") }
  }
  for (const field of ["maxStates", "advanceTimeStepMs"]) {
    if (!Number.isSafeInteger(normalized[field]) || normalized[field] < 1) {
      return { normalized, violation: violation("MODEL_EXPLORER_BOUND_WALL", field) }
    }
  }
  if (!Number.isSafeInteger(normalized.maxTime) || normalized.maxTime < definition.initialTime) {
    return { normalized, violation: violation("MODEL_EXPLORER_BOUND_WALL", "maxTime") }
  }
  return { normalized, violation: null }
}

export function schedulerModelReservationSet(workOrderId, paths) {
  return Object.freeze({
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_SET",
    reservationSetId: `model-${workOrderId.toLowerCase()}`,
    workerId: `model-worker-${workOrderId.toLowerCase()}`,
    workOrderId,
    reservations: Object.freeze({
      paths: Object.freeze(paths.map((path) => Object.freeze({ repository: "model/repository", path }))),
      contracts: Object.freeze([]),
      environments: Object.freeze([]),
      repositories: Object.freeze([]),
      protectedResources: Object.freeze([]),
    }),
  })
}

export function schedulerModelWorkOrder(workOrderId, overrides = {}) {
  return Object.freeze({
    workOrderId,
    dependencies: Object.freeze([]),
    reservationSet: schedulerModelReservationSet(workOrderId, [`model/${workOrderId.toLowerCase()}.ts`]),
    priority: 0,
    availableAt: 0,
    expiresAt: null,
    dispatchable: true,
    externalBlock: null,
    ...overrides,
  })
}

export function exploreSchedulerModel(definition, options = {}) {
  const checked = validateDefinition(definition)
  const bounds = explorerOptions(definition, options)
  const definitionViolations = [...checked.violations]
  if (bounds.violation !== null) definitionViolations.push(bounds.violation)
  if (definitionViolations.length > 0) {
    const report = {
      status: "MODEL_EXPLORATION_REJECTED",
      violations: Object.freeze(definitionViolations),
      exploredStateCount: 0,
      exploredTransitionCount: 0,
      deduplicatedStateCount: 0,
      exploredStates: Object.freeze([]),
      semanticStateHashes: Object.freeze([]),
      outcomes: Object.freeze({
        terminalStateCount: 0,
        liveStateCount: 0,
        depthBoundStateCount: 0,
        deadlocks: Object.freeze([]),
        externalBlocks: Object.freeze([]),
      }),
      liveness: Object.freeze({ status: "NOT_EVALUATED" }),
      starvation: Object.freeze({ status: "NOT_EVALUATED", observedWorkOrderIds: Object.freeze([]), releasedWorkOrderIds: Object.freeze([]) }),
      truncated: false,
      coverageComplete: false,
      bounds: Object.freeze(bounds.normalized),
      ownerCounters: OWNER_COUNTERS,
      runtimeActivated: false,
      dispatchPerformed: false,
    }
    return Object.freeze({ ...report, explorationHash: digest(report) })
  }

  const initial = createInitialState(definition, checked.workById)
  const initialSnapshot = snapshot(initial)
  const initialHash = schedulerModelStateHash(initialSnapshot)
  const queue = [{ state: initial, stateHash: initialHash, depth: 0, trace: Object.freeze([]) }]
  const visited = new Set([initialHash])
  const exploredStates = []
  const violations = []
  const deadlocks = []
  const externalBlocks = []
  const observedStarved = new Set()
  const releasedStarved = new Set()
  let exploredTransitionCount = 0
  let deduplicatedStateCount = 0
  let terminalStateCount = 0
  let liveStateCount = 0
  let depthBoundStateCount = 0
  let truncated = false

  while (queue.length > 0) {
    const current = queue.shift()
    const currentSnapshot = snapshot(current.state)
    exploredStates.push(Object.freeze({
      stateHash: current.stateHash,
      depth: current.depth,
      snapshot: currentSnapshot,
      trace: current.trace,
    }))
    const stateViolations = []
    assertInvariants(current.state, definition, stateViolations)
    for (const entry of stateViolations) violations.push(Object.freeze({ ...entry, stateHash: current.stateHash, trace: current.trace }))

    const unfinished = [...current.state.work.values()].filter((entry) => !TERMINAL.has(entry.lifecycleState))
    const externalBlock = externalBlockOutcome(current.state)
    const deadlockedWorkOrderIds = deadlock(current.state)
    if (unfinished.length === 0) {
      terminalStateCount += 1
    } else if (externalBlock !== null) {
      externalBlocks.push(Object.freeze({ stateHash: current.stateHash, ...externalBlock, trace: current.trace }))
    } else if (deadlockedWorkOrderIds !== null) {
      deadlocks.push(Object.freeze({ stateHash: current.stateHash, workOrderIds: deadlockedWorkOrderIds, trace: current.trace }))
    } else {
      liveStateCount += 1
    }

    const starvedBefore = actionableStarved(current.state, definition)
    for (const workOrderId of starvedBefore) observedStarved.add(workOrderId)
    if (current.depth >= bounds.normalized.maxDepth && unfinished.length > 0) {
      depthBoundStateCount += 1
      continue
    }

    for (const transition of generatedTransitions(current.state, definition, bounds.normalized)) {
      exploredTransitionCount += 1
      const next = applyTransition(current.state, definition, transition)
      const nextTrace = Object.freeze([...current.trace, transition])
      const transitionViolations = []
      assertInvariants(next, definition, transitionViolations)
      assertTerminalImmutability(current.state, next, transition, transitionViolations)
      if (transition.type === "SCHEDULE" && starvedBefore.length > 0) {
        const released = starvedBefore.filter((workOrderId) => next.work.get(workOrderId).lifecycleState === "EXECUTING")
        if (released.length === 0) {
          transitionViolations.push(violation("MODEL_STARVATION_VIOLATION", starvedBefore.join(",")))
        }
        for (const workOrderId of released) releasedStarved.add(workOrderId)
      }
      const nextSnapshot = snapshot(next)
      const nextHash = schedulerModelStateHash(nextSnapshot)
      for (const entry of transitionViolations) violations.push(Object.freeze({ ...entry, stateHash: nextHash, trace: nextTrace }))
      if (visited.has(nextHash)) {
        deduplicatedStateCount += 1
        continue
      }
      if (visited.size >= bounds.normalized.maxStates) {
        truncated = true
        continue
      }
      visited.add(nextHash)
      queue.push({ state: next, stateHash: nextHash, depth: current.depth + 1, trace: nextTrace })
    }
  }

  const observedWorkOrderIds = [...observedStarved].sort(stableCompare)
  const releasedWorkOrderIds = [...releasedStarved].sort(stableCompare)
  const unreleasedWorkOrderIds = observedWorkOrderIds.filter((workOrderId) => !releasedStarved.has(workOrderId))
  const starvationStatus = observedWorkOrderIds.length === 0
    ? "NOT_OBSERVED"
    : unreleasedWorkOrderIds.length === 0 ? "BOUNDED_RELEASE_PATH_PROVEN" : "BOUNDED_RELEASE_INCONCLUSIVE"
  const livenessStatus = deadlocks.length > 0
    ? "DEADLOCK_REACHABLE"
    : externalBlocks.length > 0 && liveStateCount === 0 ? "EXTERNALLY_BLOCKED"
      : terminalStateCount > 0 ? "TERMINAL_REACHABLE" : "BOUNDED_LIVE"
  const coverageComplete = !truncated && depthBoundStateCount === 0
  const report = {
    status: violations.length > 0
      ? "MODEL_EXPLORATION_VIOLATION"
      : coverageComplete ? "MODEL_EXPLORATION_PASS" : "MODEL_EXPLORATION_INCONCLUSIVE",
    violations: Object.freeze(violations),
    exploredStateCount: exploredStates.length,
    exploredTransitionCount,
    deduplicatedStateCount,
    exploredStates: Object.freeze(exploredStates),
    semanticStateHashes: Object.freeze([...visited].sort(stableCompare)),
    outcomes: Object.freeze({
      terminalStateCount,
      liveStateCount,
      depthBoundStateCount,
      deadlocks: Object.freeze(deadlocks),
      externalBlocks: Object.freeze(externalBlocks),
    }),
    liveness: Object.freeze({ status: livenessStatus }),
    starvation: Object.freeze({
      status: starvationStatus,
      observedWorkOrderIds: Object.freeze(observedWorkOrderIds),
      releasedWorkOrderIds: Object.freeze(releasedWorkOrderIds),
      unreleasedWorkOrderIds: Object.freeze(unreleasedWorkOrderIds),
    }),
    truncated,
    coverageComplete,
    bounds: Object.freeze(bounds.normalized),
    ownerCounters: OWNER_COUNTERS,
    runtimeActivated: false,
    dispatchPerformed: false,
  }
  return Object.freeze({ ...report, explorationHash: digest(report) })
}

export function verifySchedulerModelExplorationReplay(definition, options = {}) {
  const first = exploreSchedulerModel(definition, options)
  const second = exploreSchedulerModel(definition, options)
  return Object.freeze({
    deterministic: first.explorationHash === second.explorationHash,
    explorationHash: first.explorationHash,
    first,
    second,
  })
}

export function runSchedulerModelCheck(definition, events) {
  const checked = validateDefinition(definition)
  const violations = [...checked.violations]
  if (violations.length > 0) {
    const report = {
      status: "MODEL_REJECTED",
      violations,
      deadlockedWorkOrderIds: null,
      duplicateDeliveryCount: 0,
      ownerCounters: OWNER_COUNTERS,
      runtimeActivated: false,
      dispatchPerformed: false,
      trace: Object.freeze([]),
      finalState: null,
    }
    return Object.freeze({ ...report, replayHash: digest(report) })
  }

  const state = createInitialState(definition, checked.workById)
  const delivered = new Map()
  const trace = [snapshot(state)]
  let duplicateDeliveryCount = 0
  let lastEventTime = definition.initialTime

  for (const event of events) {
    if (!EVENT_TYPES.has(event?.type) || typeof event.eventId !== "string" || !Number.isSafeInteger(event.at)) {
      violations.push(violation("MODEL_EVENT_WALL", String(event?.eventId ?? "UNKNOWN")))
      continue
    }
    const eventHash = digest(event)
    if (delivered.has(event.eventId)) {
      if (delivered.get(event.eventId) !== eventHash) violations.push(violation("MODEL_DUPLICATE_CONFLICT", event.eventId))
      else duplicateDeliveryCount += 1
      continue
    }
    if (event.at < lastEventTime) {
      violations.push(violation("MODEL_EVENT_ORDER_WALL", event.eventId))
      continue
    }
    delivered.set(event.eventId, eventHash)
    lastEventTime = event.at
    state.time = event.at
    expireWork(state)

    if (event.type === "SCHEDULE") {
      schedule(state, definition)
    } else if (event.type !== "ADVANCE_TIME") {
      const entry = state.work.get(event.workOrderId)
      if (!entry) {
        violations.push(violation("MODEL_UNKNOWN_WORK_ORDER", String(event.workOrderId)))
      } else if (event.type === "COMPLETE") {
        if (entry.lifecycleState === "COMPLETE") {
          // A separately delivered duplicate completion is an idempotent terminal observation.
        } else if (TERMINAL.has(entry.lifecycleState)) {
          violations.push(violation("MODEL_TERMINAL_CONFLICT", `${entry.workOrderId}:COMPLETE_AFTER_${entry.lifecycleState}`))
        } else if (entry.lifecycleState !== "EXECUTING") violations.push(violation("MODEL_ILLEGAL_COMPLETION", entry.workOrderId))
        else {
          entry.lifecycleState = "COMPLETE"
          entry.reasonCode = null
          entry.terminalAt = state.time
        }
      } else if (entry.lifecycleState === "FAILED_TERMINAL" && entry.reasonCode === "CANCELLED") {
        // A separately delivered duplicate cancellation is an idempotent terminal observation.
      } else if (TERMINAL.has(entry.lifecycleState)) {
        violations.push(violation("MODEL_TERMINAL_CONFLICT", `${entry.workOrderId}:CANCEL_AFTER_${entry.lifecycleState}`))
      } else {
        entry.lifecycleState = "FAILED_TERMINAL"
        entry.reasonCode = "CANCELLED"
        entry.terminalAt = state.time
        failDependents(state, entry.workOrderId, "DEPENDENCY_CANCELLED")
      }
    }
    assertInvariants(state, definition, violations)
    trace.push(snapshot(state))
  }

  const deadlockedWorkOrderIds = deadlock(state)
  const report = {
    status: violations.length > 0 ? "MODEL_VIOLATION" : deadlockedWorkOrderIds ? "MODEL_DEADLOCK" : "MODEL_PASS",
    violations: Object.freeze(violations),
    deadlockedWorkOrderIds,
    duplicateDeliveryCount,
    ownerCounters: OWNER_COUNTERS,
    runtimeActivated: false,
    dispatchPerformed: false,
    trace: Object.freeze(trace),
    finalState: trace.at(-1),
  }
  return Object.freeze({ ...report, replayHash: digest(report) })
}

export function verifySchedulerModelReplay(definition, events) {
  const first = runSchedulerModelCheck(definition, events)
  const second = runSchedulerModelCheck(definition, events)
  return Object.freeze({ deterministic: first.replayHash === second.replayHash, replayHash: first.replayHash, first, second })
}
