import { Database, Server, ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import type { SystemTruthSignal } from "@/lib/system/system-truth"

const SYSTEM_ICON = {
  ATLAS: Database,
  HERMES: Server,
  AEGIS: ShieldCheck,
} as const

export function SystemTruthPanel({ signals }: { signals: SystemTruthSignal[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border bg-muted/30 px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Current system truth
        </p>
        <h2 className="mt-1 text-lg font-semibold">ATLAS · HERMES · AEGIS</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each claim carries its own evidence class. Configuration and persisted history never become live status.
        </p>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {signals.map((signal) => {
          const Icon = SYSTEM_ICON[signal.system]
          return (
            <article key={`${signal.system}:${signal.signal}`} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" aria-hidden={true} />
                <h3 className="font-mono text-sm font-semibold">{signal.system}</h3>
                <StatusBadge value={signal.truthState} label={signal.truthState} />
              </div>
              <p className="mt-3 text-sm font-medium">{signal.summary}</p>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground">
                <div>
                  <dt className="font-mono uppercase tracking-wider">Signal</dt>
                  <dd className="mt-1">{signal.signal}</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-wider">Source</dt>
                  <dd className="mt-1">{signal.source}</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-wider">Observed</dt>
                  <dd className="mt-1">
                    {signal.observedAt ? new Date(signal.observedAt).toISOString() : "No live observation"}
                  </dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>

      <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        SYSTEM is read-only. It does not start, stop, repair, deploy, or grant authority to any runtime.
      </footer>
    </section>
  )
}
