import { BarChart3, ShieldCheck } from "lucide-react"

import type { EventLog } from "@/lib/db/schema"
import { getEvidenceRollupSurface } from "@/components/evidence/evidence-rollup-surface"

export function EvidenceRollupPanel({ events }: { events: EventLog[] }) {
  const surface = getEvidenceRollupSurface(events)

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            WilliamOS Work Order Engine
          </p>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{surface.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.description}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {surface.cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-4">
        <p className="text-sm font-medium">Recent proof signals</p>
        {surface.recentSignals.length > 0 ? (
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {surface.recentSignals.map((signal) => (
              <li key={signal} className="rounded-md border border-border bg-background px-3 py-2">
                {signal}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No recent proof signals are available yet.
          </p>
        )}
      </div>

      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2 xl:grid-cols-4">
        {surface.proofStates.map((state) => (
          <div key={state.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {state.status}
            </p>
            <p className="mt-2 text-sm font-semibold">{state.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{state.description}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Read-only rollup. No evidence recording, event mutation, ingestion, or production write.
      </div>
    </section>
  )
}
