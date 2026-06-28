import type { EventLog } from "@/lib/db/schema"
import Link from "next/link"
import { Activity } from "lucide-react"
import { getEventEmptyStateActions } from "@/components/dashboard/event-empty-state"

function timeAgo(date: Date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function EventFeed({ events }: { events: EventLog[] }) {
  const emptyStateActions = getEventEmptyStateActions()

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium">Audit stream</h2>
      </div>
      {events.length === 0 ? (
        <div className="space-y-4 px-4 py-6">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-center">
            <p className="text-sm font-medium">No audit events recorded yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Manual operator actions across goals, work orders, doctrine, and registers
              will appear here after they are recorded.
            </p>
          </div>
          <div className="grid gap-2">
            {emptyStateActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40"
              >
                <p className="text-xs font-medium">{action.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm truncate">{e.summary}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {e.type}
                </span>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {timeAgo(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
