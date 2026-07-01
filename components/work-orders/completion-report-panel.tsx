import { FileText, ShieldCheck } from "lucide-react"

import type { WorkOrder } from "@/lib/db/schema"
import { getCompletionReportSurface } from "@/components/work-orders/completion-report-surface"
import { Badge } from "@/components/ui/badge"

export function CompletionReportPanel({ orders }: { orders: WorkOrder[] }) {
  const surface = getCompletionReportSurface(orders)

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
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
        <div className="grid gap-3 p-4 xl:grid-cols-2">
          {surface.items.map((item) => (
            <article key={item.ref} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.ref}</p>
                  <h3 className="mt-1 text-sm font-semibold">{item.title}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.status}</Badge>
                  <Badge>{item.result}</Badge>
                </div>
              </div>
              <pre className="mt-4 max-h-56 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {item.report}
              </pre>
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

      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Read-only renderer. No result recording, gate changes, closure action, or production write.
      </div>
    </section>
  )
}
