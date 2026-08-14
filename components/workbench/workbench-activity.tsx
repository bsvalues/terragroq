"use client"

import { ActivityView } from "@/components/activity/activity-view"
import { useWorkbenchContext } from "@/components/workbench/workbench-context"
import type { ActivityFeed } from "@/lib/operator/activity"

export function WorkbenchActivity({ feed }: { feed: ActivityFeed }) {
  const workbench = useWorkbenchContext()
  return <ActivityView feed={feed} onFocusThread={workbench?.focusThread} />
}
