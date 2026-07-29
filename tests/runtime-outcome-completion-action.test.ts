import { sql, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: {
    select: boundary.select,
  },
}))

vi.mock("@/lib/session", () => ({
  getUserId: boundary.getUserId,
}))

import { getRecentOutcomeCompletionTimeline } from "@/app/actions/goal-timeline"

type FluentQuery<T> = PromiseLike<T[]> & {
  from: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
}

function fluentQuery<T>(rows: T[]): FluentQuery<T> {
  const query = {} as FluentQuery<T>
  query.from = vi.fn(() => query)
  query.where = vi.fn(() => query)
  query.orderBy = vi.fn(() => query)
  query.limit = vi.fn(() => query)
  query.then = ((onFulfilled, onRejected) => (
    Promise.resolve(rows).then(onFulfilled, onRejected)
  )) as FluentQuery<T>["then"]
  return query
}

function renderSql(expression: SQL): {
  sql: string
  params: unknown[]
} {
  return new PgDialect().sqlToQuery(expression)
}

function renderOrderBy(call: unknown[]): string {
  const [first, second] = call as [SQL, SQL]
  return renderSql(sql`${first}, ${second}`).sql
}

describe("recent outcome completion action boundary", () => {
  beforeEach(() => {
    boundary.getUserId.mockReset()
    boundary.select.mockReset()
  })

  it("reads and binds one user-owned completion continuity chain", async () => {
    const userId = "user-runtime-11"
    const predecessorKey = "outcome:merged"
    const successorKey = "outcome:verify"
    const mergeSha = "abcdef0123456789abcdef0123456789abcdef01"
    const completedAt = new Date("2026-07-28T12:05:00.000Z")
    const acquiredAt = new Date("2026-07-28T12:06:00.000Z")
    const completionQuery = fluentQuery([{
      id: 41,
      userId,
      outcomeKey: predecessorKey,
      title: "Merge governed delivery",
      queueOrder: 8,
      dependencyKeys: [],
      lifecycleState: "completed",
      terminalResult: "MERGED_AND_VERIFIED",
      terminalEvidenceRefs: [`merge:${mergeSha}`, "pr:481"],
      terminalAt: completedAt,
      updatedAt: completedAt,
    }])
    const candidateQuery = fluentQuery([{
      id: 42,
      userId,
      outcomeKey: successorKey,
      title: "Verify merged delivery",
      queueOrder: 9,
      dependencyKeys: [predecessorKey],
      lifecycleState: "active",
      terminalResult: null,
      terminalEvidenceRefs: [],
      terminalAt: null,
      updatedAt: acquiredAt,
    }])
    const receiptQuery = fluentQuery([{
      id: 27,
      userId,
      outcomeKey: successorKey,
      firstFencingToken: 7,
      latestFencingToken: 9,
      createdAt: acquiredAt,
      updatedAt: acquiredAt,
    }, {
      id: 28,
      userId,
      outcomeKey: successorKey,
      firstFencingToken: 10,
      latestFencingToken: 10,
      createdAt: new Date("2026-07-28T12:07:00.000Z"),
      updatedAt: new Date("2026-07-28T12:07:00.000Z"),
    }])
    const dependencyMutationQuery = fluentQuery([])

    boundary.getUserId.mockResolvedValue(userId)
    boundary.select
      .mockReturnValueOnce(completionQuery)
      .mockReturnValueOnce(candidateQuery)
      .mockReturnValueOnce(receiptQuery)
      .mockReturnValueOnce(dependencyMutationQuery)

    const timeline = await getRecentOutcomeCompletionTimeline()

    expect(boundary.getUserId).toHaveBeenCalledOnce()
    expect(completionQuery.limit).toHaveBeenCalledWith(6)
    expect(completionQuery.orderBy).toHaveBeenCalledOnce()
    const completionOrder = renderOrderBy(completionQuery.orderBy.mock.calls[0])
    expect(completionOrder).toMatch(/"terminalAt"\s+DESC NULLS LAST/i)
    expect(completionOrder).toMatch(/"id"\s+DESC/i)

    expect(candidateQuery.where).toHaveBeenCalledOnce()
    const candidateBoundary = renderSql(
      candidateQuery.where.mock.calls[0][0] as SQL,
    )
    expect(candidateBoundary.sql).toMatch(/"dependencyKeys"\s+&&\s+\$2/i)
    expect(candidateBoundary.params[0]).toBe(userId)
    expect(String(candidateBoundary.params[1])).toContain(predecessorKey)

    expect(receiptQuery.orderBy).toHaveBeenCalledOnce()
    expect(renderOrderBy(receiptQuery.orderBy.mock.calls[0]))
      .toMatch(/"createdAt"\s+ASC.+?"id"\s+ASC/i)
    expect(receiptQuery.limit).not.toHaveBeenCalled()
    const receiptBoundary = renderSql(receiptQuery.where.mock.calls[0][0] as SQL)
    expect(receiptBoundary.params[0]).toBe(userId)
    expect(receiptBoundary.params).toContain(successorKey)
    expect(Object.keys(boundary.select.mock.calls[2][0])).toEqual([
      "id",
      "userId",
      "outcomeKey",
      "firstFencingToken",
      "latestFencingToken",
      "createdAt",
      "updatedAt",
    ])

    expect(dependencyMutationQuery.where).toHaveBeenCalledOnce()
    const dependencyMutationBoundary = renderSql(
      dependencyMutationQuery.where.mock.calls[0][0] as SQL,
    )
    expect(dependencyMutationBoundary.params).toEqual([
      userId,
      "dependencies",
      successorKey,
    ])
    expect(Object.keys(boundary.select.mock.calls[3][0])).toEqual([
      "id",
      "outcomeKey",
      "createdAt",
    ])
    expect(boundary.select).toHaveBeenCalledTimes(4)

    expect(timeline).toMatchObject({
      truncated: false,
      rows: [{
        outcomeId: "41",
        outcomeKey: predecessorKey,
        terminalResult: "MERGED_AND_VERIFIED",
        mergeEvidence: {
          status: "RECORDED",
          sha: mergeSha,
          prNumber: 481,
        },
        successorEvidence: {
          status: "RECORDED",
          outcomeKey: successorKey,
          title: "Verify merged delivery",
          receiptId: "27",
          acquiredAt: acquiredAt.toISOString(),
          fencingTokenRange: {
            first: 7,
            latest: 9,
          },
        },
      }],
    })
  })

  it("fails closed when dependency audit changed after acquisition", async () => {
    const userId = "user-runtime-audit"
    const predecessorKey = "outcome:completed"
    const successorKey = "outcome:mutated-successor"
    const completedAt = new Date("2026-07-28T12:00:00.000Z")
    const acquiredAt = new Date("2026-07-28T12:01:00.000Z")
    const completionQuery = fluentQuery([{
      id: 51,
      userId,
      outcomeKey: predecessorKey,
      title: "Completed outcome",
      queueOrder: 10,
      dependencyKeys: [],
      lifecycleState: "completed",
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: [],
      terminalAt: completedAt,
      updatedAt: completedAt,
    }])
    const candidateQuery = fluentQuery([{
      id: 52,
      userId,
      outcomeKey: successorKey,
      title: "Mutated successor",
      queueOrder: 11,
      dependencyKeys: [predecessorKey],
      lifecycleState: "blocked",
      terminalResult: null,
      terminalEvidenceRefs: [],
      terminalAt: null,
      updatedAt: new Date("2026-07-28T12:02:00.000Z"),
    }])
    const receiptQuery = fluentQuery([{
      id: 31,
      userId,
      outcomeKey: successorKey,
      firstFencingToken: 3,
      latestFencingToken: 3,
      createdAt: acquiredAt,
      updatedAt: acquiredAt,
    }])
    const dependencyMutationQuery = fluentQuery([{
      id: 71,
      outcomeKey: successorKey,
      createdAt: new Date("2026-07-28T12:02:00.000Z"),
    }])

    boundary.getUserId.mockResolvedValue(userId)
    boundary.select
      .mockReturnValueOnce(completionQuery)
      .mockReturnValueOnce(candidateQuery)
      .mockReturnValueOnce(receiptQuery)
      .mockReturnValueOnce(dependencyMutationQuery)

    const timeline = await getRecentOutcomeCompletionTimeline()

    expect(timeline.rows[0].successorEvidence).toEqual({
      status: "CONFLICTING",
      outcomeKey: null,
      title: null,
      receiptId: null,
      acquiredAt: null,
      fencingTokenRange: null,
    })
    expect(boundary.select).toHaveBeenCalledTimes(4)
  })

  it("does not read dependency audits for candidates without receipts", async () => {
    const userId = "user-runtime-no-receipt"
    const predecessorKey = "outcome:complete-without-successor"
    const completedAt = new Date("2026-07-28T12:00:00.000Z")
    const completionQuery = fluentQuery([{
      id: 61,
      userId,
      outcomeKey: predecessorKey,
      title: "Complete without acquired successor",
      queueOrder: 12,
      dependencyKeys: [],
      lifecycleState: "completed",
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: [],
      terminalAt: completedAt,
      updatedAt: completedAt,
    }])
    const candidateQuery = fluentQuery([{
      id: 62,
      userId,
      outcomeKey: "outcome:suggested-dependent",
      title: "Suggested dependent",
      queueOrder: 13,
      dependencyKeys: [predecessorKey],
      lifecycleState: "suggested",
      terminalResult: null,
      terminalEvidenceRefs: [],
      terminalAt: null,
      updatedAt: completedAt,
    }])
    const receiptQuery = fluentQuery([])

    boundary.getUserId.mockResolvedValue(userId)
    boundary.select
      .mockReturnValueOnce(completionQuery)
      .mockReturnValueOnce(candidateQuery)
      .mockReturnValueOnce(receiptQuery)

    const timeline = await getRecentOutcomeCompletionTimeline()

    expect(timeline.rows[0].successorEvidence.status).toBe("MISSING")
    expect(boundary.select).toHaveBeenCalledTimes(3)
  })

  it("returns the projector empty state without dependent or receipt reads", async () => {
    const completionQuery = fluentQuery([])
    boundary.getUserId.mockResolvedValue("user-empty")
    boundary.select.mockReturnValueOnce(completionQuery)

    await expect(getRecentOutcomeCompletionTimeline()).resolves.toEqual({
      rows: [],
      truncated: false,
    })
    expect(boundary.getUserId).toHaveBeenCalledOnce()
    expect(boundary.select).toHaveBeenCalledOnce()
    expect(completionQuery.limit).toHaveBeenCalledWith(6)
  })
})
