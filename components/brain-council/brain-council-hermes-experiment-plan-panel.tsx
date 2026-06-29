import { FlaskConical, ShieldCheck } from "lucide-react"
import { getHermesNonRuntimeExperimentPlan } from "@/components/brain-council/brain-council-hermes-experiment-plan"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesExperimentPlanPanel() {
  const plan = getHermesNonRuntimeExperimentPlan()

  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes non-runtime experiment plan</h2>
            <StatusBadge value="neutral" label={plan.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {plan.question} The plan measures usefulness without installing Hermes,
            launching workers, invoking skills, activating MCP, or writing data.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm leading-relaxed">
        Hypothesis: <span className="text-muted-foreground">{plan.hypothesis}</span>
      </p>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {plan.steps.map((step) => (
          <article key={step.id} className="rounded-lg border border-border bg-background/60 p-3">
            <h3 className="text-sm font-medium">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.method}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {step.evidence.map((item) => (
                <span key={item} className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Success signal: {step.successSignal}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <PlanList title="Blocked actions" items={plan.blockedActions} tone="blocked" />
        <PlanList title="Exit criteria" items={plan.exitCriteria} tone="safe" />
      </div>
    </section>
  )
}

function PlanList({ title, items, tone }: { title: string; items: string[]; tone: "blocked" | "safe" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className={tone === "safe" ? "h-4 w-4 text-success" : "h-4 w-4 text-destructive"} aria-hidden />
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
