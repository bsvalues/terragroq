import type { ActivityFeed, ActivityKind } from "@/lib/operator/activity"
import { Card, CardContent } from "@/components/ui/card"

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

export function ActivityView({ feed }: { feed: ActivityFeed }) {
  if (feed.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">No recorded activity yet.</CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs text-muted-foreground">
        {feed.items.length} meaningful events
        {feed.churnCollapsed > 0 ? ` · ${feed.churnCollapsed} runtime/retry steps collapsed` : ""}
      </p>
      <ol className="flex flex-col">
        {feed.items.map((it) => (
          <li key={it.id} className="relative flex gap-3 border-l border-border pb-4 pl-4 last:border-transparent last:pb-0">
            <span className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${dotClass[it.kind]}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium capitalize">{it.label}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{stamp(it.at)}</span>
              </div>
              {it.detail ? <div className="truncate font-mono text-xs text-muted-foreground">{it.detail}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
