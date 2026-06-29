import { ListChecks } from "lucide-react"
import { getBrainCouncilExperimentRegistry } from "@/components/brain-council/brain-council-experiment-registry"
import { StatusBadge } from "@/components/status-badge"

const statusValue = {
  active: "neutral",
  pending: "partial",
  blocked: "fail",
} as const

export function BrainCouncilExperimentRegistryPanel() {
  const registry = getBrainCouncilExperimentRegistry()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ListChecks className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Experiment registry</h2>
            <StatusBadge value="neutral" label={registry.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Experiments are first-class research records. They can inform future decisions,
            but cannot execute work or authorize architecture changes.
          </p>
        </div>
      </div>

      {registry.experiments.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-background/60 p-3 text-sm text-muted-foreground">
          {registry.emptyState}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {registry.experiments.map((experiment) => (
            <article key={experiment.id} className="rounded-lg border border-border bg-background/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{experiment.id}</p>
                  <h3 className="mt-1 text-sm font-medium">{experiment.question}</h3>
                </div>
                <StatusBadge value={statusValue[experiment.status]} label={experiment.status} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{experiment.hypothesis}</p>
              <p className="mt-2 text-sm leading-relaxed">
                Prediction: <span className="text-muted-foreground">{experiment.prediction}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  evidence {experiment.evidenceCount}
                </span>
                <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  architecture {experiment.architectureAllowed ? "allowed" : "not allowed"}
                </span>
                <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {experiment.decision}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
