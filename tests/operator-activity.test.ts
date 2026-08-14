import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const boundary = vi.hoisted(() => ({
  execute: vi.fn(),
  getUserId: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: { execute: boundary.execute },
}))

vi.mock("@/lib/session", () => ({
  getUserId: boundary.getUserId,
}))

import { getActivity } from "@/lib/operator/activity"
import * as activityModule from "@/lib/operator/activity"

describe("operator activity truth", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-14T05:30:00.000Z"))
    boundary.execute.mockReset()
    boundary.getUserId.mockReset()
    boundary.getUserId.mockResolvedValue("primary-user")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("distinguishes query observation time from the latest persisted event", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 7, latestEventAt: new Date("2026-08-14T04:41:11.000Z") }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 42,
          eventType: "HERMES_OUTCOME_COMPLETED",
          actor: "aegis",
          reason: null,
          metadata: { workOrderRef: "WO-ACTIVITY", prNumber: 761 },
          createdAt: new Date("2026-08-14T04:41:11.000Z"),
        }],
      })

    await expect(getActivity()).resolves.toMatchObject({
      observedAt: "2026-08-14T05:30:00.000Z",
      latestEventAt: "2026-08-14T04:41:11.000Z",
      truthState: "persisted",
    })
  })

  it("reports an empty observation without inventing a latest event", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 0, latestEventAt: null }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(getActivity()).resolves.toMatchObject({
      observedAt: "2026-08-14T05:30:00.000Z",
      latestEventAt: null,
      truthState: "idle-empty",
    })
  })

  it("keeps churn-only persisted history distinct from an empty database", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 3, latestEventAt: "2026-08-14T05:10:00.000Z" }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(getActivity()).resolves.toMatchObject({
      items: [],
      churnCollapsed: 3,
      latestEventAt: "2026-08-14T05:10:00.000Z",
      truthState: "persisted",
    })
  })

  it("uses event id as a stable tie-breaker for equal timestamps", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 0, latestEventAt: null }] })
      .mockResolvedValueOnce({ rows: [] })

    await getActivity()

    const query = new PgDialect().sqlToQuery(boundary.execute.mock.calls[1][0] as SQL)
    expect(query.sql).toMatch(/order by "createdAt" desc, id desc/i)
    expect(query.sql).toMatch(/"createdAt" AT TIME ZONE current_setting\('TimeZone'\)/i)
  })

  it("preserves persisted entity identity when metadata has no work reference", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 0, latestEventAt: "2026-08-14T05:20:00.000Z" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 43,
          ref: "GEV-0043",
          eventType: "GOAL_CREATED",
          entityType: "goal",
          entityId: "GOAL-0762",
          actor: "primary",
          reason: "classified from owner intent",
          metadata: null,
          createdAt: "2026-08-14T05:20:00.000Z",
        }],
      })

    const feed = await getActivity()

    expect(feed.items[0]).toMatchObject({
      ref: "goal:GOAL-0762",
      detail: "goal:GOAL-0762 · classified from owner intent",
      threadId: null,
      projectId: null,
    })
  })

  it("projects an owning Thread only from one explicit tenant-scoped source binding", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 0, latestEventAt: "2026-08-14T05:20:00.000Z" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 44,
          ref: "GEV-0044",
          eventType: "GOAL_CREATED",
          entityType: "goal",
          entityId: "41",
          actor: "primary",
          reason: null,
          metadata: {},
          createdAt: "2026-08-14T05:20:00.000Z",
          threadId: "thread-41",
          projectId: 7,
        }],
      })

    const feed = await getActivity()
    const query = new PgDialect().sqlToQuery(boundary.execute.mock.calls[1][0] as SQL)

    expect(feed.items[0]).toMatchObject({ threadId: "thread-41", projectId: 7 })
    expect(query.sql).toMatch(/workbench_thread_source/i)
    expect(query.sql).toMatch(/workbench_thread/i)
    expect(query.sql).toMatch(/sourceType[\s\S]*goal[\s\S]*outcome/i)
    expect(query.sql).toMatch(/entityType[\s\S]*goal[\s\S]*outcome_queue_item/i)
    expect(query.sql).toMatch(/case when count\(\*\) = 1 then/i)
    expect(query.params.filter((value) => value === "primary-user")).toHaveLength(2)
    expect(query.sql).not.toMatch(/metadata\s*->>|(?:repo|path|title)/i)
  })

  it("keeps missing and ambiguous source ownership unavailable", async () => {
    boundary.execute
      .mockResolvedValueOnce({ rows: [{ n: 0, latestEventAt: "2026-08-14T05:20:00.000Z" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 45, ref: "WO-LOOKALIKE", eventType: "WO_TRANSITION", entityType: "work_order", entityId: "41",
            actor: "primary", reason: null, metadata: { workOrderRef: "WO-41" },
            createdAt: "2026-08-14T05:20:00.000Z", threadId: null, projectId: null,
          },
          {
            id: 46, ref: "GEV-0046", eventType: "GOAL_CREATED", entityType: "goal", entityId: "42",
            actor: "primary", reason: null, metadata: {},
            createdAt: "2026-08-14T05:19:00.000Z", threadId: null, projectId: null,
          },
        ],
      })

    const feed = await getActivity()

    expect(feed.items.map(({ threadId, projectId }) => ({ threadId, projectId }))).toEqual([
      { threadId: null, projectId: null },
      { threadId: null, projectId: null },
    ])
  })

  it("exposes focus only when both durable Thread coordinates are present", () => {
    const focusTarget = (activityModule as typeof activityModule & {
      activityFocusTarget?: (item: activityModule.ActivityItem) => { threadId: string; projectId: number } | null
    }).activityFocusTarget
    const item: activityModule.ActivityItem = {
      id: 44, at: "2026-08-14T05:20:00.000Z", kind: "goal", label: "Goal created",
      detail: "goal:41", ref: "goal:41", threadId: "thread-41", projectId: 7,
    }

    expect(focusTarget).toBeTypeOf("function")
    expect(focusTarget?.(item)).toEqual({ threadId: "thread-41", projectId: 7 })
    expect(focusTarget?.({ ...item, threadId: null })).toBeNull()
    expect(focusTarget?.({ ...item, projectId: null })).toBeNull()
  })

  it("summarizes churn-only persisted history instead of calling it empty", () => {
    const summarize = (activityModule as typeof activityModule & {
      summarizeActivityFeed?: (feed: activityModule.ActivityFeed) => string | null
    }).summarizeActivityFeed
    const feed: activityModule.ActivityFeed = {
      items: [],
      churnCollapsed: 3,
      source: "governance_event (meaningful events; runtime churn collapsed)",
      latestEventAt: "2026-08-14T05:10:00.000Z",
      observedAt: "2026-08-14T05:30:00.000Z",
      truthState: "persisted",
    }

    expect(summarize).toBeTypeOf("function")
    expect(summarize?.(feed)).toBe("3 runtime/retry steps collapsed")
  })

  it("labels the persisted event clock separately from the read clock", () => {
    const caption = (activityModule as typeof activityModule & {
      activityTruthCaption?: (feed: activityModule.ActivityFeed) => string
    }).activityTruthCaption
    const feed: activityModule.ActivityFeed = {
      items: [],
      churnCollapsed: 3,
      source: "governance_event (meaningful events; runtime churn collapsed)",
      latestEventAt: "2026-08-14T05:10:00.000Z",
      observedAt: "2026-08-14T05:30:00.000Z",
      truthState: "persisted",
    }

    expect(caption).toBeTypeOf("function")
    expect(caption?.(feed)).toBe("Persisted activity through 2026-08-14 05:10 UTC · read 2026-08-14 05:30 UTC")
  })

})
