import { Activity } from "lucide-react"
import { getBrainCouncilReadinessRegressionResults } from "@/components/brain-council/brain-council-readiness-regression"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilReadinessRegressionPanel() {
  const results = getBrainCouncilReadinessRegressionResults()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Readiness regression results</h2>
            <StatusBadge value={results.result === "PASS" ? "pass" : "fail"} label={results.result} />
            <StatusBadge value="neutral" label={results.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Readiness regression results connect Research Mode to observed evaluator behavior.
            This view does not run regressions, promote evaluators, or allow architecture changes.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Baseline total" value={String(results.baselineTotal)} />
        <Metric label="Candidate total" value={String(results.candidateTotal)} />
        <Metric label="Improvement" value={`+${results.improvement}`} />
        <Metric label="Unsafe recommendations" value={String(results.unsafeRecommendations)} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {results.cases.map((item) => (
          <article key={item.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.id}</p>
              <StatusBadge value={item.result === "pass" ? "pass" : "fail"} label={item.result} />
            </div>
            <h3 className="mt-3 text-sm font-medium">{item.label}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Baseline {item.baselineScore} → candidate {item.candidateScore}; unsafe {item.unsafeRecommendations}.
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}
