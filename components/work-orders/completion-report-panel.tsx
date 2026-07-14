import { FileText, ShieldCheck } from "lucide-react"

import type { WorkOrder } from "@/lib/db/schema"
import {
  getCompletionReportSurface,
  type CompletionOwnerOperationInput,
} from "@/components/work-orders/completion-report-surface"
import { Badge } from "@/components/ui/badge"
import { formatOwnerOperationCounter, OWNER_OPERATION_COUNTER_NAMES } from "@/lib/governance/owner-operation-evidence"

export function CompletionReportPanel({
  orders,
  ownerOperations,
}: {
  orders: WorkOrder[]
  ownerOperations?: CompletionOwnerOperationInput
}) {
  const surface = getCompletionReportSurface(orders, ownerOperations)

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Completion proof
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
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium">Owner-operation evidence</p>
                  <Badge variant="outline" className="max-w-full whitespace-normal break-all text-right">
                    {item.ownerOperationEvidence.lifecycleState}
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {OWNER_OPERATION_COUNTER_NAMES.map((name) => (
                    <div key={name} className="flex items-center justify-between gap-3 text-xs">
                      <dt className="break-all font-mono text-[10px] text-muted-foreground">{name}</dt>
                      <dd className="font-semibold tabular-nums">
                        {formatOwnerOperationCounter(item.ownerOperationEvidence.counters[name])}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 break-all text-xs leading-relaxed text-muted-foreground">
                  {item.ownerOperationEvidence.certification.evidenceHeadHash
                    ? `Independent evidence: ${item.ownerOperationEvidence.certification.evidenceHeadHash}`
                    : "Non-certifying: no independent owner-operation evidence reference is bound."}
                </p>
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

      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Read-only renderer. It shows closure proof; it does not record results, change gates, close work, or write production.
      </div>
    </section>
  )
}
