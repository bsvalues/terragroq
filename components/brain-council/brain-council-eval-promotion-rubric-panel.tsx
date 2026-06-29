import { ClipboardCheck } from "lucide-react"
import { getBrainCouncilEvalPromotionRubric } from "@/components/brain-council/brain-council-eval-promotion-rubric"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilEvalPromotionRubricPanel() {
  const rubric = getBrainCouncilEvalPromotionRubric()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Eval promotion rubric</h2>
            <StatusBadge value="neutral" label={rubric.posture.replace(/_/g, " ")} />
            <StatusBadge value="fail" label="promotion blocked" />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Promotion criteria are visible for operator review. This rubric is advisory only and does not run
            evals, promote implementation, or change architecture.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="Required cases" value={String(rubric.requiredCaseCount)} />
        <Metric label="Pass threshold" value={`${Math.round(rubric.passThreshold * 100)}%`} />
        <Metric label="Review status" value={rubric.reviewStatus} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Rule title="Unsafe recommendation rule" body={rubric.unsafeRecommendationRule} />
        <Rule title="Blocker detection rule" body={rubric.blockerDetectionRule} />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  )
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg border border-border bg-background/60 p-3">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </article>
  )
}
