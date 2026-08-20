import { getTableName } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  const state = {
    goals: [] as Record<string, unknown>[],
    outcomes: [] as Record<string, unknown>[],
    receipts: [] as Record<string, unknown>[],
    governance: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    projects: [{ id: 7, userId: "owner", lifecycle: "active" }, { id: 8, userId: "owner", lifecycle: "active" }] as Record<string, unknown>[],
    projectResources: [] as Record<string, unknown>[],
    threads: [] as Record<string, unknown>[],
    threadSources: [] as Record<string, unknown>[],
    failAfterCommit: false,
    failRootWrite: false,
    classifierVerdict: "allow",
    mutateBeforeReplayUpdate: null as null | ((receipts: Record<string, unknown>[]) => void),
  }
  return {
    state,
    getUserId: vi.fn(async () => "owner"),
    transaction: vi.fn(),
    bootstrap: vi.fn(async () => true),
    revalidatePath: vi.fn((path: string) => {
      if (path === "/goal-console" && state.failAfterCommit) {
        state.failAfterCommit = false
        throw new Error("SIMULATED_RESPONSE_LOSS")
      }
    }),
  }
})

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (...args: unknown[]) => harness.transaction(...args),
  },
}))
vi.mock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.mock("@/app/actions/locks", () => ({ getActiveLocks: async () => [] }))
vi.mock("@/app/actions/doctrine", () => ({
  validateAction: async () => ({ verdict: "allowed", matches: [] }),
}))
vi.mock("@/lib/goal/classifier", async () => {
  const actual = await vi.importActual<typeof import("@/lib/goal/classifier")>("@/lib/goal/classifier")
  return { classifyGoal: (command: string) => command === "record structured #911 reliability remediation without host mutation"
    ? actual.classifyGoal(command)
    : ({
    lane: "BUILD",
    mode: "EXECUTE",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: harness.state.classifierVerdict,
    rationale: command,
    mistakePatterns: [],
    doctrineViolations: [],
    recommendedMove: "Queue bounded delivery",
    }) }
})
vi.mock("@/app/actions/work-orders", () => ({ createWorkOrder: vi.fn() }))
vi.mock("@/lib/goal/loop", () => ({
  runLoopVerifier: vi.fn(),
  refuseExecution: vi.fn(),
}))
vi.mock("@/lib/registers/events", () => ({
  getRecentEvents: async () => [],
  logEvent: vi.fn(),
}))
vi.mock("@/scripts/hermes-bridge/outcome-queue-source.mjs", () => ({
  ensureOutcomeQueueHardeningSchema: () => harness.bootstrap(),
}))
vi.mock("next/cache", () => ({ revalidatePath: harness.revalidatePath }))

let submitGoal: (command: string, idempotencyKey?: string) => Promise<Record<string, unknown>>
let startGoalOutcome: (input: { projectId: number; intent: string; idempotencyKey: string }) => Promise<Record<string, unknown>>
let startWorkbenchOutcome: typeof startGoalOutcome

function equalityPredicates(condition: unknown) {
  const predicates: Array<[string, unknown]> = []
  const visited = new Set<unknown>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return
    visited.add(value)
    const candidate = value as {
      constructor?: { name?: string }
      encoder?: { name?: string }
      queryChunks?: unknown[]
      value?: unknown
    }
    if (candidate.constructor?.name === "Param"
      && typeof candidate.encoder?.name === "string") {
      predicates.push([candidate.encoder.name, candidate.value])
      return
    }
    candidate.queryChunks?.forEach(visit)
  }
  visit(condition)
  return predicates
}

function matchesWhere(row: Record<string, unknown>, condition: unknown) {
  return equalityPredicates(condition).every(([column, value]) => row[column] === value)
}

function tableRows(table: unknown) {
  switch (getTableName(table as never)) {
    case "goal":
      return harness.state.goals
    case "outcome_queue_item":
      return harness.state.outcomes
    case "goal_outcome_intake_receipt":
      return harness.state.receipts
    case "project":
      return harness.state.projects
    case "project_resource":
      return harness.state.projectResources
    case "workbench_thread":
      return harness.state.threads
    case "workbench_thread_source":
      return harness.state.threadSources
    default:
      return []
  }
}

