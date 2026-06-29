import { ClipboardCheck } from "lucide-react"
import { getHermesCandidateProcedureReview } from "@/components/brain-council/brain-council-hermes-procedure-review"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesProcedureReviewPanel() {
  const review = getHermesCandidateProcedureReview()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes candidate procedure review</h2>
            <StatusBadge value="neutral" label={review.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Candidate procedures can be inspected before they are trusted. This review surface
            keeps procedures separate from skills, runtime execution, memory promotion, and worker dispatch.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {review.procedures.map((procedure) => (
          <article key={procedure.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{procedure.title}</h3>
              <StatusBadge
                value={procedure.ratificationStatus === "proposed" ? "partial" : "neutral"}
                label={procedure.ratificationStatus}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{procedure.source}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Confidence: <span className="text-foreground">{procedure.confidence}%</span>
            </p>
            <TagGroup title="Review focus" items={procedure.reviewFocus} />
            <TagGroup title="Blocked until" items={procedure.blockedUntil} tone="blocked" />
          </article>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm leading-relaxed text-muted-foreground">
        {review.decisionRule}
      </p>
    </section>
  )
}

function TagGroup({ title, items, tone = "neutral" }: { title: string; items: string[]; tone?: "neutral" | "blocked" }) {
  return (
    <div className="mt-3">
      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className={
              tone === "blocked"
                ? "rounded-full border border-destructive/25 bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive"
                : "rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground"
            }
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
