import { Activity, AlertTriangle, Bot, ShieldCheck } from "lucide-react"

import type { WorkOrder } from "@/lib/db/schema"
import { getActiveWorkQueueSurface } from "@/components/work-orders/active-work-queue"
import { Badge } from "@/components/ui/badge"

export function ActiveWorkQueuePanel({ orders }: { orders: WorkOrder[] }) {
  const surface = getActiveWorkQueueSurface(orders)

  return (
    <section
      aria-labelledby="work-orders-delivery-radar-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="border-b border-border bg-muted/20 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {surface.eyebrow}
          </p>
        </div>
        <h2
          id="work-orders-delivery-radar-heading"
          className="mt-2 text-xl font-semibold tracking-tight"
        >
          {surface.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <div className="grid lg:grid-cols-3">
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <LaneHeader
            icon={<Activity className="h-4 w-4" aria-hidden />}
            label="Moving"
            title={surface.moving.title}
            description={surface.moving.description}
            count={surface.moving.count}
            tone="text-primary"
          />
          <div className="mt-4 space-y-3">
            {surface.moving.items.length > 0 ? (
              surface.moving.items.map((item) => (
                <article key={item.ref} className="rounded-lg border border-border bg-background p-3">
                  <ItemHeader
                    refLabel={item.ref}
                    title={item.title}
                    badges={[
                      { label: item.status, tone: "default" },
                      { label: `evidence ${item.evidenceState}`, tone: "muted" },
                    ]}
                  />
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Boundary <span className="text-foreground">{item.authority}</span>
                  </p>
                </article>
              ))
            ) : (
              <EmptyLane>{surface.moving.emptyState}</EmptyLane>
            )}
          </div>
        </div>

        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <LaneHeader
            icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
            label="Failed"
            title={surface.failed.title}
            description={surface.failed.description}
            count={surface.failed.count}
            tone="text-destructive"
          />
          <div className="mt-4 space-y-3">
            {surface.failed.items.length > 0 ? (
              surface.failed.items.map((item) => (
                <article
                  key={item.ref}
                  className="rounded-lg border border-destructive/25 bg-destructive/5 p-3"
                >
                  <ItemHeader
                    refLabel={item.ref}
                    title={item.title}
                    badges={[
                      { label: item.result, tone: "danger" },
                      { label: item.status, tone: "muted" },
                    ]}
                  />
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    evidence {item.evidenceState}
                  </p>
                </article>
              ))
            ) : (
              <EmptyLane>{surface.failed.emptyState}</EmptyLane>
            )}
          </div>
        </div>

        <div className="p-4">
          <LaneHeader
            icon={<Bot className="h-4 w-4" aria-hidden />}
            label="Next"
            title={surface.hermesNext.title}
            description={surface.hermesNext.description}
            count={surface.hermesNext.count}
            tone="text-violet-600 dark:text-violet-400"
          />
          <div className="mt-4 space-y-3">
            {surface.hermesNext.items.length > 0 ? (
              surface.hermesNext.items.map((item) => (
                <article key={item.ref} className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
                  <ItemHeader
                    refLabel={item.ref}
                    title={item.title}
                    badges={[{ label: item.status, tone: "muted" }]}
                  />
                  <p className="mt-3 text-xs font-semibold text-foreground">{item.action}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </article>
              ))
            ) : (
              <EmptyLane>{surface.hermesNext.emptyState}</EmptyLane>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{surface.sourceNote}</p>
        <div className="flex shrink-0 items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Read-only. No run, retry, merge, or authority controls.
        </div>
      </div>
    </section>
  )
}

function LaneHeader({
  icon,
  label,
  title,
  description,
  count,
  tone,
}: {
  icon: React.ReactNode
  label: string
  title: string
  description: string
  count: number
  tone: string
}) {
  return (
    <div>
      <div className={`flex items-center gap-2 ${tone}`}>
        {icon}
        <p className="font-mono text-[10px] uppercase tracking-[0.2em]">{label}</p>
        <Badge variant="outline" className="ml-auto">
          {count}
        </Badge>
      </div>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

function ItemHeader({
  refLabel,
  title,
  badges,
}: {
  refLabel: string
  title: string
  badges: Array<{ label: string; tone: "default" | "muted" | "danger" }>
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="mr-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {refLabel}
        </p>
        {badges.map((badge) => (
          <Badge
            key={`${badge.label}-${badge.tone}`}
            variant={badge.tone === "default" ? "default" : "outline"}
            className={
              badge.tone === "danger"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : badge.tone === "muted"
                  ? "text-muted-foreground"
                  : undefined
            }
          >
            {badge.label}
          </Badge>
        ))}
      </div>
      <h4 className="mt-2 text-sm font-semibold leading-snug">{title}</h4>
    </div>
  )
}

function EmptyLane({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}
