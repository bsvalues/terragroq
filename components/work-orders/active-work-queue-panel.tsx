import { ListChecks, ShieldCheck } from "lucide-react"

import type { WorkOrder } from "@/lib/db/schema"
import { getActiveWorkQueueSurface } from "@/components/work-orders/active-work-queue"
import { Badge } from "@/components/ui/badge"

export function ActiveWorkQueuePanel({ orders }: { orders: WorkOrder[] }) {
  const surface = getActiveWorkQueueSurface(orders)

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            WilliamOS Work Order Engine
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      {surface.items.length > 0 ? (
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {surface.items.map((item) => (
            <article key={item.ref} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.ref}</p>
                  <h3 className="mt-1 text-sm font-semibold">{item.title}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.status}</Badge>
                  <Badge variant={item.evidenceState === "present" ? "default" : "secondary"}>
                    evidence {item.evidenceState}
                  </Badge>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-[0.7fr_1fr]">
                <div>
                  <p className="font-mono uppercase tracking-wider">Authority</p>
                  <p className="mt-1 text-foreground">{item.authority}</p>
                </div>
                <div>
                  <p className="font-mono uppercase tracking-wider">Next move</p>
                  <p className="mt-1 leading-relaxed text-foreground">{item.nextMove}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <div className="rounded-lg border border-dashed border-border bg-background p-4">
            <p className="text-sm font-medium">{surface.emptyState.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{surface.emptyState.description}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Next valid batch
          </p>
          <p className="mt-2 text-sm font-semibold">{surface.nextBatch.label}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.nextBatch.description}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Recent completed phase
          </p>
          <p className="mt-2 text-sm font-semibold">{surface.completedPhase.label}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {surface.completedPhase.validation}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Read-only queue. No loop start, execution, authority grant, or production write.
      </div>
    </section>
  )
}
