import { GitBranch, LockKeyhole } from "lucide-react"
import { getHermesAuthorityStateModel } from "@/components/brain-council/hermes-authority-state-model"
import { StatusBadge } from "@/components/status-badge"

export function HermesAuthorityStatePanel() {
  const model = getHermesAuthorityStateModel()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Hermes authority states
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{model.title}</h2>
          <StatusBadge value="neutral" label={`current: ${model.currentState}`} />
          <StatusBadge value="pass" label="model only" />
          <StatusBadge value="pass" label="execution inactive" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {model.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {model.states.map((state) => (
          <div key={state.id} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {state.id}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{state.label}</p>
              <StatusBadge
                value={state.posture === "blocked" ? "warning" : "neutral"}
                label={state.posture}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {state.description}
            </p>
            <div className="mt-3 border-t border-border pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Required before next
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {state.requiredBeforeNext.join(", ")}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border bg-muted/10 px-4 py-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          These states are descriptive only. They do not activate Hermes, transition runtime state,
          dispatch jobs, grant authority, or write production data.
        </p>
      </div>
    </section>
  )
}
