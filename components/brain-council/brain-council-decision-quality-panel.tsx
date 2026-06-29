import { Scale } from "lucide-react"
import { getBrainCouncilDecisionQualityDashboard } from "@/components/brain-council/brain-council-decision-quality"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilDecisionQualityPanel() {
  const dashboard = getBrainCouncilDecisionQualityDashboard()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Scale className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Decision quality dashboard</h2>
            <StatusBadge value="neutral" label={dashboard.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Decision quality tracks whether prior Brain Council decisions survived, reversed, or need review.
            It does not alter decisions or write lessons back to memory.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {dashboard.decisions.map((decision) => (
          <article key={decision.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{decision.id}</p>
              <StatusBadge value={decision.reversed ? "fail" : "pass"} label={decision.reversed ? "reversed" : "survived"} />
            </div>
            <h3 className="mt-3 text-sm font-medium">{decision.decision}</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {decision.linkedExperiment}
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                survived {decision.survivalDays}d
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                review {decision.reviewDate}
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{decision.lesson}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
