import { GitBranch, ShieldCheck } from "lucide-react"
import { getDecisionCorrectionCaptureSurface } from "@/components/dogfood/decision-correction-capture"
import { StatusBadge } from "@/components/status-badge"

export function DecisionCorrectionCapturePanel() {
  const surface = getDecisionCorrectionCaptureSurface()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" aria-hidden={true} />
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Decision training capture
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{surface.title}</h2>
          <StatusBadge value="pass" label="read-only" />
          <StatusBadge value="neutral" label="candidate queue" />
          <StatusBadge value="pass" label="Primary review" />
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {surface.summary}
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
        {surface.items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {item.candidateType}
            </p>
            <p className="mt-2 text-sm font-semibold">{item.label}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <div className="border-b border-border bg-muted/10 p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Review flow
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {surface.reviewFlow.map((step) => (
            <span
              key={step}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
            >
              {step}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Decisions and corrections become review candidates only. This surface does not write
          memory, promote canon, update training, or extract records in the background.
        </p>
      </div>
    </section>
  )
}
