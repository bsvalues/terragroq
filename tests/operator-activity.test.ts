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
    })
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
