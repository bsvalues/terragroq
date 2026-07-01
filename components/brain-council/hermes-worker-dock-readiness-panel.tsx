import { Activity, LockKeyhole } from "lucide-react"
import { getHermesWorkerDockReadiness } from "@/components/brain-council/hermes-worker-dock-readiness"
import { StatusBadge } from "@/components/status-badge"

export function HermesWorkerDockReadinessPanel() {
  const readiness = getHermesWorkerDockReadiness()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Worker Dock readiness
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{readiness.title}</h2>
          <StatusBadge value="neutral" label="read-only" />
          <StatusBadge value="pass" label="no live workers" />
          <StatusBadge value="pass" label="no dispatch" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {readiness.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-4">
        {readiness.cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {card.state}
            </p>
            <p className="mt-2 text-sm font-semibold">{card.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border bg-muted/10 px-4 py-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {readiness.nextReview} This surface has no dispatch button, live worker feed,
          job queue, background polling, MCP activation, or production write behavior.
        </p>
      </div>
    </section>
  )
}
