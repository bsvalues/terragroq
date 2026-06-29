import { Microscope, ShieldCheck } from "lucide-react"
import { getBrainCouncilResearchModeOverview } from "@/components/brain-council/brain-council-research-mode"
import { StatusBadge } from "@/components/status-badge"

const statusValue = {
  open: "neutral",
  watch: "partial",
  ready: "pass",
  blocked: "fail",
} as const

export function BrainCouncilResearchModeOverviewPanel() {
  const overview = getBrainCouncilResearchModeOverview()

  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Microscope className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Brain Council research mode</h2>
            <StatusBadge value="neutral" label={overview.mode.replace(/_/g, " ")} />
            <StatusBadge value="pass" label="no execution authority" />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {overview.question} Research Mode makes experiments, predictions,
            assumptions, calibration, and unknowns visible without running agents or activating Hermes.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {overview.signals.map((signal) => (
          <article key={signal.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{signal.label}</h3>
              <StatusBadge value={statusValue[signal.status]} label={signal.status} />
            </div>
            <div className="mt-3 text-2xl font-semibold">{signal.count}</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{signal.summary}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Calibration
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {overview.calibration.verifiedCount} verified / {overview.calibration.pendingCount} pending from{" "}
            {overview.calibration.predictionCount} tracked predictions.
          </p>
          <StatusBadge value="partial" label={overview.calibration.status.replace(/-/g, " ")} />
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Research safety
            </h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Read-only research view. It does not execute experiments, activate Hermes, schedule work,
            or write production data.
          </p>
        </div>
      </div>
    </section>
  )
}
