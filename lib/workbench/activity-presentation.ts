export interface ActivityFocusCoordinates {
  threadId: string | null
  projectId: number | null
}

export interface ActivityPresentationFeed {
  items: readonly unknown[]
  churnCollapsed: number
  latestEventAt: string | null
  observedAt: string
}

export function activityFocusTarget(
  item: ActivityFocusCoordinates,
): { threadId: string; projectId: number } | null {
  if (item.threadId === null || item.projectId === null) return null
  return { threadId: item.threadId, projectId: item.projectId }
}

export function summarizeActivityFeed(feed: ActivityPresentationFeed): string | null {
  if (feed.items.length === 0 && feed.churnCollapsed === 0) return null

  const meaningful = feed.items.length > 0 ? `${feed.items.length} meaningful events` : null
  const churn = feed.churnCollapsed > 0 ? `${feed.churnCollapsed} runtime/retry steps collapsed` : null
  return [meaningful, churn].filter(Boolean).join(" · ")
}

const activityTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`

export function activityTruthCaption(feed: ActivityPresentationFeed): string {
  const observed = activityTime(feed.observedAt)
  if (feed.latestEventAt === null) return `No persisted activity as of ${observed}`
  return `Persisted activity through ${activityTime(feed.latestEventAt)} · read ${observed}`
}