function transactionAdapter() {
  return {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn((projection?: Record<string, unknown>) => {
      let table: unknown
      let condition: unknown
      const read = () => {
        const rows = tableRows(table).filter((row) => matchesWhere(row, condition))
        if (!projection) return rows.map((row) => ({ ...row }))
        return rows.map((row) => Object.fromEntries(
          Object.keys(projection).map((key) => [key, row[key]]),
        ))
      }
      const chain = {
        from(value: unknown) {
          table = value
          return chain
        },
        where(value: unknown) {
          condition = value
          return chain
        },
        limit(count: number) {
          return Promise.resolve(read().slice(0, count))
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(read()).then(resolve, reject)
        },
      }
      return chain
    }),
    insert: vi.fn((table: unknown) => {
      let value: Record<string, unknown>
      const commit = () => {
        const tableName = getTableName(table as never)
        if (tableName === "goal") {
          const row = {
            id: harness.state.goals.length + 1,
            createdAt: new Date("2026-07-28T12:00:00.000Z"),
            updatedAt: new Date("2026-07-28T12:00:00.000Z"),
            linkedWorkOrderId: null,
            ...value,
          }
          harness.state.goals.push(row)
          return row
        }
        if (tableName === "outcome_queue_item") {
          const row = { id: harness.state.outcomes.length + 1, ...value }
          harness.state.outcomes.push(row)
          return row
        }
        if (tableName === "goal_outcome_intake_receipt") {
          const row = { id: harness.state.receipts.length + 1, ...value }
          harness.state.receipts.push(row)
          return row
        }
        if (tableName === "governance_event") {
          const row = { id: harness.state.governance.length + 1, ...value }
          harness.state.governance.push(row)
          return row
        }
        if (tableName === "event_log") {
          const row = { id: harness.state.events.length + 1, ...value }
          harness.state.events.push(row)
          return row
        }
        if (tableName === "workbench_thread") {
          const row = { ...value }
          harness.state.threads.push(row)
          return row
        }
        if (tableName === "workbench_thread_source") {
          const row = { id: harness.state.threadSources.length + 1, ...value }
          harness.state.threadSources.push(row)
          return row
        }
        throw new Error(`unexpected insert: ${tableName}`)
      }
      let committed: Record<string, unknown> | null = null
      const chain = {
        values(next: Record<string, unknown>) {
          value = next
          return chain
        },
        returning(projection?: Record<string, unknown>) {
          if (getTableName(table as never) === "workbench_thread_source" && harness.state.failRootWrite) {
            return Promise.resolve([])
          }
          committed ??= commit()
          if (!projection) return Promise.resolve([committed])
          return Promise.resolve([Object.fromEntries(
            Object.keys(projection).map((key) => [key, committed?.[key]]),
          )])
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          committed ??= commit()
          return Promise.resolve(undefined).then(resolve, reject)
        },
      }
      return chain
    }),
    update: vi.fn(() => {
      let update: Record<string, unknown>
      let condition: unknown
      const chain = {
        set(value: Record<string, unknown>) {
          update = value
          return chain
        },
        where(value: unknown) {
          condition = value
          return chain
        },
        returning() {
          harness.state.mutateBeforeReplayUpdate?.(harness.state.receipts)
          harness.state.mutateBeforeReplayUpdate = null
          const receipt = harness.state.receipts.find(
            (candidate) => matchesWhere(candidate, condition),
          )
          if (!receipt) return Promise.resolve([])
          receipt.replayCount = Number(receipt.replayCount) + 1
          receipt.lastReplayedAt = update.lastReplayedAt
          return Promise.resolve([{ id: receipt.id }])
        },
      }
      return chain
    }),
  }
}

