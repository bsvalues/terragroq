import { ClipboardList, ShieldCheck } from "lucide-react"
import type { WorkOrder } from "@/lib/db/schema"
import { getWorkOrdersCommandSurface } from "@/components/work-orders/work-orders-command-surface"

export function WorkOrdersCommandPanel({ orders }: { orders: WorkOrder[] }) {
  const surface = getWorkOrdersCommandSurface(orders)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            {surface.eyebrow}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        {surface.cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium">Next Recommended WO</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {surface.nextRecommendedWo.label}: {surface.nextRecommendedWo.reason}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden={true} />
          Read-only surface. No loop starts, authority grants, or production writes.
        </div>
      </div>
    </section>
  )
}
