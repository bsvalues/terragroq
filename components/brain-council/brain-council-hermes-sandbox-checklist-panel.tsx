import { Box, CheckCircle2 } from "lucide-react"
import { getHermesSandboxRequirementChecklist } from "@/components/brain-council/brain-council-hermes-sandbox-checklist"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesSandboxChecklistPanel() {
  const checklist = getHermesSandboxRequirementChecklist()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Box className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes sandbox requirement checklist</h2>
            <StatusBadge value="neutral" label={checklist.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            This checklist describes what a future sandbox would have to prove before any Hermes
            output could be trusted. It does not create a sandbox or run code.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {checklist.requirements.map((requirement) => (
          <article key={requirement.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{requirement.label}</h3>
              <StatusBadge value={requirement.status === "required" ? "partial" : "fail"} label={requirement.status} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{requirement.source}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{requirement.acceptance}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Non-negotiables</h3>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {checklist.nonNegotiables.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
