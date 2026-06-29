import { Brain } from "lucide-react"
import { getBrainCouncilCognitiveDebtDashboard } from "@/components/brain-council/brain-council-cognitive-debt"
import { StatusBadge } from "@/components/status-badge"

const severityValue = {
  low: "neutral",
  medium: "partial",
  high: "fail",
} as const

export function BrainCouncilCognitiveDebtPanel() {
  const dashboard = getBrainCouncilCognitiveDebtDashboard()

  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <Brain className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Cognitive debt dashboard</h2>
            <StatusBadge value="partial" label={dashboard.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Cognitive debt highlights research liabilities that need review. This dashboard does not resolve debt,
            update memory, change policy, or mutate data.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dashboard.items.map((item) => (
          <article key={item.id} className="rounded-lg border border-warning/30 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{item.label}</h3>
              <StatusBadge value={severityValue[item.severity]} label={item.severity} />
            </div>
            <div className="mt-3 text-2xl font-semibold">{item.count}</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.reason}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
