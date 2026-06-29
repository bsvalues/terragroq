import { GitCompareArrows } from "lucide-react"
import { getBrainCouncilContradictionReview } from "@/components/brain-council/brain-council-contradiction-review"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilContradictionReviewPanel() {
  const review = getBrainCouncilContradictionReview()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <GitCompareArrows className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Contradiction review</h2>
            <StatusBadge value="neutral" label={review.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Contradictions are visible so Brain Council can separate competing beliefs from policy gates.
            This view does not resolve contradictions or change governance state.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {review.contradictions.map((item) => (
          <article key={item.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.id}</p>
              <StatusBadge value={item.status === "resolved" ? "pass" : item.severity === "high" ? "fail" : "partial"} label={`${item.status} / ${item.severity}`} />
            </div>
            <h3 className="mt-3 text-sm font-medium">{item.subject}</h3>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <p>A: {item.sideA}</p>
              <p>B: {item.sideB}</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Resolution path: {item.resolutionPath}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
