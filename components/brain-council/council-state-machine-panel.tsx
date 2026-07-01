import { GitBranch, LockKeyhole } from "lucide-react"
import { getCouncilStateMachine } from "@/components/brain-council/council-state-machine"
import { StatusBadge } from "@/components/status-badge"

export function CouncilStateMachinePanel() {
  const machine = getCouncilStateMachine()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Advisory state model
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{machine.title}</h2>
          <StatusBadge value="pass" label="schema only" />
          <StatusBadge value="neutral" label="transitions guarded" />
          <StatusBadge value="pass" label="no execution" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {machine.summary}
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {machine.states.map((state) => (
          <div key={state.id} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {state.id}
            </p>
            <p className="mt-2 text-sm font-semibold">{state.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {state.description}
            </p>
            <div className="mt-3 border-t border-border pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Next guarded transition
              </p>
              {state.allowedTransitions[0] ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {state.allowedTransitions[0].label} requires{" "}
                  <span className="text-foreground">{state.allowedTransitions[0].guard}</span>
                </p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  No automatic transition. Primary authority is required.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-border bg-muted/10 px-4 py-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          This state machine is descriptive. It does not execute transitions, start loops,
          dispatch workers, or write production data.
        </p>
      </div>
    </section>
  )
}
