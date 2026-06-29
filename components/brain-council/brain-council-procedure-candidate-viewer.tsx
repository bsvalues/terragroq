import { LockKeyhole, Sparkles } from "lucide-react"
import { getBrainCouncilProcedureCandidates } from "@/components/brain-council/brain-council-procedure-candidates"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilProcedureCandidateViewer() {
  const set = getBrainCouncilProcedureCandidates()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-sm font-medium">Procedure candidates</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Finds repeated safe procedures that may later become ratified skills.
              Candidates are visible for review, but activation remains disabled.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value="neutral" label={`${set.summary.total} observed`} />
          <StatusBadge value="pass" label={`${set.summary.candidates} candidates`} />
          <StatusBadge value={set.summary.active === 0 ? "pass" : "fail"} label={`${set.summary.active} active`} />
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {set.candidates.map((candidate) => (
          <article key={candidate.id} className="rounded-xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {candidate.id}
                </p>
                <h3 className="mt-1 text-sm font-medium">{candidate.candidateSkill}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={candidate.ratificationStatus === "candidate" ? "partial" : "neutral"} label={candidate.ratificationStatus} />
                <StatusBadge value="pass" label={candidate.activationStatus} />
                <StatusBadge value="neutral" label={`${Math.round(candidate.confidence * 100)}%`} />
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Repeated procedure: {candidate.repeatedProcedure}
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
              <div className="rounded-lg border border-border bg-card p-3">
                <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Evidence
                </h4>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {candidate.evidence.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Blocked until
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{candidate.blockedUntil}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Procedure candidates are not Hermes runtime. They cannot run, schedule,
          approve, dispatch, mutate state, or write production data.
        </p>
      </div>
    </section>
  )
}
