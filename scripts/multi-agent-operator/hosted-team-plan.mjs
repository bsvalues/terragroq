import {
  DispatchEnvelopeError,
  validateDispatchEnvelope,
} from "./dispatch-envelope.mjs"
import {
  checkReservationCompatibility,
  normalizeReservationSet,
} from "./reservation-set.mjs"

function stableCompare(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "variant" })
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export class HostedTeamPlanError extends Error {
  constructor(code, detail = code) {
    super(`${code}:${detail}`)
    this.name = "HostedTeamPlanError"
    this.code = code
    this.detail = detail
  }
}

function wall(code, detail) {
  throw new HostedTeamPlanError(code, detail)
}

function normalizeCompletedIds(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    wall("HOSTED_TEAM_PLAN_INPUT_WALL", "completedWorkOrderIds")
  }
  const normalized = value.map((entry) => entry.trim()).sort(stableCompare)
  if (new Set(normalized).size !== normalized.length) {
    wall("HOSTED_TEAM_PLAN_INPUT_WALL", "duplicate-completed-work-order")
  }
  return normalized
}

function reservationSetFor(envelope) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_SET",
    reservationSetId: `reservation-${envelope.workOrderId}`,
    workerId: envelope.teamRoles.builder,
    workOrderId: envelope.workOrderId,
    reservations: {
      paths: envelope.reservations.paths.map(({ repository, path }) => ({ repository, path })),
      contracts: [...envelope.reservations.contracts],
      environments: [...envelope.reservations.environments],
      repositories: [],
      protectedResources: [],
    },
  }
}

function block(candidate, reasonCode, detail = {}) {
  return Object.freeze({
    workOrderId: candidate.workOrderId,
    laneId: candidate.laneId,
    reasonCode,
    ...detail,
  })
}

export function planHostedTeamWave(input) {
  if (!plainObject(input)
    || input.schemaVersion !== 1
    || input.artifactType !== "HOSTED_TEAM_PLAN_INPUT"
    || !Array.isArray(input.candidates)) {
    wall("HOSTED_TEAM_PLAN_INPUT_WALL", "schema")
  }

  const completedWorkOrderIds = normalizeCompletedIds(input.completedWorkOrderIds)
  const completed = new Set(completedWorkOrderIds)
  const candidates = input.candidates.map((raw, inputIndex) => {
    try {
      const validated = validateDispatchEnvelope(raw)
      return {
        valid: true,
        inputIndex,
        envelope: validated.envelope,
        contentHash: validated.contentHash,
        workOrderId: validated.envelope.workOrderId,
        laneId: validated.envelope.laneId,
      }
    } catch (error) {
      if (!(error instanceof DispatchEnvelopeError)) throw error
      return {
        valid: false,
        inputIndex,
        workOrderId: typeof raw?.workOrderId === "string" ? raw.workOrderId : `INVALID-${inputIndex}`,
        laneId: typeof raw?.laneId === "string" ? raw.laneId : `INVALID-${inputIndex}`,
        validationCode: error.code,
        validationField: error.field,
      }
    }
  }).sort((left, right) => stableCompare(left.workOrderId, right.workOrderId)
    || stableCompare(left.laneId, right.laneId)
    || left.inputIndex - right.inputIndex)

  const workOrderCounts = new Map()
  const laneCounts = new Map()
  for (const candidate of candidates) {
    workOrderCounts.set(candidate.workOrderId, (workOrderCounts.get(candidate.workOrderId) ?? 0) + 1)
    laneCounts.set(candidate.laneId, (laneCounts.get(candidate.laneId) ?? 0) + 1)
  }

  const selected = []
  const blocked = []
  for (const candidate of candidates) {
    if (!candidate.valid) {
      blocked.push(block(candidate, "DISPATCH_ENVELOPE_INVALID", {
        validationCode: candidate.validationCode,
        validationField: candidate.validationField,
      }))
      continue
    }
    if (workOrderCounts.get(candidate.workOrderId) > 1) {
      blocked.push(block(candidate, "DUPLICATE_WORK_ORDER_CANDIDATE"))
      continue
    }
    if (laneCounts.get(candidate.laneId) > 1) {
      blocked.push(block(candidate, "DUPLICATE_LANE_CANDIDATE"))
      continue
    }

    const completedDependencies = candidate.envelope.dependencies
      .filter((dependency) => completed.has(dependency))
      .sort(stableCompare)
    const incompleteDependencies = candidate.envelope.dependencies
      .filter((dependency) => !completed.has(dependency))
      .sort(stableCompare)
    const dependencyGateSatisfied = candidate.envelope.fanInGate === "ALL"
      ? incompleteDependencies.length === 0
      : candidate.envelope.dependencies.length === 0 || completedDependencies.length > 0
    if (!dependencyGateSatisfied) {
      blocked.push(block(candidate, "DEPENDENCY_INCOMPLETE", {
        fanInGate: candidate.envelope.fanInGate,
        completedDependencies,
        incompleteDependencies,
      }))
      continue
    }

    const reservationSet = reservationSetFor(candidate.envelope)
    const normalizedReservation = normalizeReservationSet(reservationSet)
    if (!normalizedReservation.valid) {
      blocked.push(block(candidate, "INVALID_RESERVATION_SET", {
        reasonCodes: [...new Set(normalizedReservation.diagnostics.map(({ reasonCode }) => reasonCode))],
      }))
      continue
    }
    const collisions = []
    for (const admitted of selected) {
      const compatibility = checkReservationCompatibility(admitted.reservationSet, reservationSet)
      if (!compatibility.compatible) {
        collisions.push({
          blockingWorkOrderId: admitted.workOrderId,
          reasonCodes: [...compatibility.reasonCodes],
        })
      }
    }
    if (collisions.length > 0) {
      blocked.push(block(candidate, "RESERVATION_CONFLICT", { collisions }))
      continue
    }

    selected.push({
      workOrderId: candidate.workOrderId,
      laneId: candidate.laneId,
      contentHash: candidate.contentHash,
      reservationSet,
    })
  }

  return Object.freeze({
    schemaVersion: 1,
    artifactType: "HOSTED_TEAM_PLAN",
    status: selected.length > 0 ? "WAVE_READY" : "NO_ELIGIBLE_CANDIDATES",
    completedWorkOrderIds: Object.freeze(completedWorkOrderIds),
    selected: Object.freeze(selected.map((candidate, laneOrdinal) => Object.freeze({
      workOrderId: candidate.workOrderId,
      laneId: candidate.laneId,
      laneOrdinal,
      contentHash: candidate.contentHash,
    }))),
    blocked: Object.freeze(blocked),
    planningOnly: true,
    dispatchPerformed: false,
    authorityGranted: false,
    atomicReservationClaimed: false,
  })
}
