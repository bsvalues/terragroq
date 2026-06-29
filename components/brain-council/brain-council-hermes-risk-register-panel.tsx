import { OctagonAlert } from "lucide-react"
import { getHermesActivationRiskRegister } from "@/components/brain-council/brain-council-hermes-risk-register"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesRiskRegisterPanel() {
  const register = getHermesActivationRiskRegister()

  return (
    <section className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <OctagonAlert className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes activation risk register</h2>
            <StatusBadge value="fail" label={register.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The risk register makes activation hazards explicit without reducing any gate.
            It is evidence for future planning, not a runtime or approval surface.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {register.risks.map((risk) => (
          <article key={risk.id} className="rounded-lg border border-destructive/20 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{risk.title}</h3>
              <StatusBadge value="fail" label={risk.severity} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{risk.source}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{risk.risk}</p>
            <p className="mt-2 text-sm leading-relaxed">
              Current control: <span className="text-muted-foreground">{risk.currentControl}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {risk.requiredBeforeProposal.map((item) => (
                <span key={item} className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Escalation-only topics
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {register.escalationOnly.map((item) => (
            <span key={item} className="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
