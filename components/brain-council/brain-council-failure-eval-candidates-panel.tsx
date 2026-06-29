import { FileWarning } from "lucide-react"
import { getBrainCouncilFailureEvalCandidates } from "@/components/brain-council/brain-council-failure-eval-candidates"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilFailureEvalCandidatesPanel() {
  const viewer = getBrainCouncilFailureEvalCandidates()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Failure-to-eval candidates</h2>
            <StatusBadge value="neutral" label={viewer.posture.replace(/_/g, " ")} />
            <StatusBadge value="fail" label="safe to promote: no" />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Failures are captured as candidate evals for later review. This surface does not create evals,
            run evals, promote candidates, or mutate evidence.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {viewer.candidates.map((candidate) => (
          <article key={candidate.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {candidate.id}
              </p>
              <StatusBadge value={candidate.priority === "high" ? "warning" : "neutral"} label={candidate.priority} />
            </div>
            <h3 className="mt-3 text-sm font-medium">{candidate.failureSource}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{candidate.failedBehavior}</p>
            <div className="mt-3 rounded-md border border-border bg-card/70 p-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Proposed eval</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{candidate.proposedEval}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge value="neutral" label={candidate.status} />
              <StatusBadge value="fail" label={candidate.safeToPromote ? "safe to promote" : "safe to promote: no"} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
