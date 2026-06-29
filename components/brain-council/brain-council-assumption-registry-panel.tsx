import { ClipboardList } from "lucide-react"
import { getBrainCouncilAssumptionRegistry } from "@/components/brain-council/brain-council-assumption-registry"
import { StatusBadge } from "@/components/status-badge"

const statusValue = {
  active: "neutral",
  challenged: "partial",
  retired: "fail",
} as const

export function BrainCouncilAssumptionRegistryPanel() {
  const registry = getBrainCouncilAssumptionRegistry()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Assumption registry</h2>
            <StatusBadge value="neutral" label={registry.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Assumptions are visible for review and challenge. This surface does not change beliefs,
            retire assumptions, promote memory, or write research state.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {registry.assumptions.map((assumption) => (
          <article key={assumption.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{assumption.id}</p>
              <StatusBadge value={statusValue[assumption.status]} label={assumption.status} />
            </div>
            <p className="mt-3 text-sm leading-relaxed">{assumption.assumption}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {assumption.confidence}% confidence
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {assumption.evidenceStrength} evidence
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {assumption.linkedQuestion} / {assumption.linkedExperiment}
              </span>
              {assumption.reviewNeeded && (
                <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 font-mono text-[10px] text-warning">
                  review needed
                </span>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Review date: {assumption.reviewDate}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
