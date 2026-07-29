import { getTableName } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  createAuthorityGrantWithResult: vi.fn(),
  dbInsert: vi.fn(),
  dbSelect: vi.fn(),
  dbTransaction: vi.fn(),
  dbUpdate: vi.fn(),
  getSession: vi.fn(),
  getUserId: vi.fn(),
  logEvent: vi.fn(),
  mutateOutcomeQueueItem: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    insert: boundary.dbInsert,
    select: boundary.dbSelect,
    transaction: boundary.dbTransaction,
    update: boundary.dbUpdate,
  },
  pool: {},
}))
vi.mock("@/lib/session", () => ({
  getSession: boundary.getSession,
  getUserId: boundary.getUserId,
}))
vi.mock("@/app/actions/authority", () => ({
  createAuthorityGrantWithResult: boundary.createAuthorityGrantWithResult,
}))
vi.mock("@/lib/registers/events", () => ({
  logEvent: boundary.logEvent,
}))
vi.mock("@/scripts/hermes-bridge/outcome-queue-source.mjs", () => ({
  mutateOutcomeQueueItem: boundary.mutateOutcomeQueueItem,
}))
vi.mock("next/cache", () => ({
  revalidatePath: boundary.revalidatePath,
}))

import {
  mutateOutcomeQueue,
  recordOutcomeAuthorityGrant,
  recordV12CampaignOutcomeAuthority,
} from "@/app/actions/outcome-queue"
import {
  createDecision,
  updateDecisionStatus,
} from "@/app/actions/decisions"
import {
  v12CampaignDecision,
  v12CampaignGrant,
  buildV12CampaignMaterializationProvenance,
  V1_2_CAMPAIGN_GRANT_DURATION_MS,
  V1_2_CAMPAIGN_PARENT_ISSUE_URL,
} from "@/lib/outcome-queue/v1-2-campaign-authority"

type FluentQuery<T> = PromiseLike<T[]> & {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
}

function fluentQuery<T>(rows: T[]): FluentQuery<T> {
  const query = {} as FluentQuery<T>
  query.from = vi.fn(() => query)
  query.where = vi.fn(() => query)
  query.limit = vi.fn((count: number) => Promise.resolve(rows.slice(0, count)))
  query.then = ((onFulfilled, onRejected) => (
    Promise.resolve(rows).then(onFulfilled, onRejected)
  )) as FluentQuery<T>["then"]
  return query
}

const campaignScope = "campaign:v1-2:queue-evidence-drilldown"

function transactionHarness(selectRows: unknown[][]) {
  const inserts: Array<{ table: string; values: unknown }> = []
  const source = [...selectRows]
  const transaction = {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => fluentQuery(source.shift() ?? [])),
    insert: vi.fn((table: unknown) => {
      const tableName = getTableName(table as never)
      let values: unknown
      const chain = {
        values(next: unknown) {
          values = next
          inserts.push({ table: tableName, values: next })
          return chain
        },
        returning() {
          const value = Array.isArray(values) ? values[0] : values
          const id = tableName === "decision" ? 71
            : tableName === "authority_grant" ? 72
              : 73
          return Promise.resolve([{ id, ...(value as Record<string, unknown>) }])
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(undefined).then(resolve, reject)
        },
      }
      return chain
    }),
    update: vi.fn(() => {
      let values: Record<string, unknown>
      const chain = {
        set(next: Record<string, unknown>) {
          values = next
          return chain
        },
        where() {
          return chain
        },
        returning() {
          return Promise.resolve([{ id: 31, ...values }])
        },
      }
      return chain
    }),
  }
  return { inserts, transaction }
}

