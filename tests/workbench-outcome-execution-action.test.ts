import { getTableName } from "drizzle-orm"
import { inspect } from "node:util"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildWorkbenchExecutionAuthorizationRequestHash,
  deterministicWorkbenchExecutionRefs,
} from "@/lib/workbench/outcome-execution-authorization"
import { resolveHermesWorkContract } from "@/scripts/hermes-bridge/work-contract.mjs"

const harness = vi.hoisted(() => ({
  getUserId: vi.fn(async () => "owner"),
  revalidatePath: vi.fn(),
  transaction: vi.fn(),
  effects: [] as Array<{ table: string; value: Record<string, unknown> }>,
  executedSql: [] as string[],
  whereByTable: {} as Record<string, string[]>,
}))

vi.mock("@/lib/session", () => ({ getUserId: harness.getUserId }))
vi.mock("next/cache", () => ({ revalidatePath: harness.revalidatePath }))
vi.mock("@/lib/db", () => ({ db: { transaction: harness.transaction } }))

const input = {
  projectId: 7,
  threadId: "thread-7",
  outcomeKey: "goal:GOAL-0007",
  idempotencyKey: "workbench-execution:stable-0007",
  confirmation: "START_WORK" as const,
}

const issue911Intent = "record structured #911 reliability remediation without host mutation"

function issue911ReplayOverrides(override: Record<string, unknown[][]> = {}) {
  const requestHash = buildWorkbenchExecutionAuthorizationRequestHash(input)
  const refs = deterministicWorkbenchExecutionRefs(requestHash)
  const authorizedAt = "2026-08-20T18:00:00.000Z"
  const expiresAt = "2099-08-23T18:00:00.000Z"
  const workContract = resolveHermesWorkContract({
    command: issue911Intent, title: issue911Intent, objective: issue911Intent,
    lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
  })!
  const resultBinding = {
    decisionId: 31, decisionRef: refs.decisionRef,
    grantId: 41, grantRef: refs.grantRef,
    implementationGrantId: 42, implementationGrantRef: refs.implementationGrantRef,
    queueVersion: 1, authorizedAt, expiresAt, workContract,
  }
  return {
    outcome_queue_mutation_receipt: [[{
      operation: "workbench_execution.authorize", requestHash,
      requestBinding: input, resultBinding,
    }]],
    outcome_queue_item: [[{
      outcomeKey: input.outcomeKey, goalId: 7, title: issue911Intent, objective: issue911Intent, riskClass: "R1",
      approvalState: "approved", approvalDecisionId: 31, authorityState: "matched",
      authorityLevel: "A2_WRITE_OWN", authorityGrantRef: refs.grantRef,
      authoritySubject: "operator", authorityAction: "outcome:execute", lifecycleState: "approved",
      activeWorkOrderId: null, executionBinding: null, leaseHolder: null, leaseToken: null,
      leaseExpiresAt: null, acquisitionKey: null, terminalKey: null, version: 1,
    }]],
    goal: [[{
      id: 7, userId: "owner", command: issue911Intent, lane: "operator-objective", risk: "R1",
      authority: "A2_WRITE_OWN", verdict: "requires_approval", requiresApproval: true,
      status: "classified", linkedWorkOrderId: null,
    }]],
    decision: [[{
      id: 31, ref: refs.decisionRef, status: "accepted", authority: "binding",
      scope: input.outcomeKey, decision: "APPROVE",
      evidence: [
        `work-contract:${workContract.id}`,
        `work-contract-digest:${workContract.digest}`,
        `work-contract-json:${JSON.stringify(workContract)}`,
      ],
    }]],
    authority_grant: [
      [{
        id: 41, userId: "owner", ref: refs.grantRef, scope: input.outcomeKey,
        authorityLevel: "A2_WRITE_OWN", grantedTo: "operator", allowedActions: ["outcome:execute"],
        blockedActions: ["production:mutate", "release:create", "secret:access", "spend:increase"],
        workOrderId: null, status: "active", revokedAt: null, expiresAt: new Date(expiresAt),
      }],
      [{
        id: 42, userId: "owner", ref: refs.implementationGrantRef, scope: "WO-HERMES-OUTCOME-7",
        authorityLevel: "A2_WRITE_OWN", grantedTo: "operator", allowedActions: ["implement"],
        blockedActions: ["production:mutate", "release:create", "secret:access", "spend:increase"],
        workOrderId: null, status: "active", revokedAt: null, expiresAt: new Date(expiresAt),
      }],
    ],
    ...override,
  }
}

