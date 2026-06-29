import { FlaskConical, Gauge, LockKeyhole } from "lucide-react"
import { getBrainCouncilExperimentDashboard } from "@/components/brain-council/brain-council-experiments"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilExperimentDashboard() {
  const dashboard = getBrainCouncilExperimentDashboard()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-sm font-medium">Experiment dashboard</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Tracks how Brain Council beliefs would be tested. This dashboard
              previews questions, predictions, evidence, and calibration without
              starting experiments or scheduling work.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value="pass" label={`${dashboard.summary.readyForReview} ready`} />
          <StatusBadge value="partial" label={`${dashboard.summary.watch} watch`} />
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {dashboard.experiments.map((experiment) => (
          <article key={experiment.id} className="rounded-xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {experiment.id}
                </p>
                <h3 className="mt-1 text-sm font-medium">{experiment.question}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={experiment.status === "ready-for-review" ? "pass" : "partial"} label={experiment.status} />
                <StatusBadge value="neutral" label={experiment.calibration} />
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Prediction: {experiment.prediction}
            </p>
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Evidence signals
                </h4>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {experiment.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Experiment visibility is not experiment execution. Scheduler, autonomy,
          worker dispatch, and production writes remain disabled.
        </p>
      </div>
    </section>
  )
}
