import { describe, expect, it } from "vitest"

import {
  exploreSchedulerModel,
  runSchedulerModelCheck,
  schedulerModelReservationSet,
  schedulerModelWorkOrder,
  verifySchedulerModelExplorationReplay,
  verifySchedulerModelReplay,
} from "../scripts/multi-agent-operator/scheduler-model-check.mjs"

const definition = (workOrders: unknown[], overrides: Record<string, unknown> = {}) => ({
  initialTime: 0,
  maxConcurrency: 2,
  starvationThresholdMs: 10,
  workOrders,
  ...overrides,
})

const schedule = (eventId: string, at: number) => ({ type: "SCHEDULE", eventId, at })
const complete = (eventId: string, at: number, workOrderId: string) => ({ type: "COMPLETE", eventId, at, workOrderId })
const cancel = (eventId: string, at: number, workOrderId: string) => ({ type: "CANCEL", eventId, at, workOrderId })

function lifecycle(report: ReturnType<typeof runSchedulerModelCheck>, workOrderId: string) {
  if (report.finalState === null) throw new Error("model report has no final state")
  return report.finalState.workOrders.find((entry: { workOrderId: string }) => entry.workOrderId === workOrderId)?.lifecycleState
}

describe("WO-MAO-028 deterministic scheduler model check", () => {
  it("releases a DAG fan-in only after every dependency completes", () => {
    const workOrders = [
      schedulerModelWorkOrder("WO-MAO-101"),
      schedulerModelWorkOrder("WO-MAO-102"),
      schedulerModelWorkOrder("WO-MAO-103", { dependencies: ["WO-MAO-101", "WO-MAO-102"] }),
    ]
    const report = runSchedulerModelCheck(definition(workOrders), [
      schedule("schedule-roots", 0),
      complete("complete-101", 1, "WO-MAO-101"),
      schedule("schedule-before-fan-in", 1),
      complete("complete-102", 2, "WO-MAO-102"),
      schedule("schedule-after-fan-in", 2),
    ])

    expect(report.status).toBe("MODEL_PASS")
    expect(report.trace[3].workOrders.find((entry) => entry.workOrderId === "WO-MAO-103")?.lifecycleState).toBe("PLANNED")
    expect(lifecycle(report, "WO-MAO-103")).toBe("EXECUTING")
  })

  it("rejects cycles before simulation and classifies an immovable queue as deadlocked", () => {
    const cycle = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-110", { dependencies: ["WO-MAO-111"] }),
      schedulerModelWorkOrder("WO-MAO-111", { dependencies: ["WO-MAO-110"] }),
    ]), [])
    const deadlock = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-112", { dispatchable: false }),
    ]), [schedule("schedule-blocked", 0)])

    expect(cycle).toMatchObject({ status: "MODEL_REJECTED", violations: [{ code: "MODEL_CYCLE" }] })
    expect(deadlock).toMatchObject({ status: "MODEL_DEADLOCK", deadlockedWorkOrderIds: ["WO-MAO-112"] })
  })

  it("never co-schedules colliding reservations and admits the lane after release", () => {
    const shared = schedulerModelReservationSet("WO-MAO-120", ["shared"])
    const workOrders = [
      schedulerModelWorkOrder("WO-MAO-120", { reservationSet: shared, priority: 2 }),
      schedulerModelWorkOrder("WO-MAO-121", {
        reservationSet: { ...shared, reservationSetId: "model-wo-mao-121", workerId: "worker-121", workOrderId: "WO-MAO-121" },
      }),
    ]
    const report = runSchedulerModelCheck(definition(workOrders), [
      schedule("schedule-collision", 0),
      complete("complete-holder", 1, "WO-MAO-120"),
      schedule("schedule-released", 1),
    ])

    expect(report.status).toBe("MODEL_PASS")
    expect(report.trace[1].workOrders.filter((entry) => entry.lifecycleState === "EXECUTING")).toHaveLength(1)
    expect(lifecycle(report, "WO-MAO-121")).toBe("EXECUTING")
  })

  it("makes identical duplicate delivery an idempotent no-op", () => {
    const event = schedule("delivery-130", 0)
    const report = runSchedulerModelCheck(definition([schedulerModelWorkOrder("WO-MAO-130")]), [event, { ...event }])

    expect(report).toMatchObject({ status: "MODEL_PASS", duplicateDeliveryCount: 1 })
    expect(report.finalState?.workOrders[0]).toMatchObject({ lifecycleState: "EXECUTING", dispatchCount: 1 })
  })

  it("deduplicates a delayed identical event before enforcing event-time order", () => {
    const original = schedule("delivery-131", 0)
    const report = runSchedulerModelCheck(definition([schedulerModelWorkOrder("WO-MAO-131")]), [
      original,
      complete("complete-131", 2, "WO-MAO-131"),
      { ...original },
    ])

    expect(report).toMatchObject({ status: "MODEL_PASS", duplicateDeliveryCount: 1, violations: [] })
    expect(lifecycle(report, "WO-MAO-131")).toBe("COMPLETE")
  })

  it("keeps terminal state immutable under both cancellation/completion race orderings", () => {
    const work = schedulerModelWorkOrder("WO-MAO-132")
    const cancelFirst = runSchedulerModelCheck(definition([work]), [
      schedule("schedule-132-a", 0),
      cancel("cancel-132-a", 1, "WO-MAO-132"),
      complete("complete-132-a", 1, "WO-MAO-132"),
    ])
    const completeFirst = runSchedulerModelCheck(definition([work]), [
      schedule("schedule-132-b", 0),
      complete("complete-132-b", 1, "WO-MAO-132"),
      cancel("cancel-132-b", 1, "WO-MAO-132"),
    ])

    expect(cancelFirst).toMatchObject({
      status: "MODEL_VIOLATION",
      violations: [{ code: "MODEL_TERMINAL_CONFLICT" }],
    })
    expect(lifecycle(cancelFirst, "WO-MAO-132")).toBe("FAILED_TERMINAL")
    expect(completeFirst).toMatchObject({
      status: "MODEL_VIOLATION",
      violations: [{ code: "MODEL_TERMINAL_CONFLICT" }],
    })
    expect(lifecycle(completeFirst, "WO-MAO-132")).toBe("COMPLETE")
  })

  it("returns a typed rejection for a malformed reservation set", () => {
    const report = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-133", { reservationSet: null }),
    ]), [])

    expect(report).toMatchObject({
      status: "MODEL_REJECTED",
      violations: [{ code: "MODEL_RESERVATION_WALL", detail: "WO-MAO-133" }],
    })
  })

  it("expires queued work without dispatch and terminalizes its dependents", () => {
    const report = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-140", { expiresAt: 5 }),
      schedulerModelWorkOrder("WO-MAO-141", { dependencies: ["WO-MAO-140"] }),
    ]), [schedule("schedule-after-expiry", 5)])

    expect(report.status).toBe("MODEL_PASS")
    expect(report.finalState?.workOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ workOrderId: "WO-MAO-140", lifecycleState: "EXPIRED", dispatchCount: 0 }),
      expect.objectContaining({ workOrderId: "WO-MAO-141", lifecycleState: "FAILED_TERMINAL", reasonCode: "DEPENDENCY_EXPIRED" }),
    ]))
  })

  it("promotes starved work ahead of newly available higher-priority work", () => {
    const report = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-150", { priority: 0 }),
      schedulerModelWorkOrder("WO-MAO-151", { priority: 5, availableAt: 10 }),
      schedulerModelWorkOrder("WO-MAO-152", { priority: 10 }),
    ], { maxConcurrency: 1 }), [
      schedule("schedule-holder", 0),
      complete("complete-holder", 10, "WO-MAO-152"),
      schedule("schedule-starved", 10),
    ])

    expect(report.status).toBe("MODEL_PASS")
    expect(lifecycle(report, "WO-MAO-150")).toBe("EXECUTING")
    expect(lifecycle(report, "WO-MAO-151")).toBe("PLANNED")
  })

  it("cancels an executing lane, releases capacity, and terminalizes fan-out dependents", () => {
    const report = runSchedulerModelCheck(definition([
      schedulerModelWorkOrder("WO-MAO-160", { priority: 10 }),
      schedulerModelWorkOrder("WO-MAO-161", { dependencies: ["WO-MAO-160"] }),
      schedulerModelWorkOrder("WO-MAO-162", { priority: 5 }),
    ], { maxConcurrency: 1 }), [
      schedule("schedule-160", 0),
      cancel("cancel-160", 1, "WO-MAO-160"),
      schedule("schedule-after-cancel", 1),
    ])

    expect(report.status).toBe("MODEL_PASS")
    expect(report.finalState?.workOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ workOrderId: "WO-MAO-160", lifecycleState: "FAILED_TERMINAL", reasonCode: "CANCELLED" }),
      expect.objectContaining({ workOrderId: "WO-MAO-161", lifecycleState: "FAILED_TERMINAL", reasonCode: "DEPENDENCY_CANCELLED" }),
      expect.objectContaining({ workOrderId: "WO-MAO-162", lifecycleState: "EXECUTING" }),
    ]))
  })

  it("replays byte-stably and proves no runtime, provider, owner, or external dispatch effects", () => {
    const workOrders = [schedulerModelWorkOrder("WO-MAO-170")]
    const events = [schedule("schedule-170", 0), complete("complete-170", 1, "WO-MAO-170")]
    const replay = verifySchedulerModelReplay(definition(workOrders), events)

    expect(replay.deterministic).toBe(true)
    expect(replay.first).toMatchObject({
      status: "MODEL_PASS",
      runtimeActivated: false,
      dispatchPerformed: false,
      ownerCounters: {
        ownerOperationTouchCount: 0,
        ownerCredentialTouchCount: 0,
        ownerDiagnosticTouchCount: 0,
        ownerRoutineDecisionCount: 0,
        ownerRoutineContactCount: 0,
      },
    })
  })
})

