import { ClipboardCheck, LockKeyhole } from "lucide-react"
import { getBrainCouncilReadinessEvaluation } from "@/components/brain-council/brain-council-readiness"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilReadinessEvaluator() {
  const evaluation = getBrainCouncilReadinessEvaluation()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Readiness evaluator</h2>
              <StatusBadge value={evaluation.verdict === "SAFE_FOR_OPERATOR_REVIEW" ? "pass" : "partial"} label={evaluation.verdict.replace(/_/g, " ")} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Scores whether this reasoning packet is ready for operator review.
              It does not approve, execute, dispatch, or mutate anything.
            </p>
          </div>
        </div>
        <StatusBadge value="pass" label={`${Math.round(evaluation.confidence * 100)}% readiness`} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {evaluation.checks.map((check) => (
          <div key={check.id} className="rounded-lg border border-border bg-background/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{check.label}</h3>
              <StatusBadge value={check.status} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{check.summary}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Next gate
          </h3>
          <p className="mt-2 text-sm leading-relaxed">{evaluation.nextGate}</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Runtime remains inactive: read-only {String(evaluation.safety.readOnly)}, execute {String(evaluation.safety.wouldExecute)},
            autonomy {String(evaluation.safety.autonomyEnabled)}, MCP {String(evaluation.safety.mcpActivation)}, production write {String(evaluation.safety.productionWrite)}.
          </p>
        </div>
      </div>
    </section>
  )
}