function txAdapter(overrides: Record<string, unknown[][]> = {}) {
  const rows: Record<string, unknown[][]> = {
    outcome_queue_mutation_receipt: [[]],
    project: [[{ id: 7, userId: "owner", lifecycle: "active" }]],
    workbench_thread: [[{ id: "thread-7", userId: "owner", projectId: 7 }]],
    workbench_thread_source: [[{ threadId: "thread-7", sourceType: "outcome", sourceId: "goal:GOAL-0007", role: "root" }]],
    project_resource: [[{ type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" }]],
    outcome_queue_item: [[{
      outcomeKey: "goal:GOAL-0007", goalId: 7, title: "Add a compact on-screen latest-evidence timestamp to selected Thread work status",
      objective: "Add a compact on-screen latest-evidence timestamp to selected Thread work status", riskClass: "R1",
      approvalState: "unapproved", approvalDecisionId: null,
      authorityState: "unverified", authorityLevel: "A2_WRITE_OWN", authorityGrantRef: null,
      authoritySubject: "operator", authorityAction: "outcome:execute", lifecycleState: "suggested",
      activeWorkOrderId: null, executionBinding: null, leaseHolder: null, leaseToken: null,
      leaseExpiresAt: null, acquisitionKey: null, terminalKey: null, version: 0,
    }]],
    goal: [[{
      id: 7, userId: "owner", command: "Add a compact on-screen latest-evidence timestamp to selected Thread work status", lane: "ui", risk: "low",
      authority: "A2_WRITE_OWN", verdict: "requires_approval", requiresApproval: true,
      status: "classified", linkedWorkOrderId: null,
    }]],
    ...overrides,
  }
  return {
    execute: vi.fn(async (statement: unknown) => {
      harness.executedSql.push(JSON.stringify(statement))
      return { rows: [{ now: new Date() }] }
    }),
    select: vi.fn(() => ({
      from(table: never) {
        const tableName = getTableName(table)
        const result = rows[tableName]?.shift() ?? []
        const chain = {
          where: (condition: unknown) => {
            ;(harness.whereByTable[tableName] ??= []).push(inspect(condition, { depth: 8 }))
            return chain
          },
          orderBy: () => chain,
          limit: async () => result,
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        }
        return chain
      },
    })),
    insert: vi.fn((table: never) => {
      const tableName = getTableName(table)
      let value: Record<string, unknown>
      const chain = {
        values(next: Record<string, unknown>) { value = next; return chain },
        returning() {
          harness.effects.push({ table: tableName, value })
          if (tableName === "decision") return Promise.resolve([{ id: 31, ref: value.ref }])
          if (tableName === "authority_grant") {
            const grantCount = harness.effects.filter((effect) => effect.table === "authority_grant").length
            return Promise.resolve([{ id: 40 + grantCount, ref: value.ref }])
          }
          return Promise.resolve([{ id: harness.effects.length }])
        },
        then(resolve: (v: unknown) => unknown) {
          harness.effects.push({ table: tableName, value })
          return Promise.resolve(undefined).then(resolve)
        },
      }
      return chain
    }),
    update: vi.fn((table: never) => {
      const tableName = getTableName(table)
      let value: Record<string, unknown>
      const chain = {
        set(next: Record<string, unknown>) { value = next; return chain },
        where() { return chain },
        returning() { harness.effects.push({ table: tableName, value }); return Promise.resolve([{ version: 1 }]) },
      }
      return chain
    }),
  }
}

beforeEach(() => {
  harness.effects.length = 0
  harness.executedSql.length = 0
  harness.whereByTable = {}
  harness.getUserId.mockClear()
  harness.revalidatePath.mockClear()
  harness.transaction.mockReset()
  harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txAdapter()))
})

describe("authorizeWorkbenchOutcomeExecution action", () => {
  it("authenticates internally and atomically persists approval, one exact finite grant, queue transition, receipt and audit", async () => {
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    const result = await authorizeWorkbenchOutcomeExecution(input)

    expect(result).toMatchObject({
      status: "AUTHORIZED_FOR_ACQUISITION", reason: null, projectId: 7, threadId: "thread-7",
      outcomeKey: "goal:GOAL-0007", queueVersion: 1,
      authorization: { authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007", allowedAction: "outcome:execute" },
      executionObserved: false, workOrderObserved: false, leaseObserved: false, dispatchPerformed: false,
    })
    expect(harness.getUserId).toHaveBeenCalledOnce()
    expect(harness.transaction).toHaveBeenCalledOnce()
    expect(harness.executedSql.join(" ")).toContain("clock_timestamp")
    expect(harness.effects.filter((effect) => effect.table === "decision")).toHaveLength(1)
    expect(harness.effects.filter((effect) => effect.table === "authority_grant")).toEqual([
      expect.objectContaining({ value: expect.objectContaining({
        workOrderId: null, authorityLevel: "A2_WRITE_OWN", scope: "goal:GOAL-0007",
        allowedActions: ["outcome:execute"], status: "active", expiresAt: expect.any(Date),
      }) }),
    ])
    expect(harness.effects.filter((effect) => effect.table === "outcome_queue_item")).toEqual([
      expect.objectContaining({ value: expect.objectContaining({
        approvalState: "approved", authorityState: "matched", lifecycleState: "approved", version: 1,
      }) }),
    ])
    expect(harness.effects.some((effect) => effect.table === "work_order")).toBe(false)
    expect(harness.effects.some((effect) => effect.table === "outcome_queue_mutation_receipt")).toBe(true)
    expect(harness.effects.some((effect) => effect.table === "governance_event")).toBe(true)
    expect(harness.effects.some((effect) => effect.table === "event_log")).toBe(true)
  })

  it("atomically persists the full #911 contract and a bounded implementation grant without dispatch", async () => {
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txAdapter({
      outcome_queue_item: [[{
        outcomeKey: input.outcomeKey, goalId: 7, title: issue911Intent, objective: issue911Intent, riskClass: "R1",
        approvalState: "unapproved", approvalDecisionId: null,
        authorityState: "unverified", authorityLevel: "A2_WRITE_OWN", authorityGrantRef: null,
        authoritySubject: "operator", authorityAction: "outcome:execute", lifecycleState: "suggested",
        activeWorkOrderId: null, executionBinding: null, leaseHolder: null, leaseToken: null,
        leaseExpiresAt: null, acquisitionKey: null, terminalKey: null, version: 0,
      }]],
      goal: [[{
        id: 7, userId: "owner", command: issue911Intent, lane: "operator-objective", risk: "R1",
        authority: "A2_WRITE_OWN", verdict: "requires_approval", requiresApproval: true,
        status: "classified", linkedWorkOrderId: null,
      }]],
    })))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
      status: "AUTHORIZED_FOR_ACQUISITION", dispatchPerformed: false,
    })
    const grants = harness.effects.filter((effect) => effect.table === "authority_grant")
    expect(grants).toHaveLength(2)
    expect(grants[1]).toMatchObject({ value: {
      workOrderId: null,
      authorityLevel: "A2_WRITE_OWN",
      scope: "WO-HERMES-OUTCOME-7",
      allowedActions: ["implement"],
      blockedActions: ["production:mutate", "release:create", "secret:access", "spend:increase"],
      status: "active",
      expiresAt: expect.any(Date),
    } })
    const approval = harness.effects.find((effect) => effect.table === "decision")?.value
    expect(approval).toMatchObject({ locked: true })
    expect(approval?.evidence).toContainEqual(expect.stringMatching(/^work-contract-json:\{/))
    const receipt = harness.effects.find((effect) => effect.table === "outcome_queue_mutation_receipt")?.value
    expect(receipt?.resultBinding).toMatchObject({
      implementationGrantId: expect.any(Number),
      implementationGrantRef: expect.stringMatching(/^WB-EXEC-IMPL-GRANT-/),
      workContract: {
        id: "issue-911-runtime-reliability-evidence.v1",
        reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
        projection: { issueNumber: 911, completionOwned: false },
        delivery: { allowedActions: ["implement"], commitAllowed: true, tagAllowed: false, pushAllowed: true },
      },
    })
    expect(harness.effects.some((effect) => effect.table === "work_order")).toBe(false)
  })

  it("replays the exact #911 contract and dual-grant graph without creating effects", async () => {
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => (
      callback(txAdapter(issue911ReplayOverrides()))
    ))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
      status: "ALREADY_AUTHORIZED", queueVersion: 1,
      executionObserved: false, workOrderObserved: false, leaseObserved: false,
      dispatchPerformed: false,
    })
    expect(harness.effects).toEqual([])
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["tenant", { project: [[{ id: 7, userId: "foreign", lifecycle: "active" }]] }],
    ["thread", { workbench_thread: [[{ id: "thread-other", userId: "owner", projectId: 7 }]] }],
    ["repository", { project_resource: [[{ type: "repo", canonicalIdentity: "bsvalues/other", relationship: "primary-repo" }]] }],
  ] as Array<[string, Record<string, unknown[][]>]>)
  ("fails closed when an exact #911 replay has a %s mismatch", async (_label, mismatch) => {
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => (
      callback(txAdapter(issue911ReplayOverrides(mismatch)))
    ))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
      status: "INELIGIBLE", reason: "PERSISTED_BINDING_INVALID",
      executionObserved: false, dispatchPerformed: false,
    })
    expect(harness.effects).toEqual([])
  })

  it("requires explicit confirmation before authentication or a transaction", async () => {
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")
    await expect(authorizeWorkbenchOutcomeExecution({ ...input, confirmation: "yes" as never }))
      .rejects.toThrow("WORKBENCH_EXECUTION_CONFIRMATION_REQUIRED")
    expect(harness.getUserId).not.toHaveBeenCalled()
    expect(harness.transaction).not.toHaveBeenCalled()
    expect(harness.effects).toEqual([])
  })

  it("returns a typed conflict for same-key different intent with zero effects", async () => {
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txAdapter({
      outcome_queue_mutation_receipt: [[{
        operation: "workbench_execution.authorize", requestHash: "different-request",
        requestBinding: input, resultBinding: {},
      }]],
    })))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
      status: "CONFLICT", reason: "IDEMPOTENCY_CONFLICT", authorization: null,
      executionObserved: false, dispatchPerformed: false,
    })
    expect(harness.effects).toEqual([])
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses duplicate tenant-wide outcome roots before minting any authorization effect", async () => {
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txAdapter({
      workbench_thread_source: [[
        { threadId: "thread-7", sourceType: "outcome", sourceId: input.outcomeKey, role: "root" },
        { threadId: "thread-corrupt", sourceType: "outcome", sourceId: input.outcomeKey, role: "root" },
      ]],
    })))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
      status: "UNAVAILABLE", reason: "PROJECT_THREAD_OUTCOME_UNAVAILABLE",
      authorization: null, executionObserved: false, dispatchPerformed: false,
    })
    expect(harness.effects).toEqual([])
    expect(harness.revalidatePath).not.toHaveBeenCalled()
    expect(harness.whereByTable.workbench_thread_source?.[0]).toContain(`value: '${input.outcomeKey}'`)
    expect(harness.whereByTable.workbench_thread_source?.[0]).not.toContain(`value: '${input.threadId}'`)
  })

  it("recovers immutable authorization after acquisition, renewal, and completion without fabricating current execution", async () => {
    const authorizedAt = "2026-08-14T18:00:00.000Z"
    const expiresAt = "2099-08-17T18:00:00.000Z"
    const requestHash = buildWorkbenchExecutionAuthorizationRequestHash(input)
    const workContract = resolveHermesWorkContract({
      command: "Add a compact on-screen latest-evidence timestamp to selected Thread work status",
      title: "Add a compact on-screen latest-evidence timestamp to selected Thread work status",
      objective: "Add a compact on-screen latest-evidence timestamp to selected Thread work status",
      lane: "ui", risk: "low", authority: "A2_WRITE_OWN",
    })!
    const resultBinding = {
      decisionId: 31, decisionRef: "WB-EXEC-DEC-EXACT", grantId: 41,
      grantRef: "WB-EXEC-GRANT-EXACT", queueVersion: 1, authorizedAt, expiresAt, workContract,
    }
    let lifecycleState = "active"
    harness.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txAdapter({
      outcome_queue_mutation_receipt: [[{
        operation: "workbench_execution.authorize", requestHash,
        requestBinding: input, resultBinding,
      }]],
      outcome_queue_item: [[{
        outcomeKey: input.outcomeKey, goalId: 7, title: "Add a compact on-screen latest-evidence timestamp to selected Thread work status",
        objective: "Add a compact on-screen latest-evidence timestamp to selected Thread work status", riskClass: "R1",
        approvalState: "approved", approvalDecisionId: 31, authorityState: "matched",
        authorityLevel: "A2_WRITE_OWN", authorityGrantRef: lifecycleState === "completed" ? "WB-EXEC-GRANT-RENEWED" : "WB-EXEC-GRANT-EXACT",
        authoritySubject: "operator", authorityAction: "outcome:execute", lifecycleState,
        activeWorkOrderId: 44, executionBinding: "exec-44", leaseHolder: lifecycleState === "active" ? "hermes" : null,
        leaseToken: lifecycleState === "active" ? "lease-44" : null,
        leaseExpiresAt: lifecycleState === "active" ? new Date("2099-08-17T18:00:00.000Z") : null,
        acquisitionKey: "acquire-44", terminalKey: lifecycleState === "completed" ? "terminal-44" : null,
        version: lifecycleState === "completed" ? 5 : 3,
      }]],
      decision: [[{
        id: 31, ref: "WB-EXEC-DEC-EXACT", status: "accepted", authority: "binding",
        scope: input.outcomeKey, decision: "APPROVE",
        evidence: [`work-contract:${workContract.id}`, `work-contract-digest:${workContract.digest}`],
      }]],
      authority_grant: [[{
        ref: "WB-EXEC-GRANT-EXACT", scope: input.outcomeKey,
        authorityLevel: "A2_WRITE_OWN", grantedTo: "operator", allowedActions: ["outcome:execute"],
        blockedActions: ["production:mutate"], workOrderId: null,
        status: "revoked", revokedAt: new Date("2026-08-15T18:00:00.000Z"), expiresAt: new Date(expiresAt),
      }]],
    })))
    const { authorizeWorkbenchOutcomeExecution } = await import("@/app/actions/authorize-workbench-outcome-execution")

    for (const state of ["active", "completed"]) {
      lifecycleState = state
      await expect(authorizeWorkbenchOutcomeExecution(input)).resolves.toMatchObject({
        status: "ALREADY_AUTHORIZED", queueVersion: 1,
        authorization: { authorizedAt, expiresAt }, authorizationEffect: "granted_by_action",
        currentAuthority: "not_evaluated", executionObserved: true, workOrderObserved: true,
        leaseObserved: state === "active", dispatchPerformed: false,
      })
    }
    expect(harness.effects).toEqual([])
    expect(harness.revalidatePath).not.toHaveBeenCalled()
  })
})
