import { Database, Server, ShieldCheck } from "lucide-react"
import type { SystemTruthSignal } from "@/lib/system/system-truth"

const SYSTEM_ICON = {
  ATLAS: Database,
  HERMES: Server,
  AEGIS: ShieldCheck,
} as const

export function SystemTruthPanel({ signals }: { signals: SystemTruthSignal[] }) {
  return (
    <section>
      <ol className="divide-y divide-[var(--workbench-hairline)] border-y border-[var(--workbench-hairline)]">
        {signals.map((signal) => {
          const Icon = SYSTEM_ICON[signal.system]
          return (
            <li key={`${signal.system}:${signal.signal}`} className="grid gap-3 py-4 md:grid-cols-[9rem_minmax(0,1fr)_11rem] md:items-start">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--workbench-copper)]" aria-hidden={true} />
                <h2 className="font-mono text-sm font-semibold">{signal.system}</h2>
              </div>
              <div>
                <p className="text-sm font-medium">{signal.summary}</p>
                <p className="mt-1 text-xs text-[var(--workbench-muted)]">{signal.signal} · {signal.source}</p>
              </div>
              <dl className="text-xs text-[var(--workbench-muted)] md:text-right">
                <div>
                  <dt className="font-mono uppercase tracking-wider">{signal.truthState}</dt>
                  <dd className="mt-1 font-mono text-[10px]">
                    {signal.observedAt ? new Date(signal.observedAt).toISOString() : "No live observation"}
                  </dd>
                </div>
              </dl>
            </li>
          )
        })}
      </ol>

      <footer className="pt-3 text-xs text-[var(--workbench-muted)]">
        System is read-only. Configuration and persisted history never become live status.
      </footer>
    </section>
  )
}
