import { AlertTriangle, LockKeyhole } from "lucide-react"
import { getHermesBlockedDeniedState } from "@/components/brain-council/hermes-blocked-denied-state"
import { StatusBadge } from "@/components/status-badge"

export function HermesBlockedDeniedStatePanel() {
  const state = getHermesBlockedDeniedState()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Blocked and denied states
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{state.title}</h2>
          <StatusBadge value="warning" label="blocked" />
          <StatusBadge value="pass" label="no action taken" />
          <StatusBadge value="pass" label="no activation control" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {state.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {state.items.map((item) => (
          <div key={item.label} className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-warning" aria-hidden={true} />
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.actionTaken} action taken
              </p>
            </div>
            <p className="mt-2 text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.reason}
            </p>
            <div className="mt-3 space-y-2 border-t border-warning/30 pt-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                <span className="text-foreground">Missing authority:</span> {item.missingAuthority}
              </p>
              <p>
                <span className="text-foreground">Evidence required:</span> {item.evidenceRequired}
              </p>
              <p>
                <span className="text-foreground">Next review:</span> {item.nextReview}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