beforeEach(async () => {
  harness.state.goals.length = 0
  harness.state.outcomes.length = 0
  harness.state.receipts.length = 0
  harness.state.governance.length = 0
  harness.state.events.length = 0
  harness.state.projects.splice(0, harness.state.projects.length,
    { id: 7, userId: "owner", lifecycle: "active" },
    { id: 8, userId: "owner", lifecycle: "active" },
  )
  harness.state.projectResources.splice(0, harness.state.projectResources.length,
    { id: 1, userId: "owner", projectId: 7, type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" },
    { id: 2, userId: "owner", projectId: 8, type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" },
  )
  harness.state.threads.length = 0
  harness.state.threadSources.length = 0
  harness.state.failAfterCommit = false
  harness.state.failRootWrite = false
  harness.state.classifierVerdict = "allow"
  harness.state.mutateBeforeReplayUpdate = null
  harness.revalidatePath.mockClear()
  harness.bootstrap.mockReset()
  harness.bootstrap.mockResolvedValue(true)
  harness.transaction.mockClear()
  harness.getUserId.mockClear()
  let prior = Promise.resolve()
  harness.transaction.mockImplementation((callback: (transaction: unknown) => Promise<unknown>) => {
    const current = prior.then(async () => {
      const collections = [
        harness.state.goals,
        harness.state.outcomes,
        harness.state.receipts,
        harness.state.governance,
        harness.state.events,
        harness.state.threads,
        harness.state.threadSources,
      ]
      const snapshots = collections.map((rows) => rows.map((row) => ({ ...row })))
      try {
        return await callback(transactionAdapter())
      } catch (error) {
        collections.forEach((rows, index) => rows.splice(0, rows.length, ...snapshots[index]))
        throw error
      }
    })
    prior = current.then(() => undefined, () => undefined)
    return current
  })
  vi.resetModules()
  ;({ submitGoal, startGoalOutcome } = await import("@/app/actions/goals"))
  ;({ startWorkbenchOutcome } = await import("@/app/actions/start-workbench-outcome"))
})

describe("authenticated goal outcome intake idempotency", () => {
  it("returns the original goal after a post-commit response loss", async () => {
    harness.state.failAfterCommit = true
    await expect(submitGoal(
      "Deliver retry-safe intake",
      "goal-intake:response-loss-0001",
    )).rejects.toThrow("SIMULATED_RESPONSE_LOSS")

    const replayed = await submitGoal(
      "Deliver retry-safe intake",
      "goal-intake:response-loss-0001",
    )

    expect(replayed.id).toBe(1)
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.receipts[0]).toMatchObject({ goalId: 1, replayCount: 1 })
    expect(harness.state.governance).toHaveLength(1)
    expect(harness.state.events).toHaveLength(1)
  })

  it("fences concurrent same-key acquisition to one goal and queue item", async () => {
    const [first, replay] = await Promise.all([
      submitGoal("Deliver once", "goal-intake:concurrent-0001"),
      submitGoal("Deliver once", "goal-intake:concurrent-0001"),
    ])

    expect(first.id).toBe(replay.id)
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.receipts[0].replayCount).toBe(1)
  })

  it("rejects reuse of a stable key for different intent", async () => {
    await submitGoal("First intent", "goal-intake:conflict-0001")
    await expect(submitGoal(
      "Different intent",
      "goal-intake:conflict-0001",
    )).rejects.toThrow("GOAL_INTAKE_IDEMPOTENCY_CONFLICT")

    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
  })

  it("shares one process bootstrap across concurrent submissions", async () => {
    await Promise.all([
      submitGoal("First bounded outcome", "goal-intake:bootstrap-0001"),
      submitGoal("Second bounded outcome", "goal-intake:bootstrap-0002"),
    ])

    expect(harness.bootstrap).toHaveBeenCalledOnce()
    expect(harness.state.goals).toHaveLength(2)
    expect(harness.state.outcomes).toHaveLength(2)
  })

  it("resets the cached bootstrap after failure", async () => {
    harness.bootstrap
      .mockRejectedValueOnce(new Error("BOOTSTRAP_FAILED"))
      .mockResolvedValueOnce(true)

    await expect(submitGoal(
      "Retry bootstrap",
      "goal-intake:bootstrap-retry-0001",
    )).rejects.toThrow("BOOTSTRAP_FAILED")
    await expect(submitGoal(
      "Retry bootstrap",
      "goal-intake:bootstrap-retry-0001",
    )).resolves.toMatchObject({ id: 1 })

    expect(harness.bootstrap).toHaveBeenCalledTimes(2)
  })

  it("keeps distinct stable keys for the same command and updates only the replay target", async () => {
    const first = await submitGoal("Same requested outcome", "goal-intake:distinct-0001")
    const second = await submitGoal("Same requested outcome", "goal-intake:distinct-0002")
    const replay = await submitGoal("Same requested outcome", "goal-intake:distinct-0002")

    expect(first.id).not.toBe(second.id)
    expect(replay.id).toBe(second.id)
    expect(harness.state.goals).toHaveLength(2)
    expect(harness.state.outcomes).toHaveLength(2)
    expect(harness.state.receipts).toHaveLength(2)
    expect(harness.state.receipts.map((receipt) => receipt.replayCount)).toEqual([0, 1])
  })

  it("reaches the replay-write wall when the exact receipt changes before update", async () => {
    await submitGoal("Replay race", "goal-intake:replay-wall-0001")
    harness.state.mutateBeforeReplayUpdate = (receipts) => {
      receipts[0].resultDigest = "concurrent-result-digest"
    }

    await expect(submitGoal(
      "Replay race",
      "goal-intake:replay-wall-0001",
    )).rejects.toThrow("GOAL_INTAKE_REPLAY_WRITE_WALL")
    expect(harness.state.receipts[0].replayCount).toBe(0)
  })

  it("never queues a refused goal and replays its refusal receipt exactly once", async () => {
    harness.state.classifierVerdict = "refuse"

    const first = await submitGoal(
      "Cross a forbidden boundary",
      "goal-intake:refused-0001",
    )
    const replay = await submitGoal(
      "Cross a forbidden boundary",
      "goal-intake:refused-0001",
    )

    expect(first.id).toBe(replay.id)
    expect(first.verdict).toBe("refuse")
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.receipts[0]).toMatchObject({
      goalId: 1,
      outcomeKey: "refused:goal:1",
      replayCount: 1,
    })
    expect(harness.state.governance).toHaveLength(1)
    expect(harness.state.events).toHaveLength(1)
  })

  it("fails closed when a refused goal receipt is rebound to an executable outcome key", async () => {
    harness.state.classifierVerdict = "refuse"
    await submitGoal(
      "Cross a forbidden boundary",
      "goal-intake:refused-binding-0001",
    )
    harness.state.receipts[0].outcomeKey = "goal:GOAL-9999"

    await expect(submitGoal(
      "Cross a forbidden boundary",
      "goal-intake:refused-binding-0001",
    )).rejects.toThrow("GOAL_INTAKE_BINDING_WALL")

    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts[0].replayCount).toBe(0)
  })

  it("atomically accepts one outcome into an exact tenant Project Thread without authority", async () => {
    const result = await startGoalOutcome({
      projectId: 7,
      intent: "Deliver an operator-visible outcome",
      idempotencyKey: "workbench-outcome:accepted-0001",
    })

    expect(result).toMatchObject({
      status: "ACCEPTED",
      projectId: 7,
      goalId: 1,
      outcomeKey: "goal:GOAL-0001",
      root: { sourceType: "outcome", sourceId: "goal:GOAL-0001" },
      intakeTruth: "persisted",
      ownershipTruth: "project_thread_bound",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
    expect(harness.transaction).toHaveBeenCalledOnce()
    expect(harness.getUserId).toHaveBeenCalledOnce()
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.outcomes[0]).toMatchObject({
      approvalState: "unapproved",
      authorityState: "unverified",
      lifecycleState: "suggested",
    })
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.threads).toEqual([
      expect.objectContaining({ id: result.threadId, userId: "owner", projectId: 7 }),
    ])
    expect(harness.state.threadSources).toEqual([{
      id: 1,
      userId: "owner",
      threadId: result.threadId,
      sourceType: "outcome",
      sourceId: "goal:GOAL-0001",
      role: "root",
      createdAt: expect.any(Date),
    }])
    expect(harness.state.governance).toHaveLength(1)
    expect(harness.state.events).toHaveLength(1)
    expect(JSON.stringify({ result, outcome: harness.state.outcomes[0] })).not.toMatch(/workOrder|lease|acquisition|dispatch/i)
  })

  it("persists the exact registered #911 outcome classification and sole outcome root without minting authority", async () => {
    const intent = "record structured #911 reliability remediation without host mutation"
    const result = await startWorkbenchOutcome({
      projectId: 7,
      intent,
      idempotencyKey: "workbench-outcome:issue-911-0001",
    })

    expect(result).toMatchObject({
      status: "ACCEPTED",
      projectId: 7,
      outcomeKey: "goal:GOAL-0001",
      root: { sourceType: "outcome", sourceId: "goal:GOAL-0001" },
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
    expect(harness.state.goals).toEqual([
      expect.objectContaining({ command: intent, lane: "operator-objective", mode: "implement", risk: "R1", authority: "A2_WRITE_OWN", verdict: "requires_approval" }),
    ])
    expect(harness.state.outcomes).toEqual([
      expect.objectContaining({ title: intent, objective: intent, riskClass: "R1", approvalState: "unapproved", authorityState: "unverified", lifecycleState: "suggested" }),
    ])
    expect(harness.state.threadSources).toEqual([
      expect.objectContaining({ threadId: result.threadId, sourceType: "outcome", sourceId: "goal:GOAL-0001", role: "root" }),
    ])
    expect(JSON.stringify({ result, goal: harness.state.goals[0], outcome: harness.state.outcomes[0] }))
      .not.toMatch(/authorityGrantRef":"(?!null)|approvalDecisionId":[0-9]|dispatch/i)
  })

  it.each(["standby", "archived"])("rejects the exact #911 outcome before effects when the Project is %s", async (lifecycle) => {
    harness.state.projects[0].lifecycle = lifecycle

    await expect(startWorkbenchOutcome({
      projectId: 7,
      intent: "record structured #911 reliability remediation without host mutation",
      idempotencyKey: `workbench-outcome:issue-911-${lifecycle}`,
    })).resolves.toMatchObject({ status: "PROJECT_NOT_FOUND", projectId: 7 })

    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
  })

  it("rejects the exact #911 outcome before effects when the primary repository is wrong", async () => {
    harness.state.projectResources[0].canonicalIdentity = "bsvalues/not-terragroq"

    await expect(startWorkbenchOutcome({
      projectId: 7,
      intent: "record structured #911 reliability remediation without host mutation",
      idempotencyKey: "workbench-outcome:issue-911-wrong-repo",
    })).resolves.toMatchObject({ status: "PROJECT_NOT_FOUND", projectId: 7 })

    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
  })

  it("rejects the exact #911 outcome before effects when primary repository custody is duplicated", async () => {
    harness.state.projectResources.push({
      id: 3, userId: "owner", projectId: 7, type: "repo",
      canonicalIdentity: "bsvalues/secondary", relationship: "primary-repo",
    })

    await expect(startWorkbenchOutcome({
      projectId: 7,
      intent: "record structured #911 reliability remediation without host mutation",
      idempotencyKey: "workbench-outcome:issue-911-duplicate-repo",
    })).resolves.toMatchObject({ status: "PROJECT_NOT_FOUND", projectId: 7 })

    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
  })

  it("replays the exact accepted graph after response loss", async () => {
    harness.state.failAfterCommit = true
    const input = {
      projectId: 7,
      intent: "Build accepted Thread recovery",
      idempotencyKey: "workbench-outcome:response-loss-0001",
    }
    await expect(startGoalOutcome(input)).rejects.toThrow("SIMULATED_RESPONSE_LOSS")
    const threadId = String(harness.state.threads[0].id)

    const replay = await startGoalOutcome(input)

    expect(replay).toMatchObject({ status: "ALREADY_ACCEPTED", threadId })
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.receipts).toHaveLength(1)
    expect(harness.state.threads).toHaveLength(1)
    expect(harness.state.threadSources).toHaveLength(1)
    expect(harness.state.governance).toHaveLength(1)
    expect(harness.state.events).toHaveLength(1)
  })

  it("serializes concurrent same-key starts to one accepted graph", async () => {
    const input = {
      projectId: 7,
      intent: "Build exactly once",
      idempotencyKey: "workbench-outcome:concurrent-0001",
    }
    const [first, replay] = await Promise.all([startGoalOutcome(input), startGoalOutcome(input)])

    expect(first.threadId).toBe(replay.threadId)
    expect([first.status, replay.status].sort()).toEqual(["ACCEPTED", "ALREADY_ACCEPTED"])
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.threads).toHaveLength(1)
    expect(harness.state.threadSources).toHaveLength(1)
  })

  it("rejects same-key Project or intent conflicts without another graph", async () => {
    const key = "workbench-outcome:conflict-0001"
    await startGoalOutcome({ projectId: 7, intent: "Build original outcome", idempotencyKey: key })
    harness.revalidatePath.mockClear()

    await expect(startGoalOutcome({ projectId: 8, intent: "Build original outcome", idempotencyKey: key }))
      .resolves.toMatchObject({ status: "CONFLICT", reason: "IDEMPOTENCY_CONFLICT" })
    await expect(startGoalOutcome({ projectId: 99, intent: "Build original outcome", idempotencyKey: key }))
      .resolves.toMatchObject({ status: "CONFLICT", reason: "IDEMPOTENCY_CONFLICT" })
    await expect(startGoalOutcome({ projectId: 7, intent: "Build changed outcome", idempotencyKey: key }))
      .resolves.toMatchObject({ status: "CONFLICT", reason: "IDEMPOTENCY_CONFLICT" })

    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(1)
    expect(harness.state.threads).toHaveLength(1)
    expect(harness.state.threadSources).toHaveLength(1)
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it("fails a missing tenant Project before any intake effect", async () => {
    await expect(startGoalOutcome({
      projectId: 99,
      intent: "Deliver without an orphan",
      idempotencyKey: "workbench-outcome:missing-project-0001",
    })).resolves.toMatchObject({ status: "PROJECT_NOT_FOUND", projectId: 99 })

    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it("rolls back every intake effect when the canonical root cannot be written", async () => {
    harness.state.failRootWrite = true

    await expect(startGoalOutcome({
      projectId: 7,
      intent: "Build all or nothing",
      idempotencyKey: "workbench-outcome:root-write-wall-0001",
    })).rejects.toThrow("WORKBENCH_OUTCOME_START_ROOT_WRITE_WALL")

    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
    expect(harness.state.governance).toHaveLength(0)
    expect(harness.state.events).toHaveLength(0)
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it("records a typed refusal without an outcome, Thread, root, authority, or acceptance", async () => {
    harness.state.classifierVerdict = "refuse"
    const input = {
      projectId: 7,
      intent: "Build across a forbidden boundary",
      idempotencyKey: "workbench-outcome:refused-0001",
    }
    const first = await startGoalOutcome(input)
    const replay = await startGoalOutcome(input)

    expect(first).toMatchObject({
      status: "REFUSED",
      threadId: null,
      outcomeKey: null,
      root: null,
      ownershipTruth: "unavailable",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
    expect(replay).toMatchObject({ status: "REFUSED" })
    expect(harness.state.goals).toHaveLength(1)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
  })

  it("fails closed when replay cannot recover the exact canonical outcome root", async () => {
    const input = {
      projectId: 7,
      intent: "Build root protection",
      idempotencyKey: "workbench-outcome:root-wall-0001",
    }
    await startGoalOutcome(input)
    harness.state.threadSources[0].sourceId = "forged-outcome"

    await expect(startGoalOutcome(input)).rejects.toThrow("WORKBENCH_OUTCOME_START_BINDING_WALL")
    expect(harness.state.receipts[0].replayCount).toBe(0)
  })

  it("rejects every non-outcome route before a transaction or durable effect", async () => {
    for (const [index, intent] of [
      "Explain recent activity",
      "Research access grants",
      "Open Projects",
      "Deploy the cockpit",
      "Research and deploy the cockpit",
    ].entries()) {
      harness.transaction.mockClear()
      harness.getUserId.mockClear()
      const result = await startWorkbenchOutcome({
        projectId: 7,
        intent,
        idempotencyKey: `workbench-outcome:invalid-route-000${index}`,
      })
      expect(result).toMatchObject({ status: "INVALID_INTENT", executionAuthorizedByIntake: false })
      expect(harness.getUserId).toHaveBeenCalledOnce()
      expect(harness.transaction).not.toHaveBeenCalled()
    }
    expect(harness.state.goals).toHaveLength(0)
    expect(harness.state.outcomes).toHaveLength(0)
    expect(harness.state.receipts).toHaveLength(0)
    expect(harness.state.threads).toHaveLength(0)
    expect(harness.state.threadSources).toHaveLength(0)
    expect(harness.state.governance).toHaveLength(0)
    expect(harness.state.events).toHaveLength(0)
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it("replays immutable intake effects without fabricating current lifecycle truth", async () => {
    const input = {
      projectId: 7,
      intent: "Deliver progression-safe truth",
      idempotencyKey: "workbench-outcome:progression-0001",
    }
    await startGoalOutcome(input)
    Object.assign(harness.state.outcomes[0], {
      approvalState: "approved",
      authorityState: "matched",
      lifecycleState: "active",
    })

    const replay = await startGoalOutcome(input)

    expect(replay).toMatchObject({
      status: "ALREADY_ACCEPTED",
      approvalGrantedByIntake: false,
      authorityGrantedByIntake: false,
      executionAuthorizedByIntake: false,
    })
    expect(replay).not.toHaveProperty("approvalState")
    expect(replay).not.toHaveProperty("authorityState")
    expect(replay).not.toHaveProperty("executionAuthorized")
  })
})
