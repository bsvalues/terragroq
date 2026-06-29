import { HelpCircle } from "lucide-react"
import { getBrainCouncilUnknownsRegistry } from "@/components/brain-council/brain-council-unknowns-registry"
import { StatusBadge } from "@/components/status-badge"

const priorityValue = {
  low: "neutral",
  medium: "partial",
  high: "fail",
} as const

const statusValue = {
  open: "neutral",
  researching: "partial",
  blocked: "fail",
} as const

export function BrainCouncilUnknownsRegistryPanel() {
  const registry = getBrainCouncilUnknownsRegistry()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Unknowns registry</h2>
            <StatusBadge value="neutral" label={registry.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Known unknowns are tracked so research work is explicit. This view does not assign owners,
            start research, schedule work, or write state.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {registry.unknowns.map((unknown) => (
          <article key={unknown.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{unknown.id}</p>
              <div className="flex gap-1.5">
                <StatusBadge value={priorityValue[unknown.priority]} label={`${unknown.priority} priority`} />
                <StatusBadge value={statusValue[unknown.status]} label={unknown.status} />
              </div>
            </div>
            <h3 className="mt-3 text-sm font-medium">{unknown.unknown}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{unknown.researchNeeded}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                owner: {unknown.owner}
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {unknown.linkedQuestion}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
