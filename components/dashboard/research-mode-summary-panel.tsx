import Link from "next/link"
import { ArrowRight, Microscope } from "lucide-react"
import { getResearchModeHomeSummary } from "@/components/dashboard/research-mode-summary"
import { StatusBadge } from "@/components/status-badge"

export function ResearchModeSummaryPanel() {
  const summary = getResearchModeHomeSummary()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Microscope className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-medium">Research Mode closeout</h2>
          <StatusBadge value="neutral" label={summary.posture.replace(/_/g, " ")} />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Brain Council research signals are visible on Operator Home. This panel links to the review surface
          without starting experiments, running evals, activating Hermes, or writing state.
        </p>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-5">
        {summary.items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{item.value}</span>
              <ArrowRight className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <StatusBadge value="pass" label={`readiness regression: ${summary.readinessRegressionStatus}`} />
        <StatusBadge value="neutral" label={`Hermes: ${summary.hermesStatus}`} />
        <StatusBadge value="pass" label="no runtime authority" />
      </div>
    </section>
  )
}