describe("V1.2 campaign server authority boundaries", () => {
  beforeEach(() => {
    vi.useRealTimers()
    Object.values(boundary).forEach((mock) => mock.mockReset())
    boundary.getUserId.mockResolvedValue("primary-1")
    boundary.getSession.mockResolvedValue({
      user: { id: "primary-1", email: "bsvalues@gmail.com" },
    })
  })

  it("records authority only when the exact materializer goal and audit chain are present", async () => {
    const suggestedAt = new Date("2026-07-29T20:00:00.000Z")
    const approvalAt = new Date("2026-07-29T22:00:00.000Z")
    vi.useFakeTimers()
    vi.setSystemTime(approvalAt)
    const item = {
      id: 31,
      userId: "primary-1",
      outcomeKey: campaignScope,
      goalId: 21,
      goalRef: "GOAL-0021",
      title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
      objective: "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist.",
      queueOrder: 12,
      dependencyKeys: [],
      riskClass: "R1",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      approvalDecisionId: null,
      authorityState: "unverified",
      authorityLevel: "A0_READ_ONLY",
      authorityGrantRef: null,
      authoritySubject: "operator",
      authorityAction: "outcome:execute",
      lifecycleState: "suggested",
      lifecycleReason: "V1_2_CAMPAIGN_SUGGESTION_REQUIRES_OWNER_APPROVAL",
      activeWorkOrderId: null,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      fencingToken: 0,
      version: 0,
      acquisitionKey: null,
      terminalResult: null,
      terminalEvidenceId: null,
      terminalEvidenceRefs: [],
      terminalKey: null,
      supersedesOutcomeKey: null,
      supersededByOutcomeKey: null,
      activatedAt: null,
      terminalAt: null,
      suggestedAt,
      createdAt: suggestedAt,
      updatedAt: suggestedAt,
    }
    const materializedGoal = {
      id: 21,
      userId: "primary-1",
      ref: "GOAL-0021",
      command: item.title,
      lane: "read_model",
      mode: "implement",
      risk: "low",
      authority: "A0_READ_ONLY",
      verdict: "requires_approval",
      rationale: "Suggested as fixed WilliamOS-native R1 work from pinned live parent #471; this record conveys no approval or execution authority.",
      mistakePatterns: [],
      matchedRules: [],
      recommendedMove: "Await an explicit owner approval and independently verified authority match.",
      requiresApproval: true,
      linkedWorkOrderId: null,
      status: "classified",
      createdAt: suggestedAt,
      updatedAt: suggestedAt,
    }
    const provenance = buildV12CampaignMaterializationProvenance(
      "primary-1",
      item,
    )
    const materialization = {
      id: 41,
      userId: "primary-1",
      eventType: "V1_2_CHILD_OUTCOME_SUGGESTED",
      entityType: "outcome_queue_item",
      entityId: campaignScope,
      actor: "hermes",
      reason: "Suggested from the exact owner-authored and still-open V1.2 parent #471 without approval or authority.",
      beforeHash: null,
      afterHash: provenance.contentHash,
      evidenceId: null,
      metadata: provenance,
      createdAt: suggestedAt,
    }
    const audit = {
      userId: "primary-1",
      type: "outcome.suggested",
      summary: "GOAL-0021 suggested from pinned live V1.2 parent #471; owner approval remains required.",
      register: "outcome-queue",
      refId: 21,
      metadata: {
        governanceEventId: 41,
        outcomeKey: campaignScope,
        parentIssue: V1_2_CAMPAIGN_PARENT_ISSUE_URL,
        provenanceContract: provenance.contract,
        provenanceHash: provenance.contentHash,
      },
      createdAt: suggestedAt,
    }
    const harness = transactionHarness([
      [item],
      [materializedGoal],
      [materialization],
      [audit],
      [],
      [],
    ])
    boundary.dbTransaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) => (
        callback(harness.transaction)
      ),
    )

    await expect(recordV12CampaignOutcomeAuthority({
      outcomeKey: campaignScope,
      expectedVersion: 0,
    })).resolves.toMatchObject({
      status: "RECORDED",
      outcomeKey: campaignScope,
      version: 1,
    })

    const grantInsert = harness.inserts.find(
      (entry) => entry.table === "authority_grant",
    )?.values as { createdAt: Date; expiresAt: Date }
    expect(grantInsert.expiresAt.getTime() - grantInsert.createdAt.getTime())
      .toBe(V1_2_CAMPAIGN_GRANT_DURATION_MS)
    const authorityEvent = harness.inserts.find(
      (entry) => entry.table === "governance_event"
        && (entry.values as { eventType?: string }).eventType === "AUTHORITY_GRANTED",
    )?.values as { metadata: Record<string, unknown> }
    expect(authorityEvent.metadata).toMatchObject({
      parentBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      materializationEventId: 41,
      materializationAfterHash: materialization.afterHash,
      goalId: 21,
      goalRef: "GOAL-0021",
    })
  })

  it("renews an expired exact grant as a new deterministic 48-hour generation", async () => {
    const now = new Date("2026-08-01T02:00:00.000Z")
    const priorIssuedAt = new Date(
      now.getTime() - V1_2_CAMPAIGN_GRANT_DURATION_MS - 1,
    )
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const priorDraft = v12CampaignGrant(
      campaignScope,
      "primary-1",
      priorIssuedAt,
    )
    const approval = {
      id: 71,
      userId: "primary-1",
      ...v12CampaignDecision(campaignScope),
      decidedAt: priorIssuedAt,
      createdAt: priorIssuedAt,
      updatedAt: priorIssuedAt,
    }
    const priorGrant = {
      id: 72,
      ...priorDraft,
      createdAt: new Date(priorDraft.createdAt),
      expiresAt: new Date(priorDraft.expiresAt),
    }
    const item = {
      id: 31,
      outcomeKey: campaignScope,
      lifecycleState: "approved",
      approvalState: "approved",
      authorityState: "matched",
      approvalDecisionId: 71,
      authorityGrantRef: priorGrant.ref,
      version: 1,
      activeWorkOrderId: null,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
      terminalResult: null,
      terminalEvidenceId: null,
      terminalEvidenceRefs: [],
      terminalKey: null,
      activatedAt: null,
      terminalAt: null,
    }
    const harness = transactionHarness([
      [item],
      [approval],
      [priorGrant],
      [],
    ])
    boundary.dbTransaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) => (
        callback(harness.transaction)
      ),
    )

    await expect(recordV12CampaignOutcomeAuthority({
      outcomeKey: campaignScope,
      expectedVersion: 1,
    })).resolves.toMatchObject({
      status: "RECORDED",
      version: 2,
    })

    const grants = harness.inserts.filter(
      (entry) => entry.table === "authority_grant",
    )
    expect(grants).toHaveLength(1)
    const renewed = grants[0].values as {
      ref: string
      createdAt: Date
      expiresAt: Date
    }
    expect(renewed.ref).not.toBe(priorGrant.ref)
    expect(renewed.expiresAt.getTime() - renewed.createdAt.getTime())
      .toBe(V1_2_CAMPAIGN_GRANT_DURATION_MS)
    expect(harness.inserts).toContainEqual(expect.objectContaining({
      table: "governance_event",
      values: expect.objectContaining({
        eventType: "AUTHORITY_RENEWED",
        metadata: expect.objectContaining({
          replacesGrantRef: priorGrant.ref,
        }),
      }),
    }))
  })

  it("rejects an authenticated non-Primary session before opening a transaction", async () => {
    boundary.getSession.mockResolvedValue({
      user: { id: "diagnostic-1", email: "test+wo@example.com" },
    })

    await expect(recordV12CampaignOutcomeAuthority({
      outcomeKey: campaignScope,
      expectedVersion: 0,
    })).resolves.toMatchObject({
      status: "UNAUTHORIZED",
      version: null,
    })
    expect(boundary.dbTransaction).not.toHaveBeenCalled()
  })

  it("blocks the generic grant and decision paths for fixed campaign scopes", async () => {
    await expect(recordOutcomeAuthorityGrant({
      outcomeKey: campaignScope,
      approvalDecisionId: 17,
    })).resolves.toEqual({
      status: "INVALID",
      message: "Use the bounded Primary campaign authority control.",
      grantRef: null,
    })
    await expect(createDecision({
      title: "Bypass",
      decision: "APPROVE",
      status: "accepted",
      authority: "binding",
      scope: campaignScope,
    })).rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")
    await expect(recordOutcomeAuthorityGrant({
      outcomeKey: "acceptance:v1-2:authority-blocked",
      approvalDecisionId: 18,
    })).resolves.toMatchObject({ status: "INVALID" })
    await expect(createDecision({
      title: "Acceptance bypass",
      decision: "APPROVE",
      status: "accepted",
      authority: "binding",
      scope: "acceptance:v1-2:authority-blocked",
    })).rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")

    boundary.dbSelect.mockReturnValueOnce(fluentQuery([{ scope: campaignScope }]))
    await expect(updateDecisionStatus(71, "accepted"))
      .rejects.toThrow("V1_2_BOUND_AUTHORITY_ACTION_REQUIRED")

    expect(boundary.createAuthorityGrantWithResult).not.toHaveBeenCalled()
    expect(boundary.dbInsert).not.toHaveBeenCalled()
    expect(boundary.dbUpdate).not.toHaveBeenCalled()
  })

  it("passes a complete ordinary reorder when protected position and version are unchanged", async () => {
    boundary.dbSelect.mockReturnValueOnce(fluentQuery([
      {
        outcomeKey: "goal:ordinary-a",
        queueOrder: 0,
        lifecycleState: "suggested",
        version: 2,
      },
      {
        outcomeKey: campaignScope,
        queueOrder: 1,
        lifecycleState: "suggested",
        version: 0,
      },
      {
        outcomeKey: "goal:ordinary-b",
        queueOrder: 2,
        lifecycleState: "approved",
        version: 4,
      },
    ]))
    boundary.mutateOutcomeQueueItem.mockResolvedValue({
      replayed: false,
      outcome: { outcomeKey: "goal:ordinary-a", version: 3 },
    })

    await expect(mutateOutcomeQueue({
      action: "reorder",
      outcomeKey: "goal:ordinary-a",
      expectedVersion: 2,
      idempotencyKey: "reorder:ordinary:1",
      orderedOutcomes: [
        { outcomeKey: "goal:ordinary-b", expectedVersion: 4 },
        { outcomeKey: campaignScope, expectedVersion: 0 },
        { outcomeKey: "goal:ordinary-a", expectedVersion: 2 },
      ],
    })).resolves.toMatchObject({
      status: "RECORDED",
      outcomeKey: "goal:ordinary-a",
    })
    expect(boundary.mutateOutcomeQueueItem).toHaveBeenCalledOnce()
  })

  it("rejects a complete reorder that moves or version-rebinds a protected row", async () => {
    const rows = [
      {
        outcomeKey: "goal:ordinary-a",
        queueOrder: 0,
        lifecycleState: "suggested",
        version: 2,
      },
      {
        outcomeKey: campaignScope,
        queueOrder: 1,
        lifecycleState: "suggested",
        version: 0,
      },
      {
        outcomeKey: "goal:ordinary-b",
        queueOrder: 2,
        lifecycleState: "approved",
        version: 4,
      },
    ]
    boundary.dbSelect
      .mockReturnValueOnce(fluentQuery(rows))
      .mockReturnValueOnce(fluentQuery(rows))

    await expect(mutateOutcomeQueue({
      action: "reorder",
      outcomeKey: "goal:ordinary-a",
      expectedVersion: 2,
      idempotencyKey: "reorder:protected:moved",
      orderedOutcomes: [
        { outcomeKey: campaignScope, expectedVersion: 0 },
        { outcomeKey: "goal:ordinary-b", expectedVersion: 4 },
        { outcomeKey: "goal:ordinary-a", expectedVersion: 2 },
      ],
    })).resolves.toMatchObject({ status: "INVALID" })
    await expect(mutateOutcomeQueue({
      action: "reorder",
      outcomeKey: "goal:ordinary-a",
      expectedVersion: 2,
      idempotencyKey: "reorder:protected:version",
      orderedOutcomes: [
        { outcomeKey: "goal:ordinary-b", expectedVersion: 4 },
        { outcomeKey: campaignScope, expectedVersion: 1 },
        { outcomeKey: "goal:ordinary-a", expectedVersion: 2 },
      ],
    })).resolves.toMatchObject({ status: "INVALID" })

    expect(boundary.mutateOutcomeQueueItem).not.toHaveBeenCalled()
  })
})
