import { GaugeCircle } from "lucide-react"
import { getHermesActivationReadinessRubric } from "@/components/brain-council/brain-council-hermes-activation-rubric"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesActivationRubricPanel() {
  const rubric = getHermesActivationReadinessRubric()

  return (
    <section className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <GaugeCircle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes activation readiness rubric</h2>
            <StatusBadge value="fail" label={rubric.verdict.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The rubric explains what would be required before Hermes could ever be proposed
            for activation. It does not approve activation or create an activation ledger entry.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {rubric.criteria.map((criterion) => (
          <article key={criterion.id} className="rounded-lg border border-destructive/20 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{criterion.label}</h3>
              <StatusBadge value={criterion.currentStatus === "blocked" ? "fail" : "partial"} label={criterion.currentStatus} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{criterion.failureMeaning}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {criterion.requiredEvidence.map((item) => (
                <span key={item} className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-muted-foreground">
        {rubric.minimumStandard}
      </p>
    </section>
  )
}
