"use client"

import type { ActivityFeed, ActivityKind } from "@/lib/operator/activity"
import {
  activityFocusTarget,
  activityTruthCaption,
  summarizeActivityFeed,
} from "@/lib/workbench/activity-presentation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const dotClass: Record<ActivityKind, string> = {
  delivery: "bg-emerald-500",
  terminal: "bg-amber-500",
  failure: "bg-destructive",
  authority: "bg-sky-500",
  goal: "bg-primary",
  transition: "bg-muted-foreground",
  runtime: "bg-muted-foreground",
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ")
}

export interface ActivityViewProps {
  feed: ActivityFeed
  onFocusThread?: (target: { threadId: string; projectId: number }) => void
}

export function ActivityView({ feed, onFocusThread }: ActivityViewProps) {
  const summary = summarizeActivityFeed(feed)

  if (summary === null) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">No recorded activity yet.</CardContent>
      </Card>
    )
  }

  if (feed.items.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-1 py-6 font-mono text-xs text-muted-foreground">
          <p>{summary}</p>
          <p>{activityTruthCaption(feed)}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs text-muted-foreground">
        {summary}
      </p>
      <p className="font-mono text-xs text-muted-foreground">{activityTruthCaption(feed)}</p>
      <ol className="flex flex-col">
        {feed.items.map((it) => {
          const focusTarget = activityFocusTarget(it)
          return (
            <li key={it.id} className="relative flex gap-3 border-l border-border pb-4 pl-4 last:border-transparent last:pb-0">
              <span className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${dotClass[it.kind]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium capitalize">{it.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{stamp(it.at)}</span>
                </div>
                {it.detail ? <div className="truncate font-mono text-xs text-muted-foreground">{it.detail}</div> : null}
                {focusTarget && onFocusThread ? (
                  <Button
                    className="mt-1 h-auto px-0 py-0 text-xs"
                    type="button"
                    variant="link"
                    onClick={() => onFocusThread(focusTarget)}
                  >
                    Focus thread
                  </Button>
                ) : (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {focusTarget ? "Thread available in Workbench" : "Thread unavailable"}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