describe("WO-MAO-028 bounded scheduler state exploration", () => {
  const bounds = { maxDepth: 6, maxStates: 1_000, maxTime: 10, advanceTimeStepMs: 5 }

  it("produces the same canonical state space for every work-order permutation", () => {
    const left = schedulerModelWorkOrder("WO-MAO-201")
    const right = schedulerModelWorkOrder("WO-MAO-202")
    const forward = exploreSchedulerModel(definition([left, right]), bounds)
    const reverse = exploreSchedulerModel(definition([right, left]), bounds)

    expect(forward.status).toBe("MODEL_EXPLORATION_PASS")
    expect(reverse.status).toBe("MODEL_EXPLORATION_PASS")
    expect(reverse.semanticStateHashes).toEqual(forward.semanticStateHashes)
    expect(reverse.explorationHash).toBe(forward.explorationHash)
  })

  it("honors explicit depth and state ceilings without expanding the initial state", () => {
    const model = definition([
      schedulerModelWorkOrder("WO-MAO-205"),
    ])
    const depthBound = exploreSchedulerModel(model, { maxDepth: 0, maxStates: 10, maxTime: 0, advanceTimeStepMs: 1 })
    const stateBound = exploreSchedulerModel(model, { maxDepth: 2, maxStates: 1, maxTime: 0, advanceTimeStepMs: 1 })

    expect(depthBound).toMatchObject({
      status: "MODEL_EXPLORATION_INCONCLUSIVE",
      exploredStateCount: 1,
      exploredTransitionCount: 0,
      truncated: false,
      coverageComplete: false,
      bounds: { maxDepth: 0, maxStates: 10, maxTime: 0, advanceTimeStepMs: 1 },
      liveness: { status: "BOUNDED_LIVE" },
    })
    expect(stateBound).toMatchObject({
      status: "MODEL_EXPLORATION_INCONCLUSIVE",
      exploredStateCount: 1,
      truncated: true,
      coverageComplete: false,
      bounds: { maxDepth: 2, maxStates: 1, maxTime: 0, advanceTimeStepMs: 1 },
    })
    expect(stateBound.exploredTransitionCount).toBeGreaterThan(0)
  })

  it("preserves reservation collision safety in every reachable state", () => {
    const shared = schedulerModelReservationSet("WO-MAO-210", ["shared/explorer"])
    const report = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-210", { reservationSet: shared }),
      schedulerModelWorkOrder("WO-MAO-211", {
        reservationSet: {
          ...shared,
          reservationSetId: "model-wo-mao-211",
          workerId: "worker-211",
          workOrderId: "WO-MAO-211",
        },
      }),
    ]), bounds)

    expect(report.status).toBe("MODEL_EXPLORATION_PASS")
    expect(report.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MODEL_RESERVATION_COLLISION" }),
    ]))
    for (const state of report.exploredStates) {
      expect(state.snapshot.workOrders.filter((entry) => entry.lifecycleState === "EXECUTING").length).toBeLessThanOrEqual(1)
    }
  })

  it("reaches fan-in work only from states where all dependencies are complete", () => {
    const report = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-220"),
      schedulerModelWorkOrder("WO-MAO-221"),
      schedulerModelWorkOrder("WO-MAO-222", { dependencies: ["WO-MAO-220", "WO-MAO-221"] }),
    ]), { ...bounds, maxDepth: 7, maxStates: 2_000 })
    const fanInStates = report.exploredStates.filter(({ snapshot }) =>
      snapshot.workOrders.some((entry) => entry.workOrderId === "WO-MAO-222" && entry.lifecycleState === "EXECUTING"))

    expect(report.status).toBe("MODEL_EXPLORATION_PASS")
    expect(fanInStates.length).toBeGreaterThan(0)
    for (const { snapshot } of fanInStates) {
      for (const dependency of ["WO-MAO-220", "WO-MAO-221"]) {
        expect(snapshot.workOrders.find((entry) => entry.workOrderId === dependency)?.lifecycleState).toBe("COMPLETE")
      }
    }
  })

  it("deduplicates permutation-equivalent delivery states and replays byte-stably", () => {
    const model = definition([
      schedulerModelWorkOrder("WO-MAO-230"),
      schedulerModelWorkOrder("WO-MAO-231"),
    ])
    const replay = verifySchedulerModelExplorationReplay(model, bounds)

    expect(replay.deterministic).toBe(true)
    expect(replay.first.status).toBe("MODEL_EXPLORATION_PASS")
    expect(replay.first.deduplicatedStateCount).toBeGreaterThan(0)
    expect(new Set(replay.first.semanticStateHashes).size).toBe(replay.first.exploredStateCount)
  })

  it("applies expiry exactly at its time boundary before any further schedule", () => {
    const report = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-240", { expiresAt: 5 }),
    ]), { maxDepth: 4, maxStates: 100, maxTime: 5, advanceTimeStepMs: 5 })
    const boundaryStates = report.exploredStates.filter(({ snapshot }) => snapshot.time === 5)

    expect(report.status).toBe("MODEL_EXPLORATION_PASS")
    expect(boundaryStates.some(({ snapshot }) =>
      snapshot.workOrders[0].lifecycleState === "EXPIRED" && snapshot.workOrders[0].terminalAt === 5)).toBe(true)
    expect(boundaryStates.some(({ snapshot }) => snapshot.workOrders[0].lifecycleState === "EXECUTING")).toBe(false)
  })

  it("keeps cancellation terminal under every cancel/complete race ordering", () => {
    const report = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-250"),
    ]), { maxDepth: 5, maxStates: 100, maxTime: 2, advanceTimeStepMs: 1 })
    const cancelThenComplete = report.exploredStates.some(({ trace }) => {
      const cancelledAt = trace.findIndex((transition) =>
        transition.type === "CANCEL" && transition.workOrderId === "WO-MAO-250")
      return cancelledAt >= 0 && trace.slice(cancelledAt + 1).some((transition) =>
        transition.type === "COMPLETE" && transition.workOrderId === "WO-MAO-250")
    })

    expect(report.status).toBe("MODEL_EXPLORATION_PASS")
    expect(cancelThenComplete).toBe(false)
    expect(report.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MODEL_TERMINAL_IMMUTABILITY_VIOLATION" }),
    ]))
  })

  it("finds a bounded starvation release path ahead of newly eligible priority work", () => {
    const report = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-260", { priority: 0 }),
      schedulerModelWorkOrder("WO-MAO-261", { priority: 5, availableAt: 10 }),
      schedulerModelWorkOrder("WO-MAO-262", { priority: 10 }),
    ], { maxConcurrency: 1 }), { maxDepth: 6, maxStates: 1_000, maxTime: 10, advanceTimeStepMs: 10 })

    expect(report.status).toBe("MODEL_EXPLORATION_INCONCLUSIVE")
    expect(report.starvation).toMatchObject({
      status: "BOUNDED_RELEASE_PATH_PROVEN",
      observedWorkOrderIds: ["WO-MAO-260"],
      releasedWorkOrderIds: ["WO-MAO-260"],
      unreleasedWorkOrderIds: [],
    })
  })

  it("reports typed external blocks separately from model deadlock", () => {
    const external = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-270", {
        dispatchable: false,
        externalBlock: "BLOCKED_NO_ELIGIBLE_PROVIDER",
      }),
    ]), bounds)
    const deadlocked = exploreSchedulerModel(definition([
      schedulerModelWorkOrder("WO-MAO-271", { dispatchable: false }),
    ]), bounds)

    expect(external.outcomes.deadlocks).toHaveLength(0)
    expect(external.liveness.status).toBe("EXTERNALLY_BLOCKED")
    expect(external.outcomes.externalBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ workOrderIds: ["WO-MAO-270"], reasonCodes: ["BLOCKED_NO_ELIGIBLE_PROVIDER"] }),
    ]))
    expect(deadlocked.outcomes.externalBlocks).toHaveLength(0)
    expect(deadlocked.liveness.status).toBe("DEADLOCK_REACHABLE")
    expect(deadlocked.outcomes.deadlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ workOrderIds: ["WO-MAO-271"] }),
    ]))
  })
})
